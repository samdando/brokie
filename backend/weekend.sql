-- Weekend paper trading, scheduled settlement, daily scoreboards and private reviews.
-- Requires the current schema, trading_day, rules_v4, funded, bars and weekend_markets.
begin;
insert into public.markets(id,point_value,tick_size,instrument) values
 ('btc',0.01,0.01,'BTC-USD'),('eth',0.1,0.01,'ETH-USD'),('sol',1,0.01,'SOL-USD')
on conflict(id) do update set point_value=excluded.point_value,tick_size=excluded.tick_size,instrument=excluded.instrument;
alter table public.trades drop constraint if exists trades_reason_check;
alter table public.trades add constraint trades_reason_check check
 (reason in ('closed','liquidated','season_end','daily_limit','blown','reset','sl_fix','rules_fix','market_close','prediction_settled'));
alter table public.trades add column if not exists exit_quoted_at timestamptz;

create or replace function public.is_crypto(p_market public.market) returns boolean
language sql immutable as $$ select p_market::text in ('btc','eth','sol') $$;
create or replace function public.weekend_mode(p_at timestamptz default now()) returns boolean
language sql stable as $$
 select extract(isodow from p_at at time zone 'America/New_York')=6
 or (extract(isodow from p_at at time zone 'America/New_York')=5 and (p_at at time zone 'America/New_York')::time >= time '17:00')
 or (extract(isodow from p_at at time zone 'America/New_York')=7 and (p_at at time zone 'America/New_York')::time < time '18:00')
$$;
create or replace function public.market_session_open(p_market public.market,p_at timestamptz default now()) returns boolean
language sql stable as $$
 select case when is_crypto(p_market) then weekend_mode(p_at) else
 not weekend_mode(p_at) and ((p_at at time zone 'America/New_York')::time < time '17:00'
 or (p_at at time zone 'America/New_York')::time >= time '18:00') end
$$;
-- Brokie's flat-at-close rule: weekdays at 17:00 NY; weekend crypto at Sunday 18:00 NY.
-- Uses the named timezone rather than UTC offsets so DST is automatic.
create or replace function public.position_session_end(p_market public.market,p_opened timestamptz) returns timestamptz
language plpgsql stable as $$
declare local_open timestamp := p_opened at time zone 'America/New_York'; d date := local_open::date;
begin
 if is_crypto(p_market) then
   d := d + ((7-extract(isodow from d)::int)%7);
   if d + time '18:00' <= local_open then d:=d+7; end if;
   return (d+time '18:00') at time zone 'America/New_York';
 end if;
 if local_open::time >= time '17:00' then d:=d+1; end if;
 while extract(isodow from d) in (6,7) loop d:=d+1; end loop;
 return (d+time '17:00') at time zone 'America/New_York';
end $$;
alter table public.positions add column if not exists session_closes_at timestamptz;
update public.positions set session_closes_at=public.position_session_end(market,opened_at) where session_closes_at is null;
create index if not exists positions_session_close on public.positions(session_closes_at);

-- An authenticated client cannot pick the session time or bypass the calendar.
create or replace function public.set_position_session() returns trigger
language plpgsql security definer set search_path=public as $$
begin
 if not market_session_open(new.market,now()) then raise exception 'This market session is closed.'; end if;
 if exists(select 1 from positions where user_id=new.user_id and session_closes_at<=now()) then
   raise exception 'A previous session is awaiting settlement. Please try again shortly.';
 end if;
 new.session_closes_at:=position_session_end(new.market,new.opened_at);
 return new;
end $$;
drop trigger if exists set_position_session on public.positions;
create trigger set_position_session before insert on public.positions for each row execute function public.set_position_session();

