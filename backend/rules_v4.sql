-- Brokie season rules v4 (decided 22 Oct 2026). Run in the Supabase SQL editor after
-- trading_day.sql (and trade_sharing.sql). Safe to re-run.
--
-- * Max loss limit (MLL) is 8%, down from 10%. The +10% profit target is unchanged.
-- * The 8% is measured from the highest END-OF-DAY balance, not the intraday peak. "End of day"
--   is the session close the rest of the game already uses (5pm New York). Live equity can still
--   breach the floor intraday, as at the prop firms.
--   accounts.dd_mode = 'trailing' keeps the old intraday-trailing rule for a future hard mode.
-- * A buy-back restarts qualifying: 5 new trading days counted from the reset.
-- * The buy-back keeps its 4% daily limit; its 8% MLL now matches everyone else's.
--
-- BEFORE RUNNING on the live database, see who the tighter 8% would blow straight away:
--   select p.handle, a.cash + unrealized(a.user_id, a.season) as equity,
--          greatest(a.start_balance, a.day_start_equity) * 0.92 as new_floor
--     from accounts a join profiles p on p.id = a.user_id
--    where a.season = current_season() and a.status <> 'blown'
--      and a.cash + unrealized(a.user_id, a.season) <= greatest(a.start_balance, a.day_start_equity) * 0.92;

alter table public.accounts add column if not exists eod_peak     numeric;      -- highest end-of-day balance
alter table public.accounts add column if not exists dd_mode      text not null default 'eod';
alter table public.accounts add column if not exists qualify_from timestamptz;  -- set by a buy-back
alter table public.accounts alter column max_dd_pct set default 8;
do $$ begin
  alter table public.accounts add constraint accounts_dd_mode_check check (dd_mode in ('eod', 'trailing'));
exception when duplicate_object then null; end $$;

-- This season's accounts move to the new rules. We don't have their past end-of-day balances,
-- so the EOD high starts at the larger of the starting balance and the latest session open.
update public.accounts
   set max_dd_pct = least(max_dd_pct, 8),
       eod_peak = greatest(start_balance, day_start_equity),
       rules_version = 4
 where rules_version < 4 and season = public.current_season();

-- The balance the drawdown is measured from, and the floor that blows the account.
create or replace function public.dd_base(a public.accounts) returns numeric
language sql stable as $$
  select case when a.dd_mode = 'trailing' then a.peak_equity else coalesce(a.eod_peak, a.start_balance) end
$$;
create or replace function public.dd_floor(a public.accounts) returns numeric
language sql stable as $$ select round(public.dd_base(a) * (1 - a.max_dd_pct / 100), 2) $$;

create or replace function public.enforce_rules(p_user uuid, p_season date) returns text
language plpgsql security definer set search_path = public as $$
declare
  a accounts;
  eq numeric;
  today date := trading_today();
begin
  select * into a from accounts where user_id = p_user and season = p_season for update;
  if not found then return null; end if;
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

  -- Profit target -> funded badge (sticky for the season).
  if a.funded_at is null and eq >= a.start_balance * 1.10 then
    update accounts set funded_at = now() where user_id = p_user and season = p_season;
  end if;
  return a.status;
end $$;

-- Only days traded since the last buy-back count towards qualifying.
create or replace function public.trading_days(p_user uuid, p_season date) returns int
language sql stable security definer set search_path = public as $$
  select count(distinct d)::int from (
    select trading_day_of(t.opened_at) as d from trades t
     where t.user_id = p_user and t.season = p_season
       and t.opened_at >= coalesce((select qualify_from from accounts where user_id = p_user and season = p_season), '-infinity')
    union
    select trading_day_of(o.opened_at) from positions o
     where o.user_id = p_user and o.season = p_season
       and o.opened_at >= coalesce((select qualify_from from accounts where user_id = p_user and season = p_season), '-infinity')
  ) days
$$;

create or replace function public.buy_back() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := require_user();
  a accounts := ensure_account(uid);
begin
  if a.status <> 'blown' then raise exception 'You can only buy back after blowing your account.' using errcode = 'P0001'; end if;
  if a.resets_used >= 1 then raise exception 'You''ve used your one buy-back this season.' using errcode = 'P0001'; end if;
  update accounts set cash = starting_balance(), start_balance = starting_balance(), peak_equity = starting_balance(),
                      eod_peak = starting_balance(), day_start_equity = starting_balance(), trading_day = trading_today(),
                      status = 'active', daily_loss_pct = 4, max_dd_pct = 8, resets_used = resets_used + 1,
                      funded_at = null,  -- blown_at stays: REKT is public
                      protection_credit = 0, worst_drawdown = 0, qualify_from = now()
   where user_id = uid and season = a.season;
  return jsonb_build_object('ok', true);
end $$;

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
      'dd_mode', acct.dd_mode,
      'dd_base', round(dd_base(acct), 2),
      'daily_floor', round(acct.day_start_equity * (1 - acct.daily_loss_pct / 100), 2),
      'drawdown_floor', dd_floor(acct),
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

-- Same as v3, with the floor from dd_floor().
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
             dd_floor(a) as dd_floor,
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

-- Squad board rows also carry wins/losses (the app shows W/L instead of the lowest trade).
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
             (select count(*) from trades t where t.user_id = p.id and t.season = current_season() and t.pnl > 0) as wins,
             (select count(*) from trades t where t.user_id = p.id and t.season = current_season() and t.pnl < 0) as losses,
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

revoke all on function public.dd_base(public.accounts), public.dd_floor(public.accounts) from public, anon, authenticated;
revoke all on function public.enforce_rules(uuid, date), public.trading_days(uuid, date) from public, anon, authenticated;
revoke all on function public.buy_back(), public.my_state(), public.chart_bubbles(public.market, uuid) from public, anon;
grant execute on function public.buy_back(), public.my_state(), public.chart_bubbles(public.market, uuid) to authenticated;
revoke all on function public.squad_leaderboard(uuid) from public, anon;
grant execute on function public.squad_leaderboard(uuid) to authenticated;
