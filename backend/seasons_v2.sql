-- =====================================================================
-- Brokie Seasons v2: 8-week prop-firm challenges.
-- Run AFTER schema.sql (safe to re-run).
--
-- Rules (all enforced here, on the server, never trusted from the app):
--   * Season = 8 weeks, starts Monday 00:00 Brisbane. Everyone gets $100,000.
--   * Max daily loss 5% of start-of-day equity -> everything closes, trading
--     locks until the next Brisbane day.
--   * Max drawdown 10% trailing from peak equity -> everything closes, account
--     is BLOWN (REKT) for the season.
--   * +10% equity -> FUNDED badge (keep trading).
--   * 5 distinct trading days to qualify for the season leaderboard.
--   * One buy-back reset per season after blowing, on tougher 4% / 8% rules.
-- "Trading day" = calendar day in Australia/Brisbane (UTC+10, no DST).
-- =====================================================================

-- ---------- Season calendar --------------------------------------------
create or replace function public.season_length_days() returns int language sql immutable as $$ select 56 $$;
create or replace function public.season_anchor() returns date language sql immutable as $$ select date '2026-10-19' $$;
create or replace function public.starting_balance() returns numeric language sql immutable as $$ select 100000::numeric $$;
create or replace function public.brisbane_today() returns date language sql stable as $$ select (now() at time zone 'Australia/Brisbane')::date $$;

create or replace function public.current_season() returns date
language sql stable as $$
  select season_anchor() + (floor((brisbane_today() - season_anchor())::numeric / season_length_days()) * season_length_days())::int
$$;

create or replace function public.season_ends_at(p_season date) returns timestamptz
language sql stable as $$
  select ((p_season + season_length_days())::timestamp) at time zone 'Australia/Brisbane'
$$;

create or replace function public.season_number(p_season date) returns int
language sql immutable as $$ select 1 + ((p_season - date '2026-10-19') / 56) $$;

-- ---------- Account columns --------------------------------------------
alter table public.accounts alter column cash set default 100000;
alter table public.accounts add column if not exists peak_equity      numeric not null default 100000;
alter table public.accounts add column if not exists day_start_equity numeric not null default 100000;
alter table public.accounts add column if not exists trading_day      date;
alter table public.accounts add column if not exists status           text not null default 'active';
alter table public.accounts add column if not exists daily_loss_pct   numeric not null default 5;
alter table public.accounts add column if not exists max_dd_pct       numeric not null default 10;
alter table public.accounts add column if not exists start_balance    numeric not null default 100000;
alter table public.accounts add column if not exists funded_at        timestamptz;
alter table public.accounts add column if not exists blown_at         timestamptz;
alter table public.accounts add column if not exists locked_at        timestamptz;
alter table public.accounts add column if not exists resets_used      int not null default 0;
alter table public.accounts add column if not exists worst_drawdown   numeric not null default 0;  -- % from peak
alter table public.accounts add column if not exists rules_version    int not null default 1;

do $$ begin
  alter table public.accounts add constraint accounts_status_check check (status in ('active', 'locked', 'blown'));
exception when duplicate_object then null; end $$;

alter table public.positions drop constraint if exists positions_quantity_check;
alter table public.positions add constraint positions_quantity_check check (quantity between 1 and 10);

alter table public.trades drop constraint if exists trades_reason_check;
alter table public.trades add constraint trades_reason_check
  check (reason in ('closed', 'liquidated', 'season_end', 'daily_limit', 'blown', 'reset'));

-- One-time move of this season's accounts from the old $10k weekly game to $100k.
update public.accounts
   set cash = cash + 90000, start_balance = 100000,
       peak_equity = greatest(100000, cash + 90000), day_start_equity = cash + 90000,
       rules_version = 2
 where rules_version = 1 and season = public.current_season();
update public.accounts set rules_version = 2 where rules_version = 1;

-- ---------- Rule engine ------------------------------------------------

-- Closes every open position for an account with a reason.
create or replace function public.close_all(p_user uuid, p_season date, p_reason text) returns int
language plpgsql security definer set search_path = public as $$
declare pos positions; n int := 0;
begin
  for pos in select * from positions where user_id = p_user and season = p_season order by opened_at loop
    perform settle_position(pos, p_reason);
    n := n + 1;
  end loop;
  return n;
end $$;

-- Rolls the trading day, tracks the peak, and applies daily-loss, drawdown
-- and funded rules. Returns the account's status afterwards.
create or replace function public.enforce_rules(p_user uuid, p_season date) returns text
language plpgsql security definer set search_path = public as $$
declare
  a accounts;
  eq numeric;
  today date := brisbane_today();