-- Runs without quotes arriving or clients connected. Never uses a reopening price.
-- If no reliable closing-session mark exists, leave the position pending for investigation.
create or replace function public.settle_market_closes(p_now timestamptz default now()) returns jsonb
language plpgsql security definer set search_path=public as $$
declare a accounts; p positions; mark numeric; quote_time timestamptz; value numeric; n int:=0; pending int:=0;
begin
 for a in select * from accounts x where exists(select 1 from positions o where o.user_id=x.user_id
   and o.season=x.season and o.session_closes_at<=p_now) order by user_id,season for update skip locked loop
   for p in select * from positions where user_id=a.user_id and season=a.season and session_closes_at<=p_now
     order by session_closes_at,id for update loop
     mark:=null; quote_time:=null;
     select x.price,x.at into mark,quote_time from (
       select q.price,q.quoted_at as at from quotes q where q.market=p.market
       union all select t.price,t.quoted_at from quote_ticks t where t.market=p.market
         and t.quoted_at>=p.session_closes_at-interval '5 minutes' and t.quoted_at<=p.session_closes_at
       union all select b.close,b.last_at from bars b where b.market=p.market and b.secs=60
         and b.idx between floor(extract(epoch from p.session_closes_at-interval '5 minutes')/60)::bigint
                       and floor(extract(epoch from p.session_closes_at)/60)::bigint
     ) x where x.at<=p.session_closes_at and x.at>=p.session_closes_at-interval '5 minutes'
       and x.at>=p.opened_at order by x.at desc limit 1;
     if mark is null then pending:=pending+1; continue; end if;
     select (mark-p.entry_price)*m.point_value*p.quantity*direction(p.side) into value from markets m where m.id=p.market;
     insert into trades(id,user_id,season,market,side,quantity,entry_price,exit_price,pnl,opened_at,closed_at,reason,exit_quoted_at)
       values(p.id,p.user_id,p.season,p.market,p.side,p.quantity,p.entry_price,mark,value,p.opened_at,p.session_closes_at,'market_close',quote_time);
     update accounts set cash=cash+value where user_id=p.user_id and season=p.season;
     delete from positions where id=p.id;
     n:=n+1;
   end loop;
   if not exists(select 1 from positions where user_id=a.user_id and season=a.season and session_closes_at<=p_now) then
     perform enforce_rules(a.user_id,a.season);
   end if;
 end loop;
 return jsonb_build_object('settled',n,'pending',pending);
end $$;
revoke all on function public.settle_market_closes(timestamptz),public.set_position_session() from public,anon,authenticated;

-- Prevent a manual close after the deadline from substituting a later/reopening mark.
-- Automatic settlement removes the position; manual attempts can retry after the next job.
create or replace function public.guard_session_exit() returns trigger
language plpgsql security definer set search_path=public as $$
begin
 if new.reason <> 'market_close' and exists(select 1 from positions p where p.user_id=new.user_id
   and p.market=new.market and p.side=new.side and p.opened_at=new.opened_at and p.session_closes_at<=now()) then
   raise exception 'Session ended. This position is awaiting its market-close receipt.';
 end if;
 return new;
end $$;
drop trigger if exists guard_session_exit on public.trades;
create trigger guard_session_exit before insert on public.trades for each row execute function public.guard_session_exit();
revoke all on function public.guard_session_exit() from public,anon,authenticated;

-- A close on the session boundary belongs to the session that just finished.
create or replace function public.receipt_day(p_closed timestamptz,p_reason text) returns date
language sql stable as $$ select trading_day_of(p_closed-case when p_reason='market_close' then interval '1 microsecond' else interval '0' end) $$;
create index if not exists trades_daily on public.trades(closed_at,user_id);
create or replace function public.daily_leaderboard(p_day date default null,p_squad uuid default null) returns jsonb
language plpgsql security definer set search_path=public as $$
declare uid uuid:=require_user(); d date:=coalesce(p_day,trading_today()); result jsonb;
begin
 if p_squad is not null then perform require_member(p_squad); end if;
 if d>trading_today() or d<trading_today()-365 then raise exception 'Choose a date within the past year.'; end if;
 select coalesce(jsonb_agg(to_jsonb(r) order by r.pnl desc,r.handle),'[]'::jsonb) into result from (
   select p.handle,p.id=uid as is_you,coalesce(round(sum(t.pnl),2),0) as pnl,
     count(t.id) as trades,count(t.id) filter(where t.pnl>0) as wins,count(t.id) filter(where t.pnl<0) as losses,
     count(t.id) filter(where t.pnl=0) as breakevens
   from profiles p left join trades t on t.user_id=p.id and receipt_day(t.closed_at,t.reason)=d
   where case when p_squad is not null then exists(select 1 from squad_members m where m.squad_id=p_squad and m.user_id=p.id)
     else (p.show_global or p.id=uid) and exists(select 1 from accounts a where a.user_id=p.id) end
   group by p.id,p.handle
 ) r;
 return jsonb_build_object('day',d,'today',trading_today(),'rows',result,'timezone','America/New_York','reset_hour',17);
end $$;

create or replace function public.daily_receipts(p_handle text,p_day date,p_squad uuid default null) returns jsonb
language plpgsql security definer set search_path=public as $$
declare uid uuid:=require_user(); owner uuid; visible boolean;
begin
 select id,show_global into owner,visible from profiles where handle=lower(p_handle);
 if owner is null then raise exception 'Player not found.'; end if;
 if p_squad is not null then
   perform require_member(p_squad);
   if not exists(select 1 from squad_members where squad_id=p_squad and user_id=owner) then raise exception 'Player is not in this squad.'; end if;
 elsif owner<>uid and not coalesce(visible,false) then raise exception 'This player is private.'; end if;
 if p_day>trading_today() or p_day<trading_today()-365 then raise exception 'Choose a date within the past year.'; end if;
 return coalesce((select jsonb_agg(to_jsonb(t) order by t.closed_at desc) from (
   select id,market,side,quantity,entry_price,exit_price,pnl,opened_at,closed_at,reason
   from trades where user_id=owner and receipt_day(closed_at,reason)=p_day
 ) t),'[]'::jsonb);
