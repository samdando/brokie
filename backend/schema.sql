-- =====================================================================
-- Brokie backend — paste this whole file into Supabase → SQL Editor → Run.
-- Safe to re-run: it drops and recreates Brokie's own functions, and
-- creates tables only if they don't exist yet.
--
-- The server is the referee: it owns every balance, fills every order at
-- the latest ingested quote, liquidates blown accounts, and computes the
-- leaderboard. The app can only ask; it can never write a price or a P&L.
-- =====================================================================

-- ---------- Types ----------------------------------------------------
do $$ begin
  create type public.market as enum ('gold', 'nas', 'es');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.trade_side as enum ('long', 'short');
exception when duplicate_object then null; end $$;

-- ---------- Game constants -------------------------------------------
create table if not exists public.markets (
  id          public.market primary key,
  point_value numeric not null,
  tick_size   numeric not null,
  instrument  text    not null           -- price-feed symbol
);

insert into public.markets (id, point_value, tick_size, instrument) values
  ('gold', 10, 0.1,  'XAU_USD'),
  ('nas',   2, 0.25, 'NAS100_USD'),
  ('es',    5, 0.25, 'SPX500_USD')
on conflict (id) do update
  set point_value = excluded.point_value, tick_size = excluded.tick_size, instrument = excluded.instrument;

-- ---------- Prices ---------------------------------------------------
create table if not exists public.quotes (
  market     public.market primary key references public.markets,
  price      numeric     not null check (price > 0),
  source     text        not null,
  quoted_at  timestamptz not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.quote_ticks (
  id        bigint generated always as identity primary key,
  market    public.market not null references public.markets,
  price     numeric       not null check (price > 0),
  quoted_at timestamptz   not null
);
create index if not exists quote_ticks_market_time on public.quote_ticks (market, quoted_at desc);

-- ---------- Players and squads ---------------------------------------
create table if not exists public.profiles (
  id         uuid primary key references auth.users on delete cascade,
  handle     text not null unique check (handle ~ '^[a-z0-9_]{3,18}$'),
  created_at timestamptz not null default now()
);

create table if not exists public.squads (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(btrim(name)) between 1 and 32),
  invite_code text not null unique,
  owner_id    uuid not null references public.profiles on delete cascade,
  created_at  timestamptz not null default now()
);

create table if not exists public.squad_members (
  squad_id  uuid not null references public.squads on delete cascade,
  user_id   uuid not null references public.profiles on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (squad_id, user_id)
);
create index if not exists squad_members_user on public.squad_members (user_id);

-- ---------- Seasons, accounts, positions, trades ----------------------
-- A season is one week starting Monday 00:00 Brisbane time, keyed by that date.
create table if not exists public.accounts (
  user_id           uuid    not null references public.profiles on delete cascade,
  season            date    not null,
  cash              numeric not null default 10000,
  protection_credit numeric not null default 0,
  liquidations      int     not null default 0,
  primary key (user_id, season)
);

create table if not exists public.positions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null,
  season      date not null,
  market      public.market not null references public.markets,
  side        public.trade_side not null,
  quantity    int not null check (quantity between 1 and 3),
  entry_price numeric not null check (entry_price > 0),
  opened_at   timestamptz not null default now(),
  foreign key (user_id, season) references public.accounts on delete cascade
);
create index if not exists positions_owner on public.positions (user_id, season);

create table if not exists public.trades (
  id          uuid primary key,
  user_id     uuid not null,
  season      date not null,
  market      public.market not null references public.markets,
  side        public.trade_side not null,
  quantity    int not null,
  entry_price numeric not null,
  exit_price  numeric not null,
  pnl         numeric not null,
  opened_at   timestamptz not null,
  closed_at   timestamptz not null default now(),
  reason      text not null default 'closed' check (reason in ('closed', 'liquidated', 'season_end')),
  foreign key (user_id, season) references public.accounts on delete cascade
);
create index if not exists trades_owner on public.trades (user_id, season, closed_at desc);

-- Backup codes let a player move their account to a new phone. Only a hash is stored.
create table if not exists public.account_recovery (
  user_id    uuid primary key references public.profiles on delete cascade on update cascade,
  code_hash  text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.recovery_attempts (
  id      bigint generated always as identity primary key,
  user_id uuid not null,
  at      timestamptz not null default now()
);

-- Server-only settings (never exposed to the app).
create table if not exists public.brokie_private (
  key   text primary key,
  value text not null
);
insert into public.brokie_private (key, value)
values ('cron_secret', replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''))
on conflict (key) do nothing;