begin
  select * into a from accounts where user_id = p_user and season = p_season for update;
  if not found then return null; end if;
  eq := a.cash + unrealized(p_user, p_season);

  -- New Brisbane day: fresh daily-loss allowance; a locked account unlocks.
  if a.trading_day is distinct from today then
    update accounts set trading_day = today, day_start_equity = eq,
                        status = case when status = 'locked' then 'active' else status end
     where user_id = p_user and season = p_season returning * into a;
  end if;
  if a.status = 'blown' then return 'blown'; end if;

  if eq > a.peak_equity then
    update accounts set peak_equity = eq where user_id = p_user and season = p_season returning * into a;
  end if;
  update accounts set worst_drawdown = greatest(worst_drawdown, round((1 - eq / nullif(a.peak_equity, 0)) * 100, 4))
   where user_id = p_user and season = p_season;

  -- Trailing max drawdown -> blown for the season.
  if eq <= a.peak_equity * (1 - a.max_dd_pct / 100) then
    perform close_all(p_user, p_season, 'blown');
    update accounts set status = 'blown', blown_at = now(),
                        protection_credit = protection_credit + greatest(0, -cash), cash = greatest(0, cash)
     where user_id = p_user and season = p_season;
    return 'blown';
  end if;

  -- Daily loss -> locked until tomorrow.
  if a.status = 'active' and eq <= a.day_start_equity * (1 - a.daily_loss_pct / 100) then
    perform close_all(p_user, p_season, 'daily_limit');
    update accounts set status = 'locked', locked_at = now() where user_id = p_user and season = p_season;
    return 'locked';
  end if;

  -- Profit target -> funded badge (sticky for the season).
  if a.funded_at is null and eq >= a.start_balance * 1.10 then
    update accounts set funded_at = now() where user_id = p_user and season = p_season;
  end if;
  return a.status;
end $$;

-- The old zero-equity liquidation is replaced by the rule engine.
create or replace function public.liquidate_if_needed(p_user uuid, p_season date) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  return coalesce(enforce_rules(p_user, p_season), 'active') <> 'active';
end $$;

create or replace function public.ensure_account(p_user uuid) returns public.accounts
language plpgsql security definer set search_path = public as $$
declare acct accounts;
begin
  perform settle_old_seasons(p_user);
  insert into accounts (user_id, season, cash, start_balance, peak_equity, day_start_equity, trading_day, rules_version)
  values (p_user, current_season(), starting_balance(), starting_balance(), starting_balance(), starting_balance(), brisbane_today(), 2)
  on conflict do nothing;
  perform enforce_rules(p_user, current_season());
  select * into acct from accounts where user_id = p_user and season = current_season();
  return acct;
end $$;

create or replace function public.trading_days(p_user uuid, p_season date) returns int
language sql stable security definer set search_path = public as $$
  select count(distinct d)::int from (
    select (opened_at at time zone 'Australia/Brisbane')::date as d from trades where user_id = p_user and season = p_season
    union
    select (opened_at at time zone 'Australia/Brisbane')::date from positions where user_id = p_user and season = p_season
  ) days
$$;

-- ---------- Trading ----------------------------------------------------

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
  recent int;
begin
  if p_quantity not between 1 and 10 then
    raise exception 'Choose 1 to 10 contracts.' using errcode = 'P0001';
  end if;
  acct := ensure_account(uid);
  select * into acct from accounts where user_id = uid and season = acct.season for update;
  if acct.status = 'blown' then
    raise exception 'Account blown for this season. 💀 Use your buy-back or wait for next season.' using errcode = 'P0001';
  end if;
  if acct.status = 'locked' then
    raise exception 'Daily loss limit hit. Trading unlocks at midnight Brisbane time.' using errcode = 'P0001';
  end if;
  select count(*) into recent from positions where user_id = uid and opened_at > now() - interval '10 seconds';
  if recent >= 5 then raise exception 'Slow down — max 5 new trades per 10 seconds.' using errcode = 'P0001'; end if;
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
    raise exception 'Not enough buying power. Close a position or choose fewer contracts.' using errcode = 'P0001';
  end if;
  insert into positions (user_id, season, market, side, quantity, entry_price)
  values (uid, acct.season, p_market, p_side, p_quantity, q.price)
  returning * into pos;
  return to_jsonb(pos);
