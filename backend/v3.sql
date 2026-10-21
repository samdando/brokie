-- Brokie v3: global leaderboard, squad chat + emoji, feedback, events/news.
-- Run AFTER schema.sql and seasons_v2.sql. Safe to re-run.

-- ---------- Profile: opt out of the global board ----------------------
alter table public.profiles add column if not exists show_global boolean not null default true;

-- ---------- Squad chat ------------------------------------------------
create table if not exists public.squad_messages (
  id         bigint generated always as identity primary key,
  squad_id   uuid not null references public.squads on delete cascade on update cascade,
  user_id    uuid not null references public.profiles on delete cascade on update cascade,
  kind       text not null check (kind in ('text', 'emoji')),
  body       text not null check (char_length(body) between 1 and 140),
  created_at timestamptz not null default now()
);
create index if not exists squad_messages_squad_time on public.squad_messages (squad_id, id desc);
alter table public.squad_messages enable row level security;
revoke all on public.squad_messages from anon, authenticated;

-- ---------- Feedback --------------------------------------------------
create table if not exists public.feedback (
  id         bigint generated always as identity primary key,
  user_id    uuid references auth.users on delete set null,
  handle     text,
  kind       text not null check (kind in ('bug', 'idea', 'love', 'other')),
  message    text not null check (char_length(message) between 3 and 1000),
  context    text,
  created_at timestamptz not null default now()
);
alter table public.feedback enable row level security;
revoke all on public.feedback from anon, authenticated;

-- ---------- Events: CPI / NFP / FOMC calendar + session opens ----------
-- Sam adds rows from the Supabase table editor (event_at = release time).
-- Players see a countdown from `lead_minutes` before, a flash at release, and
-- the event stays "live" for `duration_minutes`. Session opens are automatic.
create table if not exists public.events (
  id               bigint generated always as identity primary key,
  kind             text not null default 'econ' check (kind in ('econ', 'news', 'season')),
  impact           text not null default 'high' check (impact in ('low', 'med', 'high')),
  title            text not null check (char_length(title) between 1 and 80),
  body             text check (char_length(body) <= 280),
  market           public.market,                       -- optional: the market it moves most
  event_at         timestamptz not null,
  lead_minutes     int not null default 30 check (lead_minutes between 0 and 1440),
  duration_minutes int not null default 60 check (duration_minutes between 1 and 1440),
  created_at       timestamptz not null default now()
);
create index if not exists events_at on public.events (event_at);
alter table public.events enable row level security;
revoke all on public.events from anon, authenticated;

-- ---------- Global leaderboard ----------------------------------------
-- Everyone who has a season account and hasn't opted out. Qualified players
-- (5+ trading days) rank first, then by return. You always see your own rank.
create or replace function public.global_leaderboard(p_limit int default 50) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := require_user();
  lim int := greatest(5, least(coalesce(p_limit, 50), 100));
  rows jsonb;
  me jsonb;
  total int;
begin
  create temp table _gl on commit drop as
  with base as (
    select p.id, p.handle, p.show_global,
           round(coalesce(a.cash, starting_balance()) + unrealized(p.id, current_season()), 2) as equity,
           coalesce(a.start_balance, starting_balance()) as start_balance,
           coalesce(a.status, 'active') as status,
           a.funded_at is not null as funded,
           trading_days(p.id, current_season()) as trading_days,
           (select count(*) from trades t where t.user_id = p.id and t.season = current_season()) as trades
    from profiles p
    join accounts a on a.user_id = p.id and a.season = current_season()
  ), scored as (
    select b.*, round((b.equity - b.start_balance) / b.start_balance * 100, 2) as return_pct,
           b.trading_days >= 5 as qualified
    from base b
  )
  select s.*, row_number() over (order by s.qualified desc, s.return_pct desc, s.handle) as rank from scored s;

  select count(*) into total from _gl where show_global or id = uid;

  select coalesce(jsonb_agg(to_jsonb(r) order by r.rank), '[]'::jsonb) into rows from (
    select g.rank, g.handle, g.id = uid as is_you, g.equity, g.return_pct, g.status, g.funded,
           g.qualified, g.trading_days, g.trades
    from _gl g where g.show_global or g.id = uid
    order by g.rank limit lim
  ) r;

  select to_jsonb(r) into me from (
    select g.rank, g.handle, true as is_you, g.equity, g.return_pct, g.status, g.funded,
           g.qualified, g.trading_days, g.trades, g.show_global
    from _gl g where g.id = uid
  ) r;

  drop table _gl;
  return jsonb_build_object('rows', rows, 'me', me, 'players', total, 'season', current_season());