-- Moving an account to a new login re-keys every row, so user references cascade on update.
do $$
declare c record;
begin
  for c in select * from (values
    ('squads',        'squads_owner_id_fkey',          'foreign key (owner_id) references public.profiles on delete cascade on update cascade'),
    ('squad_members', 'squad_members_user_id_fkey',    'foreign key (user_id) references public.profiles on delete cascade on update cascade'),
    ('accounts',      'accounts_user_id_fkey',         'foreign key (user_id) references public.profiles on delete cascade on update cascade'),
    ('positions',     'positions_user_id_season_fkey', 'foreign key (user_id, season) references public.accounts on delete cascade on update cascade'),
    ('trades',        'trades_user_id_season_fkey',    'foreign key (user_id, season) references public.accounts on delete cascade on update cascade')
  ) as t(tbl, name, def) loop
    execute format('alter table public.%I drop constraint if exists %I', c.tbl, c.name);
    execute format('alter table public.%I add constraint %I %s', c.tbl, c.name, c.def);
  end loop;
end $$;

-- ---------- Access: tables are read-only or hidden; all writes go through functions
alter table public.markets       enable row level security;
alter table public.quotes        enable row level security;
alter table public.quote_ticks   enable row level security;
alter table public.profiles      enable row level security;
alter table public.squads        enable row level security;
alter table public.squad_members enable row level security;
alter table public.accounts      enable row level security;
alter table public.positions     enable row level security;
alter table public.trades        enable row level security;
alter table public.account_recovery  enable row level security;
alter table public.recovery_attempts enable row level security;
alter table public.brokie_private    enable row level security;
revoke all on public.account_recovery, public.recovery_attempts, public.brokie_private from anon, authenticated;

revoke all on public.markets, public.quotes, public.quote_ticks, public.profiles, public.squads,
              public.squad_members, public.accounts, public.positions, public.trades from anon, authenticated;
grant select on public.markets, public.quotes to anon, authenticated;

drop policy if exists "prices are public" on public.markets;
create policy "prices are public" on public.markets for select using (true);
drop policy if exists "quotes are public" on public.quotes;
create policy "quotes are public" on public.quotes for select using (true);

-- =====================================================================
-- Functions
-- =====================================================================

-- Fresh quotes are required to OPEN a trade (no trading on stale/weekend prices).
create or replace function public.quote_max_age() returns interval
language sql immutable as $$ select interval '45 seconds' $$;

create or replace function public.current_season() returns date
language sql stable as $$
  select (date_trunc('week', now() at time zone 'Australia/Brisbane'))::date
$$;

create or replace function public.season_ends_at(p_season date) returns timestamptz
language sql stable as $$
  select ((p_season + 7)::timestamp) at time zone 'Australia/Brisbane'
$$;

create or replace function public.require_user() returns uuid
language plpgsql stable as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Sign in first.' using errcode = '28000'; end if;
  if not exists (select 1 from public.profiles where id = uid) then
    raise exception 'Pick a handle first.' using errcode = 'P0001';
  end if;
  return uid;
end $$;

create or replace function public.direction(p_side public.trade_side) returns int
language sql immutable as $$ select case p_side when 'long' then 1 else -1 end $$;

create or replace function public.unrealized(p_user uuid, p_season date) returns numeric
language sql stable as $$
  select coalesce(sum((q.price - p.entry_price) * m.point_value * p.quantity * public.direction(p.side)), 0)
  from public.positions p
  join public.quotes q on q.market = p.market
  join public.markets m on m.id = p.market
  where p.user_id = p_user and p.season = p_season
$$;

-- Closes one position at the current quote and returns the trade row.
create or replace function public.settle_position(p_position public.positions, p_reason text)
returns public.trades
language plpgsql security definer set search_path = public as $$
declare
  mark numeric;
  value numeric;
  result public.trades;
begin
  select q.price into mark from quotes q where q.market = p_position.market;
  mark := coalesce(mark, p_position.entry_price);
  select (mark - p_position.entry_price) * m.point_value * p_position.quantity * direction(p_position.side)
    into value from markets m where m.id = p_position.market;
  update accounts set cash = cash + value where user_id = p_position.user_id and season = p_position.season;
  insert into trades (id, user_id, season, market, side, quantity, entry_price, exit_price, pnl, opened_at, reason)
  values (p_position.id, p_position.user_id, p_position.season, p_position.market, p_position.side, p_position.quantity,
          p_position.entry_price, mark, value, p_position.opened_at, p_reason)
  returning * into result;
  delete from positions where id = p_position.id;
  return result;
