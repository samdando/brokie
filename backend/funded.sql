-- Brokie: "funded" means target AND 5 trading days (Sam, 23 Oct 2026). Run after rules_v4.sql. Safe to re-run.
--
-- * Reaching +10% sets target_hit_at (🎯 TARGET HIT, sticky for the season).
-- * funded_at (🏆 FUNDED) is set the first time equity is at +10% with 5+ trading days counted,
--   like a prop-firm evaluation. A buy-back clears both and restarts the 5 days (qualify_from).
-- * Existing badges move to target_hit_at; nobody keeps funded_at without 5 trading days.

alter table public.accounts add column if not exists target_hit_at timestamptz;

update public.accounts set target_hit_at = funded_at where target_hit_at is null and funded_at is not null;
update public.accounts a set funded_at = null
 where a.funded_at is not null and a.season = public.current_season()
   and public.trading_days(a.user_id, a.season) < 5;

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
                      funded_at = null, target_hit_at = null,  -- blown_at stays: REKT is public
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
      'target_hit', acct.target_hit_at is not null,
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

revoke all on function public.enforce_rules(uuid, date) from public, anon, authenticated;
revoke all on function public.buy_back(), public.my_state(), public.squad_leaderboard(uuid) from public, anon;
grant execute on function public.buy_back(), public.my_state(), public.squad_leaderboard(uuid) to authenticated;