end $$;

create or replace function public.set_global_visibility(p_show boolean) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user();
begin update profiles set show_global = coalesce(p_show, true) where id = uid; end $$;

-- ---------- Chat ------------------------------------------------------
create or replace function public.send_message(p_squad uuid, p_body text, p_kind text default 'text') returns void
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := require_member(p_squad);
  b text := btrim(regexp_replace(coalesce(p_body, ''), '[[:cntrl:]]+', ' ', 'g'));
  k text := case when p_kind = 'emoji' then 'emoji' else 'text' end;
begin
  if char_length(b) < 1 then raise exception 'Say something first.' using errcode = 'P0001'; end if;
  if char_length(b) > 140 then raise exception 'Keep it under 140 characters.' using errcode = 'P0001'; end if;
  if k = 'emoji' and char_length(b) > 8 then raise exception 'Emoji only, mate.' using errcode = 'P0001'; end if;
  if (select count(*) from squad_messages where user_id = uid and created_at > now() - interval '10 seconds') >= 5 then
    raise exception 'Slow down, chatterbox.' using errcode = 'P0001';
  end if;
  insert into squad_messages (squad_id, user_id, kind, body) values (p_squad, uid, k, b);
end $$;

create or replace function public.squad_chat(p_squad uuid, p_after bigint default 0, p_limit int default 50) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_member(p_squad);
begin
  return coalesce((
    select jsonb_agg(to_jsonb(m) order by m.id)
    from (
      select c.id, p.handle, c.user_id = uid as is_you, c.kind, c.body, c.created_at as at
      from squad_messages c join profiles p on p.id = c.user_id
      where c.squad_id = p_squad and c.id > coalesce(p_after, 0)
      order by c.id desc
      limit greatest(1, least(coalesce(p_limit, 50), 100))
    ) m), '[]'::jsonb);
end $$;