end $$;

-- If equity is gone, close everything and floor cash at zero (game-only credit).
create or replace function public.liquidate_if_needed(p_user uuid, p_season date) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  acct accounts;
  pos positions;
begin
  select * into acct from accounts where user_id = p_user and season = p_season for update;
  if not found then return false; end if;
  if acct.cash + unrealized(p_user, p_season) > 0 then return false; end if;
  if not exists (select 1 from positions where user_id = p_user and season = p_season) and acct.cash >= 0 then
    return false;
  end if;
  for pos in select * from positions where user_id = p_user and season = p_season order by opened_at loop
    perform settle_position(pos, 'liquidated');
  end loop;
  update accounts
     set protection_credit = protection_credit + greatest(0, -cash),
         cash = greatest(0, cash),
         liquidations = liquidations + 1
   where user_id = p_user and season = p_season;
  return true;
end $$;

-- Closes positions left over from finished seasons at the latest price.
create or replace function public.settle_old_seasons(p_user uuid default null) returns int
language plpgsql security definer set search_path = public as $$
declare
  pos positions;
  n int := 0;
begin
  for pos in select * from positions
              where season < current_season() and (p_user is null or user_id = p_user)
              for update skip locked loop
    perform settle_position(pos, 'season_end');
    n := n + 1;
  end loop;
  return n;
end $$;

-- Returns (creating if needed) this week's account for a user.
create or replace function public.ensure_account(p_user uuid) returns public.accounts
language plpgsql security definer set search_path = public as $$
declare acct accounts;
begin
  perform settle_old_seasons(p_user);
  insert into accounts (user_id, season) values (p_user, current_season()) on conflict do nothing;
  select * into acct from accounts where user_id = p_user and season = current_season();
  return acct;
end $$;

-- ---------- Player-facing RPCs ---------------------------------------