end $$;

create table if not exists public.trade_notes (
 trade_id uuid primary key references public.trades(id) on delete cascade,
 user_id uuid not null references public.profiles(id) on update cascade on delete cascade,
 note text not null check(length(note)<=2000),updated_at timestamptz not null default now()
);
alter table public.trade_notes enable row level security;
revoke all on public.trade_notes from anon,authenticated;
create or replace function public.save_trade_note(p_trade uuid,p_note text) returns void
language plpgsql security definer set search_path=public as $$
declare uid uuid:=require_user();
begin
 if not exists(select 1 from trades where id=p_trade and user_id=uid) then raise exception 'Trade not found.'; end if;
 if length(coalesce(p_note,''))>2000 then raise exception 'Notes must be under 2000 characters.'; end if;
 insert into trade_notes(trade_id,user_id,note) values(p_trade,uid,coalesce(p_note,''))
 on conflict(trade_id) do update set note=excluded.note,updated_at=now();
end $$;
create or replace function public.review_trade(p_trade uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare uid uuid:=require_user(); t trades; size int; data jsonb;
begin
 select * into t from trades where id=p_trade and user_id=uid;
 if not found then raise exception 'Trade not found.'; end if;
 size:=case when t.closed_at-t.opened_at>interval '7 days' then 86400 when t.closed_at-t.opened_at>interval '6 hours' then 3600 else 60 end;
 select coalesce(jsonb_agg(jsonb_build_object('index',b.idx,'open',b.open,'high',b.high,'low',b.low,'close',b.close) order by b.idx),'[]'::jsonb)
 into data from bars b where b.market=t.market and b.secs=size
   and b.idx between floor(extract(epoch from t.opened_at)/size)::bigint-3 and floor(extract(epoch from t.closed_at)/size)::bigint+3;
 return jsonb_build_object('trade',to_jsonb(t),'candles',data,'bucket_seconds',size,
   'note',coalesce((select note from trade_notes where trade_id=t.id),''));
end $$;
revoke all on function public.daily_leaderboard(date,uuid),public.daily_receipts(text,date,uuid),public.review_trade(uuid),public.save_trade_note(uuid,text) from public,anon;
grant execute on function public.daily_leaderboard(date,uuid),public.daily_receipts(text,date,uuid),public.review_trade(uuid),public.save_trade_note(uuid,text) to authenticated;
create or replace function public.enforce_rules(p_user uuid, p_season date) returns text
language plpgsql security definer set search_path = public as $$
declare
  a accounts;
  eq numeric;
  today date := trading_today();
begin
  select * into a from accounts where user_id = p_user and season = p_season for update;
  if not found then return null; end if;
  -- Freeze risk checks until overdue positions have an authentic closing receipt.
  if exists(select 1 from positions where user_id=p_user and season=p_season and session_closes_at<=now()) then return a.status; end if;
  eq := a.cash + unrealized(p_user, p_season);

  -- New session (5pm New York). Equity at the rollover is yesterday's closing balance:
  -- it can raise the end-of-day high, then gets a fresh daily-loss allowance. A locked account unlocks.
  if a.trading_day is distinct from today then
    update accounts set trading_day = today, day_start_equity = eq,
                        eod_peak = greatest(coalesce(eod_peak, start_balance), eq),
                        status = case when status = 'locked' then 'active' else status end
     where user_id = p_user and season = p_season returning * into a;
  end if;
  if a.status = 'blown' then return 'blown'; end if;

  -- The intraday peak is still tracked for stats and for the trailing hard mode.
  if eq > a.peak_equity then
    update accounts set peak_equity = eq where user_id = p_user and season = p_season returning * into a;
  end if;
  update accounts set worst_drawdown = greatest(worst_drawdown, round((1 - eq / nullif(a.peak_equity, 0)) * 100, 4))
   where user_id = p_user and season = p_season;

  -- Max loss limit -> blown for the season.
  if eq <= dd_floor(a) then
    perform close_all(p_user, p_season, 'blown');
    update accounts set status = 'blown', blown_at = now(),
                        protection_credit = protection_credit + greatest(0, -cash), cash = greatest(0, cash)
     where user_id = p_user and season = p_season;
    return 'blown';
  end if;

  -- Daily loss -> locked until the next session.
  if a.status = 'active' and eq <= a.day_start_equity * (1 - a.daily_loss_pct / 100) then
    perform close_all(p_user, p_season, 'daily_limit');
    update accounts set status = 'locked', locked_at = now() where user_id = p_user and season = p_season;
    return 'locked';
  end if;

  -- Profit target -> 🎯 target hit (sticky). Funded needs the target AND 5 trading days, checked
  -- together: equity has to be at +10% on a check after the fifth trading day. Sticky for the season.
  if eq >= a.start_balance * 1.10 then
    if a.target_hit_at is null then
      update accounts set target_hit_at = now() where user_id = p_user and season = p_season;
    end if;
    if a.funded_at is null and trading_days(p_user, p_season) >= 5 then
      update accounts set funded_at = now() where user_id = p_user and season = p_season;
    end if;
  end if;
  return a.status;
end $$;
create or replace function public.ingest_quotes(p_quotes jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  item jsonb;
  m markets;
  px numeric;
  at timestamptz;
  accepted int := 0;
  breached int := 0;
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

  perform settle_market_closes();
  for acct in select distinct user_id, season from positions where season = current_season() loop
    if enforce_rules(acct.user_id, acct.season) <> 'active' then breached := breached + 1; end if;
  end loop;
  perform settle_old_seasons(null);
  delete from quote_ticks where quoted_at < now() - interval '3 days';
  return jsonb_build_object('accepted', accepted, 'liquidated', breached);
end $$;
create or replace function public.settle_old_seasons(p_user uuid default null) returns int
language plpgsql security definer set search_path=public as $$
declare a accounts; pos positions; n int:=0;
begin
 for a in select * from accounts x where x.season<current_season() and (p_user is null or x.user_id=p_user)
   and exists(select 1 from positions o where o.user_id=x.user_id and o.season=x.season)
   order by user_id,season for update skip locked loop
  for pos in select * from positions where user_id=a.user_id and season=a.season
   and (session_closes_at is null or session_closes_at>now()) for update loop
   perform settle_position(pos,'season_end'); n:=n+1;
  end loop;
 end loop;
 return n;
end $$;
create or replace function public.squad_leaderboard(p_squad uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_member(p_squad);
begin
  return coalesce((
    select jsonb_agg(row_to_json(r) order by r.qualified desc, r.equity desc, r.handle)
    from (
      select p.handle,
             (select coalesce(round(sum(t.pnl),2),0) from trades t where t.user_id=p.id and receipt_day(t.closed_at,t.reason)=trading_today()) as today_pnl,
             p.id = uid as is_you,
             round(coalesce(a.cash, starting_balance()) + unrealized(p.id, current_season()), 2) as equity,
             round((coalesce(a.cash, starting_balance()) + unrealized(p.id, current_season()) - coalesce(a.start_balance, starting_balance()))
                   / coalesce(a.start_balance, starting_balance()) * 100, 2) as return_pct,
             (select count(*) from trades t where t.user_id = p.id and t.season = current_season()) as trades,
             (select coalesce(min(t.pnl), 0) from trades t where t.user_id = p.id and t.season = current_season()) as worst_trade,
             (select count(*) from trades t where t.user_id = p.id and t.season = current_season() and t.pnl > 0) as wins,
             (select count(*) from trades t where t.user_id = p.id and t.season = current_season() and t.pnl < 0) as losses,
             (select count(*) from positions o where o.user_id = p.id and o.season = current_season()) as open_positions,
             coalesce(a.status, 'active') as status,
             a.funded_at is not null as funded,
             a.target_hit_at is not null as target_hit,
             coalesce(a.resets_used, 0) as resets_used,
             trading_days(p.id, current_season()) as trading_days,
             trading_days(p.id, current_season()) >= 5 as qualified,
             coalesce(a.worst_drawdown, 0) as worst_drawdown
      from squad_members m
      join profiles p on p.id = m.user_id
      left join accounts a on a.user_id = p.id and a.season = current_season()
      where m.squad_id = p_squad
    ) r), '[]'::jsonb);
end $$;
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
           (select coalesce(round(sum(t.pnl),2),0) from trades t where t.user_id=p.id and receipt_day(t.closed_at,t.reason)=trading_today()) as today_pnl,
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
           g.qualified, g.trading_days, g.trades, g.today_pnl
    from _gl g where g.show_global or g.id = uid
    order by g.rank limit lim
  ) r;

  select to_jsonb(r) into me from (
    select g.rank, g.handle, true as is_you, g.equity, g.return_pct, g.status, g.funded,
           g.qualified, g.trading_days, g.trades, g.today_pnl, g.show_global
    from _gl g where g.id = uid
  ) r;

  drop table _gl;
  return jsonb_build_object('rows', rows, 'me', me, 'players', total, 'season', current_season());
end $$;
commit;
