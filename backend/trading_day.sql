-- Brokie: the trading day rolls over at 5pm New York (the US futures session close), like the
-- prop firms, instead of midnight Brisbane. That's 7am Brisbane while New York is on daylight time
-- and 8am after the clocks go back; New York's time zone rules handle the switch.
-- Daily loss allowance, lockouts and "trading days" all use it. Seasons still start Monday 00:00
-- Brisbane. Run in the Supabase SQL editor after v3.sql. Safe to re-run.
--
-- The new day labels match the Brisbane date from 7am onwards, so accounts already locked today stay
-- locked until 7am tomorrow instead of midnight, and nothing resets early.

-- The session a moment belongs to: New York time pushed forward 7 hours, so 5pm New York starts the next date.
create or replace function public.trading_day_of(p_at timestamptz) returns date
language sql immutable as $$ select ((p_at at time zone 'America/New_York') + interval '7 hours')::date $$;
create or replace function public.trading_today() returns date
language sql stable as $$ select trading_day_of(now()) $$;
-- When the current session ends (= next 5pm New York).
create or replace function public.trading_day_ends_at() returns timestamptz
language sql stable as $$ select ((trading_today()::timestamp - interval '7 hours' + interval '1 day') at time zone 'America/New_York') $$;

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

  -- New session (5pm New York): fresh daily-loss allowance; a locked account unlocks.
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

create or replace function public.ensure_account(p_user uuid) returns public.accounts
language plpgsql security definer set search_path = public as $$
declare acct accounts;
begin
  perform settle_old_seasons(p_user);
  insert into accounts (user_id, season, cash, start_balance, peak_equity, day_start_equity, trading_day, rules_version)
  values (p_user, current_season(), starting_balance(), starting_balance(), starting_balance(), starting_balance(), trading_today(), 2)
  on conflict do nothing;
  perform enforce_rules(p_user, current_season());
  select * into acct from accounts where user_id = p_user and season = current_season();
  return acct;
end $$;

create or replace function public.trading_days(p_user uuid, p_season date) returns int
language sql stable security definer set search_path = public as $$
  select count(distinct d)::int from (
    select trading_day_of(opened_at) as d from trades where user_id = p_user and season = p_season
    union
    select trading_day_of(opened_at) from positions where user_id = p_user and season = p_season
  ) days
$$;

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
    raise exception 'Daily loss limit hit. Trading unlocks when the next session opens (5pm New York, % Brisbane).',
      to_char(trading_day_ends_at() at time zone 'Australia/Brisbane', 'FMHH12am') using errcode = 'P0001';
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

create or replace function public.buy_back() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := require_user();
  a accounts := ensure_account(uid);
begin
  if a.status <> 'blown' then raise exception 'You can only buy back after blowing your account.' using errcode = 'P0001'; end if;
  if a.resets_used >= 1 then raise exception 'You''ve used your one buy-back this season.' using errcode = 'P0001'; end if;
  update accounts set cash = starting_balance(), start_balance = starting_balance(), peak_equity = starting_balance(),
                      day_start_equity = starting_balance(), trading_day = trading_today(), status = 'active',
                      daily_loss_pct = 4, max_dd_pct = 8, resets_used = resets_used + 1, funded_at = null,  -- blown_at stays: REKT is public
                      protection_credit = 0, worst_drawdown = 0
   where user_id = uid and season = a.season;
  return jsonb_build_object('ok', true);
end $$;

grant execute on function public.trading_day_of(timestamptz), public.trading_today(), public.trading_day_ends_at() to authenticated;