end $$;

create or replace function public.close_position(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := require_user();
  pos positions;
  result trades;
begin
  select * into pos from positions where id = p_id and user_id = uid for update;
  if not found then raise exception 'That position is already closed.' using errcode = 'P0001'; end if;
  perform 1 from accounts where user_id = uid and season = pos.season for update;
  result := settle_position(pos, 'closed');
  perform enforce_rules(uid, pos.season);
  return to_jsonb(result);
end $$;

-- One buy-back per season after blowing: fresh $100k on tougher 4% / 8% rules.
create or replace function public.buy_back() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := require_user();
  a accounts := ensure_account(uid);
begin
  if a.status <> 'blown' then raise exception 'You can only buy back after blowing your account.' using errcode = 'P0001'; end if;
  if a.resets_used >= 1 then raise exception 'You''ve used your one buy-back this season.' using errcode = 'P0001'; end if;
  update accounts set cash = starting_balance(), start_balance = starting_balance(), peak_equity = starting_balance(),
                      day_start_equity = starting_balance(), trading_day = brisbane_today(), status = 'active',
                      daily_loss_pct = 4, max_dd_pct = 8, resets_used = resets_used + 1, funded_at = null,  -- blown_at stays: REKT is public
                      protection_credit = 0, worst_drawdown = 0
   where user_id = uid and season = a.season;
  return jsonb_build_object('ok', true);
end $$;

-- ---------- State for the app -------------------------------------------

create or replace function public.my_state() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := require_user();
  acct accounts := ensure_account(uid);
  eq numeric := acct.cash + unrealized(uid, acct.season);
begin
  return jsonb_build_object(
    'handle',  (select handle from profiles where id = uid),
    'season',  acct.season,
    'season_number', season_number(acct.season),
    'season_ends_at', season_ends_at(acct.season),
    'server_time', now(),
    'cash', acct.cash,
    'protection_credit', acct.protection_credit,
    'liquidations', acct.liquidations,
    'has_backup_code', exists (select 1 from account_recovery where user_id = uid),
    'rules', jsonb_build_object(
      'status', acct.status,
      'start_balance', acct.start_balance,
      'peak_equity', acct.peak_equity,
      'day_start_equity', acct.day_start_equity,
      'daily_loss_pct', acct.daily_loss_pct,
      'max_dd_pct', acct.max_dd_pct,
      'daily_floor', round(acct.day_start_equity * (1 - acct.daily_loss_pct / 100), 2),
      'drawdown_floor', round(acct.peak_equity * (1 - acct.max_dd_pct / 100), 2),
      'target', round(acct.start_balance * 1.10, 2),
      'funded', acct.funded_at is not null,
      'resets_used', acct.resets_used,
      'trading_days', trading_days(uid, acct.season),
      'qualify_days', 5,
      'equity', round(eq, 2)),
    'positions', coalesce((select jsonb_agg(to_jsonb(p) order by p.opened_at)
                             from positions p where p.user_id = uid and p.season = acct.season), '[]'::jsonb),
    'trades', coalesce((select jsonb_agg(to_jsonb(t) order by t.closed_at desc)
                          from (select * from trades where user_id = uid and season = acct.season
                                order by closed_at desc limit 50) t), '[]'::jsonb),
    'quotes', coalesce((select jsonb_agg(to_jsonb(q)) from quotes q), '[]'::jsonb)
  );
end $$;

-- Lifetime stats survive every season reset.
create or replace function public.lifetime_stats(p_handle text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := require_user();
  target uuid := coalesce((select id from profiles where handle = lower(p_handle)), uid);
begin
  return (
    select jsonb_build_object(
      'handle', (select handle from profiles where id = target),
      'total_trades', count(t.*),
      'win_rate', round(100.0 * count(*) filter (where t.pnl > 0) / nullif(count(t.*), 0), 1),
      'avg_win', round(avg(t.pnl) filter (where t.pnl > 0), 2),
      'avg_loss', round(avg(t.pnl) filter (where t.pnl < 0), 2),
      'best_trade', max(t.pnl),
      'seasons_played', (select count(*) from accounts a where a.user_id = target),
      'seasons_blown', (select count(*) from accounts a where a.user_id = target and (a.status = 'blown' or a.resets_used > 0)),
      'seasons_funded', (select count(*) from accounts a where a.user_id = target and a.funded_at is not null),
      'max_drawdown', (select coalesce(max(worst_drawdown), 0) from accounts a where a.user_id = target),
      'seasons', coalesce((select jsonb_agg(jsonb_build_object(
                    'season', a.season, 'number', season_number(a.season),
                    'return_pct', round((a.cash + unrealized(a.user_id, a.season) - a.start_balance) / a.start_balance * 100, 2),
                    'status', a.status, 'funded', a.funded_at is not null) order by a.season)
                  from accounts a where a.user_id = target), '[]'::jsonb))
    from trades t where t.user_id = target);
end $$;

-- ---------- Squad views --------------------------------------------------

create or replace function public.squad_leaderboard(p_squad uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_member(p_squad);
begin
  return coalesce((
    select jsonb_agg(row_to_json(r) order by r.qualified desc, r.equity desc, r.handle)
    from (
      select p.handle,
             p.id = uid as is_you,
             round(coalesce(a.cash, starting_balance()) + unrealized(p.id, current_season()), 2) as equity,
             round((coalesce(a.cash, starting_balance()) + unrealized(p.id, current_season()) - coalesce(a.start_balance, starting_balance()))
                   / coalesce(a.start_balance, starting_balance()) * 100, 2) as return_pct,
             (select count(*) from trades t where t.user_id = p.id and t.season = current_season()) as trades,
             (select coalesce(min(t.pnl), 0) from trades t where t.user_id = p.id and t.season = current_season()) as worst_trade,
             (select count(*) from positions o where o.user_id = p.id and o.season = current_season()) as open_positions,
             coalesce(a.status, 'active') as status,
             a.funded_at is not null as funded,
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
        union all
        select 'rekt', gen_random_uuid(), p.handle, p.id = uid, 'nas'::market, 'long'::trade_side, 0,
               0, null, null, a.blown_at
        from accounts a join squad_members m on m.user_id = a.user_id and m.squad_id = p_squad
        join profiles p on p.id = a.user_id
        where a.season = current_season() and a.blown_at is not null
        union all
        select 'funded', gen_random_uuid(), p.handle, p.id = uid, 'nas'::market, 'long'::trade_side, 0,
               0, null, null, a.funded_at
        from accounts a join squad_members m on m.user_id = a.user_id and m.squad_id = p_squad
        join profiles p on p.id = a.user_id
        where a.season = current_season() and a.funded_at is not null
      ) all_events order by at desc limit greatest(1, least(p_limit, 100))
    ) e), '[]'::jsonb);
end $$;

-- Live chart bubbles: every squad mate's open trade on this market, plus
-- trades closed in the last 30 s so the app can play exit animations.
-- Size is position margin as a % of the trader's equity (not dollars).
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
      select 'closed', t.id, p.handle, t.user_id = uid, t.side, t.quantity, t.entry_price, t.exit_price, t.pnl, t.reason,
             t.closed_at, t.opened_at, null, null, null
      from trades t join profiles p on p.id = t.user_id
      where t.market = p_market and t.season = current_season() and t.closed_at > now() - interval '30 seconds'
        and (t.user_id = uid or (p_squad is not null and exists (select 1 from squad_members m where m.squad_id = p_squad and m.user_id = t.user_id)))
    ) b), '[]'::jsonb);