create or replace function public.claim_handle(p_handle text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  clean text := lower(btrim(p_handle));
begin
  if uid is null then raise exception 'Sign in first.' using errcode = '28000'; end if;
  if clean !~ '^[a-z0-9_]{3,18}$' then
    raise exception 'Handles are 3–18 letters, numbers or underscores.' using errcode = 'P0001';
  end if;
  if exists (select 1 from profiles where handle = clean and id <> uid) then
    raise exception 'That handle is taken.' using errcode = 'P0001';
  end if;
  insert into profiles (id, handle) values (uid, clean)
  on conflict (id) do update set handle = excluded.handle;
  perform ensure_account(uid);
  return jsonb_build_object('id', uid, 'handle', clean);
end $$;

create or replace function public.open_position(p_market public.market, p_side public.trade_side, p_quantity int)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := require_user();
  acct accounts;
  q quotes;
  equity numeric;
  used numeric;
  pos positions;
begin
  if p_quantity not between 1 and 3 then
    raise exception 'Choose 1, 2, or 3 contracts.' using errcode = 'P0001';
  end if;
  perform ensure_account(uid);
  select * into acct from accounts where user_id = uid and season = current_season() for update;
  select * into q from quotes where market = p_market;
  if not found or q.quoted_at < now() - quote_max_age() then
    raise exception 'Market is closed or the price feed is stale. Try again when it''s live.' using errcode = 'P0001';
  end if;
  if (select count(*) from positions where user_id = uid and season = acct.season) >= 10 then
    raise exception 'Max 10 open positions. Close one first.' using errcode = 'P0001';
  end if;
  equity := acct.cash + unrealized(uid, acct.season);
  select coalesce(sum(quantity), 0) * 1000 into used from positions where user_id = uid and season = acct.season;
  if equity - used + 0.000001 < p_quantity * 1000 then
    raise exception 'Not enough practice buying power. Close a position or choose fewer contracts.' using errcode = 'P0001';
  end if;
  insert into positions (user_id, season, market, side, quantity, entry_price)
  values (uid, acct.season, p_market, p_side, p_quantity, q.price)
  returning * into pos;
  return to_jsonb(pos);
end $$;

-- Closing is allowed on the last known price even when the feed is stale,
-- so nobody gets stuck in a trade over a weekend.
create or replace function public.close_position(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := require_user();
  pos positions;
  result trades;
begin
  select * into pos from positions where id = p_id and user_id = uid for update;
  if not found then
    raise exception 'That position is already closed.' using errcode = 'P0001';
  end if;
  perform 1 from accounts where user_id = uid and season = pos.season for update;
  result := settle_position(pos, 'closed');
  perform liquidate_if_needed(uid, pos.season);
  return to_jsonb(result);
end $$;

-- Everything the Trade and You screens need, in one round trip.
create or replace function public.my_state() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := require_user();
  acct accounts := ensure_account(uid);
begin
  return jsonb_build_object(
    'handle',  (select handle from profiles where id = uid),
    'season',  acct.season,
    'season_ends_at', season_ends_at(acct.season),
    'server_time', now(),
    'cash', acct.cash,
    'protection_credit', acct.protection_credit,
    'liquidations', acct.liquidations,
    'has_backup_code', exists (select 1 from account_recovery where user_id = uid),
    'positions', coalesce((select jsonb_agg(to_jsonb(p) order by p.opened_at)
                             from positions p where p.user_id = uid and p.season = acct.season), '[]'::jsonb),
    'trades', coalesce((select jsonb_agg(to_jsonb(t) order by t.closed_at desc)
                          from (select * from trades where user_id = uid and season = acct.season
                                order by closed_at desc limit 50) t), '[]'::jsonb),
    'quotes', coalesce((select jsonb_agg(to_jsonb(q)) from quotes q), '[]'::jsonb)
  );
end $$;

create or replace function public.new_invite_code() returns text
language plpgsql volatile as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  code text;
begin
  loop
    code := '';
    for i in 1..6 loop
      code := code || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from public.squads where invite_code = code);
  end loop;
  return code;
end $$;

create or replace function public.squad_json(p_squad uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', s.id, 'name', s.name, 'invite_code', s.invite_code,
    'owner_id', s.owner_id,
    'member_count', (select count(*) from squad_members m where m.squad_id = s.id))
  from squads s where s.id = p_squad
$$;

create or replace function public.create_squad(p_name text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := require_user();
  sid uuid;
begin
  if char_length(btrim(coalesce(p_name, ''))) not between 1 and 32 then
    raise exception 'Squad names are 1–32 characters.' using errcode = 'P0001';
  end if;
  if (select count(*) from squad_members where user_id = uid) >= 5 then
    raise exception 'You can be in up to 5 squads.' using errcode = 'P0001';
  end if;
  insert into squads (name, invite_code, owner_id) values (btrim(p_name), new_invite_code(), uid) returning id into sid;
  insert into squad_members (squad_id, user_id) values (sid, uid);
  return squad_json(sid);
end $$;

create or replace function public.join_squad(p_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := require_user();
  s squads;
begin
  select * into s from squads where invite_code = upper(btrim(p_code));
  if not found then raise exception 'No squad with that code.' using errcode = 'P0001'; end if;
  if exists (select 1 from squad_members where squad_id = s.id and user_id = uid) then
    return squad_json(s.id);
  end if;
  if (select count(*) from squad_members where user_id = uid) >= 5 then
    raise exception 'You can be in up to 5 squads.' using errcode = 'P0001';
  end if;
  if (select count(*) from squad_members where squad_id = s.id) >= 20 then
    raise exception 'That squad is full (20 max).' using errcode = 'P0001';
  end if;
  insert into squad_members (squad_id, user_id) values (s.id, uid);
  return squad_json(s.id);
end $$;

create or replace function public.leave_squad(p_squad uuid) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user();
begin
  delete from squad_members where squad_id = p_squad and user_id = uid;
  -- Hand ownership on, or remove an empty squad.
  if not exists (select 1 from squad_members where squad_id = p_squad) then
    delete from squads where id = p_squad;
  elsif (select owner_id from squads where id = p_squad) = uid then
    update squads set owner_id = (select user_id from squad_members where squad_id = p_squad order by joined_at limit 1)
     where id = p_squad;
  end if;
end $$;

create or replace function public.my_squads() returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user();
begin
  return coalesce((select jsonb_agg(squad_json(m.squad_id) order by m.joined_at)
                     from squad_members m where m.user_id = uid), '[]'::jsonb);
end $$;

create or replace function public.require_member(p_squad uuid) returns uuid
language plpgsql stable security definer set search_path = public as $$
declare uid uuid := require_user();
begin
  if not exists (select 1 from squad_members where squad_id = p_squad and user_id = uid) then
    raise exception 'You''re not in that squad.' using errcode = '42501';
  end if;
  return uid;
end $$;

-- This week's standings. Return and worst trade sit side by side so one
-- lucky oversized trade doesn't tell the whole story.
create or replace function public.squad_leaderboard(p_squad uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_member(p_squad);
begin
  return coalesce((
    select jsonb_agg(row_to_json(r) order by r.equity desc, r.handle)
    from (
      select p.handle,
             p.id = uid as is_you,
             round(coalesce(a.cash, 10000) + unrealized(p.id, current_season()), 2) as equity,
             round((coalesce(a.cash, 10000) + unrealized(p.id, current_season()) - 10000) / 100, 2) as return_pct,
             (select count(*) from trades t where t.user_id = p.id and t.season = current_season()) as trades,
             (select coalesce(min(t.pnl), 0) from trades t where t.user_id = p.id and t.season = current_season()) as worst_trade,
             (select count(*) from positions o where o.user_id = p.id and o.season = current_season()) as open_positions
      from squad_members m
      join profiles p on p.id = m.user_id
      left join accounts a on a.user_id = p.id and a.season = current_season()
      where m.squad_id = p_squad
    ) r), '[]'::jsonb);
end $$;

-- "The pit": what your squad has been doing this week.
create or replace function public.squad_feed(p_squad uuid, p_limit int default 30) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_member(p_squad);
begin
  return coalesce((
    select jsonb_agg(row_to_json(e) order by e.at desc)
    from (
      select * from (
        select 'closed'::text as kind, t.id, p.handle, p.id = uid as is_you, t.market, t.side, t.quantity,
               t.exit_price as price, t.pnl, t.reason, t.closed_at as at
        from trades t join squad_members m on m.user_id = t.user_id and m.squad_id = p_squad
        join profiles p on p.id = t.user_id
        where t.season = current_season()
        union all
        select 'opened', o.id, p.handle, p.id = uid, o.market, o.side, o.quantity,
               o.entry_price, null, null, o.opened_at
        from positions o join squad_members m on m.user_id = o.user_id and m.squad_id = p_squad
        join profiles p on p.id = o.user_id
        where o.season = current_season()
      ) all_events order by at desc limit greatest(1, least(p_limit, 100))
    ) e), '[]'::jsonb);
end $$;

-- OHLC candles from stored ticks. `bucket` is epoch seconds / bucket size,
-- so a finished candle keeps the same index forever.
create or replace function public.candles(p_market public.market, p_bucket_seconds int default 60, p_limit int default 60)
returns jsonb
language sql stable security definer set search_path = public as $$
  with params as (
    select greatest(10, least(p_bucket_seconds, 3600)) as size, greatest(5, least(p_limit, 240)) as n
  ), ticks as (
    select floor(extract(epoch from t.quoted_at) / params.size)::bigint as bucket, t.price, t.quoted_at
    from quote_ticks t, params
    where t.market = p_market
      and t.quoted_at >= now() - make_interval(secs => params.size * params.n * 3)
  ), bars as (
    select bucket,
           (array_agg(price order by quoted_at asc))[1]  as open,
           max(price) as high, min(price) as low,
           (array_agg(price order by quoted_at desc))[1] as close
    from ticks group by bucket
  )
  select coalesce(jsonb_agg(jsonb_build_object('index', bucket, 'open', open, 'high', high, 'low', low, 'close', close)
                             order by bucket), '[]'::jsonb)
  from (select * from bars order by bucket desc limit (select n from params)) last_bars
$$;

-- Used by the voice-token function: confirms membership and returns your handle.
create or replace function public.voice_identity(p_squad uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_member(p_squad);
begin
  return jsonb_build_object('user_id', uid, 'handle', (select handle from profiles where id = uid));
end $$;

-- ---------- Backup codes ----------------------------------------------

create or replace function public.normalize_code(p_code text) returns text
language sql immutable as $$ select upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g')) $$;

create or replace function public.hash_code(p_code text) returns text
language sql immutable as $$ select encode(sha256(convert_to(public.normalize_code(p_code), 'UTF8')), 'hex') $$;

-- Issues a fresh code (the old one stops working). Shown to the player once.
create or replace function public.issue_backup_code() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := require_user();
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  raw text := '';
  code text;
begin
  for i in 1..12 loop
    raw := raw || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
  end loop;
  code := 'BRK-' || substr(raw, 1, 4) || '-' || substr(raw, 5, 4) || '-' || substr(raw, 9, 4);
  insert into account_recovery (user_id, code_hash) values (uid, hash_code(code))
  on conflict (user_id) do update set code_hash = excluded.code_hash, created_at = now();
  return jsonb_build_object('code', code);
end $$;

-- On a new phone: sign in fresh, then hand over handle + code to take the old
-- account (balance, trades, squads) onto this login. Returns a new code.
create or replace function public.restore_account(p_handle text, p_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  old_id uuid;
begin
  if uid is null then raise exception 'Sign in first.' using errcode = '28000'; end if;
  if exists (select 1 from profiles where id = uid) then
    raise exception 'This phone already has a Brokie account.' using errcode = 'P0001';
  end if;
  -- Failed tries RETURN an error instead of raising it, so the attempt row
  -- commits and the rate limit actually counts.
  if (select count(*) from recovery_attempts where user_id = uid and at > now() - interval '10 minutes') >= 5 then
    return jsonb_build_object('ok', false, 'error', 'Too many tries. Wait 10 minutes.');
  end if;
  insert into recovery_attempts (user_id) values (uid);
  select p.id into old_id
    from profiles p join account_recovery r on r.user_id = p.id
   where p.handle = lower(btrim(coalesce(p_handle, ''))) and r.code_hash = hash_code(p_code);
  if old_id is null then
    return jsonb_build_object('ok', false, 'error', 'That handle and backup code don''t match.');
  end if;
  update profiles set id = uid where id = old_id;   -- cascades to every table
  delete from recovery_attempts where user_id = uid;
  return jsonb_build_object('ok', true, 'handle', (select handle from profiles where id = uid)) || issue_backup_code();
end $$;

-- ---------- Server-only: price ingestion ------------------------------

-- The price-feed function proves it was called by our own cron job.
create or replace function public.check_cron_secret(p_secret text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from brokie_private where key = 'cron_secret' and value = p_secret)
$$;
-- Called by the ingest-quotes edge function with the service role key.
-- p_quotes: [{"market":"gold","price":4012.35,"quoted_at":"2026-10-21T00:00:00Z","source":"oanda"}]
create or replace function public.ingest_quotes(p_quotes jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  item jsonb;
  m markets;
  px numeric;
  at timestamptz;
  accepted int := 0;
  liquidated int := 0;
  acct record;
begin
  for item in select * from jsonb_array_elements(coalesce(p_quotes, '[]'::jsonb)) loop
    m := null;
    select * into m from markets where id::text = item->>'market';
    px := (item->>'price')::numeric;
    at := coalesce((item->>'quoted_at')::timestamptz, now());
    continue when m.id is null or px is null or px <= 0 or px > 10000000 or at > now() + interval '5 seconds';
    px := round(px / m.tick_size) * m.tick_size;
    insert into quote_ticks (market, price, quoted_at) values (m.id, px, at);
    insert into quotes (market, price, source, quoted_at, updated_at)
    values (m.id, px, coalesce(item->>'source', 'feed'), at, now())
    on conflict (market) do update
      set price = excluded.price, source = excluded.source, quoted_at = excluded.quoted_at, updated_at = now()
      where quotes.quoted_at <= excluded.quoted_at;
    accepted := accepted + 1;
  end loop;

  for acct in select distinct user_id, season from positions where season = current_season() loop
    if liquidate_if_needed(acct.user_id, acct.season) then liquidated := liquidated + 1; end if;
  end loop;
  perform settle_old_seasons(null);
  delete from quote_ticks where quoted_at < now() - interval '3 days';
  return jsonb_build_object('accepted', accepted, 'liquidated', liquidated);
end $$;

-- ---------- Permissions ----------------------------------------------
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in (
      'quote_max_age','current_season','season_ends_at','require_user','direction','unrealized','settle_position',
      'liquidate_if_needed','settle_old_seasons','ensure_account','claim_handle','open_position','close_position',
      'my_state','new_invite_code','squad_json','create_squad','join_squad','leave_squad','my_squads','require_member',
      'squad_leaderboard','squad_feed','candles','voice_identity','ingest_quotes',
      'normalize_code','hash_code','issue_backup_code','restore_account','check_cron_secret')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
  end loop;
end $$;

grant execute on function
  public.claim_handle(text), public.open_position(public.market, public.trade_side, int), public.close_position(uuid),
  public.my_state(), public.create_squad(text), public.join_squad(text), public.leave_squad(uuid), public.my_squads(),
  public.squad_leaderboard(uuid), public.squad_feed(uuid, int), public.candles(public.market, int, int),
  public.voice_identity(uuid), public.current_season(), public.issue_backup_code(), public.restore_account(text, text)
to authenticated;
grant execute on function public.candles(public.market, int, int), public.current_season() to anon;
grant execute on function public.ingest_quotes(jsonb), public.check_cron_secret(text) to service_role;