-- ---------- Feedback --------------------------------------------------
create or replace function public.submit_feedback(p_kind text, p_message text, p_context text default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := require_user();
  msg text := btrim(coalesce(p_message, ''));
begin
  if char_length(msg) < 3 then raise exception 'Tell us a bit more.' using errcode = 'P0001'; end if;
  if char_length(msg) > 1000 then raise exception 'Keep it under 1000 characters.' using errcode = 'P0001'; end if;
  if (select count(*) from feedback where user_id = uid and created_at > now() - interval '1 day') >= 10 then
    raise exception 'Plenty of feedback today, thank you! Try again tomorrow.' using errcode = 'P0001';
  end if;
  insert into feedback (user_id, handle, kind, message, context)
  values (uid, (select handle from profiles where id = uid),
          case when p_kind in ('bug', 'idea', 'love') then p_kind else 'other' end,
          msg, left(p_context, 300));
end $$;

-- ---------- Events feed -----------------------------------------------
-- Public (even before picking a handle). `phase` is 'soon' (countdown) or 'live'.
create or replace function public.events_feed() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  cal jsonb;
  ses jsonb;
  upc jsonb;
begin
  select coalesce(jsonb_agg(to_jsonb(e) order by e.at), '[]'::jsonb) into cal from (
    select id::text as id, kind, impact, title, body, market, event_at as at,
           case when now() >= event_at then 'live' else 'soon' end as phase,
           event_at + make_interval(mins => duration_minutes) as ends_at
    from events
    where now() >= event_at - make_interval(mins => lead_minutes)
      and now() <  event_at + make_interval(mins => duration_minutes)
    order by event_at
    limit 10
  ) e;

  -- Weekday session opens, DST-proof because each is anchored to its own zone.
  select coalesce(jsonb_agg(to_jsonb(s) order by s.at), '[]'::jsonb) into ses from (
    select 'session:' || z.code as id, 'session'::text as kind, 'low'::text as impact,
           z.title, z.body, null::public.market as market,
           o.open_at as at,
           case when now() >= o.open_at then 'live' else 'soon' end as phase,
           o.open_at + interval '30 minutes' as ends_at
    from (values
      ('syd', 'Sydney open',        'ASX is live. Gold gets its first move of the day.', 'Australia/Sydney',  time '10:00'),
      ('tyo', 'Tokyo open',         'Asia is awake.',                                    'Asia/Tokyo',        time '09:00'),
      ('lon', 'London open',        'Europe is in. Expect gold and indices to move.',    'Europe/London',     time '08:00'),
      ('nyc', 'Wall Street open',   'NAS and ES wake up. Hold on.',                      'America/New_York',  time '09:30')
    ) as z(code, title, body, tz, t)
    cross join lateral (
      select (((now() at time zone z.tz)::date + z.t) at time zone z.tz) as open_at
    ) o
    where extract(isodow from (now() at time zone z.tz)) between 1 and 5
      and now() >= o.open_at - interval '5 minutes'
      and now() <  o.open_at + interval '30 minutes'
  ) s;

  select coalesce(jsonb_agg(to_jsonb(u) order by u.at), '[]'::jsonb) into upc from (
    select id::text as id, kind, impact, title, body, market, event_at as at
    from events
    where event_at >= now() and event_at < now() + interval '14 days'
    order by event_at
    limit 8
  ) u;

  return jsonb_build_object('active', cal || ses, 'upcoming', upc, 'server_time', now());
end $$;

-- ---------- Chart: keep closed trades on the chart (24h, newest 60) -----
create or replace function public.chart_bubbles(p_market public.market, p_squad uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := require_user();
begin
  if p_squad is not null then perform require_member(p_squad); end if;
  return coalesce((
    select jsonb_agg(row_to_json(b) order by b.at)
    from (
      select 'open'::text as state, o.id, p.handle, o.user_id = uid as is_you, o.side, o.quantity, o.entry_price,
             null::numeric as exit_price, null::numeric as pnl, null::text as reason, o.opened_at as at, o.opened_at,
             round(o.quantity * 1000 / nullif(a.cash + unrealized(o.user_id, o.season), 0) * 100, 2) as size_pct,
             a.peak_equity * (1 - a.max_dd_pct / 100) as dd_floor,
             a.cash + unrealized(o.user_id, o.season) as equity
      from positions o
      join profiles p on p.id = o.user_id
      join accounts a on a.user_id = o.user_id and a.season = o.season
      where o.market = p_market and o.season = current_season()
        and (o.user_id = uid or (p_squad is not null and exists (select 1 from squad_members m where m.squad_id = p_squad and m.user_id = o.user_id)))
      union all
      select * from (
        select 'closed'::text, t.id, p.handle, t.user_id = uid, t.side, t.quantity, t.entry_price, t.exit_price, t.pnl, t.reason,
               t.closed_at, t.opened_at, null::numeric, null::numeric, null::numeric
        from trades t join profiles p on p.id = t.user_id
        where t.market = p_market and t.season = current_season() and t.closed_at > now() - interval '24 hours'
          and (t.user_id = uid or (p_squad is not null and exists (select 1 from squad_members m where m.squad_id = p_squad and m.user_id = t.user_id)))
        order by t.closed_at desc limit 60
      ) recent
    ) b), '[]'::jsonb);
end $$;

-- ---------- Permissions -----------------------------------------------
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in
      ('global_leaderboard', 'set_global_visibility', 'send_message', 'squad_chat', 'submit_feedback', 'events_feed')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
  end loop;
end $$;

grant execute on function
  public.global_leaderboard(int), public.set_global_visibility(boolean),
  public.send_message(uuid, text, text), public.squad_chat(uuid, bigint, int),
  public.submit_feedback(text, text, text), public.events_feed()
to authenticated;
grant execute on function public.events_feed() to anon;