end $$;

-- ---------- Ingest: apply rules on every price tick ----------------------
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

  for acct in select distinct user_id, season from positions where season = current_season() loop
    if enforce_rules(acct.user_id, acct.season) <> 'active' then breached := breached + 1; end if;
  end loop;
  perform settle_old_seasons(null);
  delete from quote_ticks where quoted_at < now() - interval '3 days';
  return jsonb_build_object('accepted', accepted, 'liquidated', breached);
end $$;

-- ---------- Permissions ------------------------------------------------
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in (
      'season_length_days','season_anchor','starting_balance','brisbane_today','season_number','close_all',
      'enforce_rules','trading_days','buy_back','lifetime_stats','chart_bubbles','current_season','season_ends_at',
      'liquidate_if_needed','ensure_account','open_position','close_position','my_state','squad_leaderboard',
      'squad_feed','ingest_quotes')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
  end loop;
end $$;

grant execute on function
  public.open_position(public.market, public.trade_side, int), public.close_position(uuid), public.my_state(),
  public.squad_leaderboard(uuid), public.squad_feed(uuid, int), public.buy_back(), public.lifetime_stats(text),
  public.chart_bubbles(public.market, uuid), public.current_season()
to authenticated;
grant execute on function public.current_season() to anon;
grant execute on function public.ingest_quotes(jsonb) to service_role;
