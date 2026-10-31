-- =====================================================================
-- Brokie · $1 pool (hard-mode accounts, paid entries, profit-weighted payout)
-- Run after capped_eod_floor.sql. Re-runnable.
--
-- A player enters the season's pool with one $1 entry, paid either as
--   · 1 USDC on Base, sent from a wallet they registered in the app (the
--     pool-watch edge function credits it automatically), or
--   · PayID / cash in hand, confirmed by Sam: select admin_confirm_entry('handle');
-- The moment the entry is paid, the player's season account restarts at
-- $100k on HARD MODE: 3% daily loss, 5% max loss trailing intraday from peak
-- equity, no buy-back, at most 5 micros open at once. Target stays +10%
-- with 5 trading days.
--
-- Pool = entries × $1 × (100 − house%) + rollover from winnerless seasons.
-- At season end it is split in proportion to each eligible player's season
-- return: share = your % gain ÷ sum of all eligible % gains. Eligible means a
-- paid entry, 5 trading days, not blown, return above zero. One eligible
-- player takes it all; nobody eligible rolls the pool into the next season.
-- Payouts are sent by hand (select * from pool_payouts();).
--
-- Settings live in brokie_private (set them in the SQL editor):
--   insert into brokie_private(key,value) values ('pool_usdc_treasury','0x…') on conflict (key) do update set value=excluded.value;
--   insert into brokie_private(key,value) values ('pool_payid','0400 000 000') on conflict (key) do update set value=excluded.value;
-- The pool opens in the app once either of those is set.
-- =====================================================================

alter table public.accounts add column if not exists tier text not null default 'free';
alter table public.accounts drop constraint if exists accounts_tier_check;
alter table public.accounts add constraint accounts_tier_check check (tier in ('free', 'pool'));
alter table public.accounts add column if not exists max_qty int;

create table if not exists public.pool_entries (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade on update cascade,
  season      date not null,
  rail        text not null check (rail in ('usdc', 'payid', 'cash')),
  wallet      text,                 -- the player's own Base address (usdc rail), lower-case 0x…
  reference   text,                 -- tx hash (usdc) or whatever Sam typed when confirming
  amount      numeric,              -- entry units received; 1 = one $1 entry
  status      text not null default 'pending' check (status in ('pending', 'paid', 'void')),
  paid_at     timestamptz,
  created_at  timestamptz not null default now(),
  unique (user_id, season)
);
create unique index if not exists pool_entries_tx on public.pool_entries (reference) where rail = 'usdc' and status = 'paid';
alter table public.pool_entries enable row level security;
revoke all on public.pool_entries from anon, authenticated;

insert into public.brokie_private (key, value) values
  ('pool_entry_usd', '1'), ('pool_house_pct', '10'), ('pool_min_days', '5'), ('pool_max_qty', '5'),
  ('pool_daily_loss_pct', '3'), ('pool_max_dd_pct', '5')
on conflict (key) do nothing;

create or replace function public.pool_setting(p_key text) returns text
language sql stable security definer set search_path = public as $$
  select value from brokie_private where key = p_key
$$;
revoke all on function public.pool_setting(text) from public, anon, authenticated;

-- What the app needs to explain the pool. Never includes other players' wallets.
create or replace function public.pool_config() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'open', nullif(pool_setting('pool_usdc_treasury'), '') is not null or nullif(pool_setting('pool_payid'), '') is not null,
    'entry_usd', pool_setting('pool_entry_usd')::numeric,
    'house_pct', pool_setting('pool_house_pct')::numeric,
    'min_days', pool_setting('pool_min_days')::int,
    'chain', 'base',
    'usdc_contract', '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    'usdc_treasury', nullif(pool_setting('pool_usdc_treasury'), ''),
    'payid', nullif(pool_setting('pool_payid'), ''),
    'rules', jsonb_build_object(
      'daily_loss_pct', pool_setting('pool_daily_loss_pct')::numeric,
      'max_dd_pct', pool_setting('pool_max_dd_pct')::numeric,
      'dd_mode', 'trailing', 'max_qty', pool_setting('pool_max_qty')::int,
      'buy_back', false, 'target_pct', 10))
$$;
grant execute on function public.pool_config() to authenticated;

-- ---------- Entering -------------------------------------------------

-- Restart the season account at $100k on hard mode. Open positions are closed first ('reset' receipts).
create or replace function public.pool_activate(p_user uuid, p_season date) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_season = current_season() then perform ensure_account(p_user); end if;
  perform close_all(p_user, p_season, 'reset');
  update accounts set
    cash = starting_balance(), start_balance = starting_balance(), peak_equity = starting_balance(),
    eod_peak = starting_balance(), day_start_equity = starting_balance(), trading_day = trading_today(),
    status = 'active', blown_at = null, locked_at = null,
    tier = 'pool', dd_mode = 'trailing',
    daily_loss_pct = pool_setting('pool_daily_loss_pct')::numeric, daily_loss_amount = null,
    max_dd_pct = pool_setting('pool_max_dd_pct')::numeric, max_qty = pool_setting('pool_max_qty')::int,
    funded_at = null, target_hit_at = null, protection_credit = 0, worst_drawdown = 0, qualify_from = now()
  where user_id = p_user and season = p_season;
end $$;
revoke all on function public.pool_activate(uuid, date) from public, anon, authenticated;

-- The player picks a rail. For USDC they also give the wallet they'll send from.
create or replace function public.join_pool(p_rail text, p_wallet text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := require_user();
  w text := lower(trim(coalesce(p_wallet, '')));
  e pool_entries;
begin
  if p_rail not in ('usdc', 'payid') then raise exception 'Pick USDC or PayID.' using errcode = 'P0001'; end if;
  if p_rail = 'usdc' and nullif(pool_setting('pool_usdc_treasury'), '') is null then raise exception 'USDC entries aren''t open yet.' using errcode = 'P0001'; end if;
  if p_rail = 'payid' and nullif(pool_setting('pool_payid'), '') is null then raise exception 'PayID entries aren''t open yet.' using errcode = 'P0001'; end if;
  if p_rail = 'usdc' and w !~ '^0x[0-9a-f]{40}$' then raise exception 'That doesn''t look like a Base wallet address (0x + 40 hex characters).' using errcode = 'P0001'; end if;
  if p_rail = 'usdc' and w = lower(pool_setting('pool_usdc_treasury')) then raise exception 'That''s the Brokie treasury. Enter the wallet you''ll send from.' using errcode = 'P0001'; end if;
  select * into e from pool_entries where user_id = uid and season = current_season();
  if found and e.status = 'paid' then raise exception 'You''re already in this season''s pool.' using errcode = 'P0001'; end if;
  if p_rail = 'usdc' and exists (select 1 from pool_entries where wallet = w and season = current_season() and user_id <> uid and status <> 'void') then
    raise exception 'That wallet is already registered by another player.' using errcode = 'P0001';
  end if;
  insert into pool_entries (user_id, season, rail, wallet, status)
  values (uid, current_season(), p_rail, case when p_rail = 'usdc' then w end, 'pending')
  on conflict (user_id, season) do update set rail = excluded.rail, wallet = excluded.wallet, status = 'pending', reference = null, amount = null, paid_at = null;
  return my_pool();
end $$;
grant execute on function public.join_pool(text, text) to authenticated;

-- Changing your mind before paying.
create or replace function public.leave_pool() returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user();
begin
  delete from pool_entries where user_id = uid and season = current_season() and status = 'pending';
  return my_pool();
end $$;
grant execute on function public.leave_pool() to authenticated;

-- Called by the pool-watch edge function (service role) for every USDC transfer into the treasury.
create or replace function public.pool_mark_paid(p_wallet text, p_reference text, p_amount numeric, p_season date default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  w text := lower(trim(p_wallet));
  s date := coalesce(p_season, current_season());
  e pool_entries;
begin
  if exists (select 1 from pool_entries where rail = 'usdc' and status = 'paid' and reference = p_reference) then
    return jsonb_build_object('matched', false, 'duplicate', true);
  end if;
  select * into e from pool_entries where season = s and rail = 'usdc' and wallet = w and status = 'pending' for update;
  if not found then return jsonb_build_object('matched', false); end if;
  if p_amount < pool_setting('pool_entry_usd')::numeric then
    -- Short payment: remember it so the app can say "got 0.5, need 1", stay pending.
    update pool_entries set amount = coalesce(amount, 0) + p_amount, reference = p_reference where id = e.id;
    return jsonb_build_object('matched', true, 'short', true, 'handle', (select handle from profiles where id = e.user_id));
  end if;
  update pool_entries set status = 'paid', paid_at = now(), reference = p_reference, amount = p_amount where id = e.id;
  perform pool_activate(e.user_id, s);
  return jsonb_build_object('matched', true, 'paid', true, 'handle', (select handle from profiles where id = e.user_id));
end $$;
revoke all on function public.pool_mark_paid(text, text, numeric, date) from public, anon, authenticated;
grant execute on function public.pool_mark_paid(text, text, numeric, date) to service_role;

-- What the watcher needs: the treasury, the wallets still waiting, and where it got to on the chain.
create or replace function public.pool_watch_state() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'treasury', nullif(pool_setting('pool_usdc_treasury'), ''),
    'last_block', coalesce(pool_setting('pool_last_block'), '0')::bigint,
    'pending', coalesce((select jsonb_agg(distinct wallet) from pool_entries where rail = 'usdc' and status = 'pending' and season = current_season()), '[]'::jsonb))
$$;
revoke all on function public.pool_watch_state() from public, anon, authenticated;
grant execute on function public.pool_watch_state() to service_role;

create or replace function public.pool_set_cursor(p_block bigint) returns void
language sql security definer set search_path = public as $$
  insert into brokie_private (key, value) values ('pool_last_block', p_block::text)
  on conflict (key) do update set value = excluded.value
$$;
revoke all on function public.pool_set_cursor(bigint) from public, anon, authenticated;
grant execute on function public.pool_set_cursor(bigint) to service_role;

-- Sam, in the SQL editor, after a PayID or cash entry: select admin_confirm_entry('fukotrades');
-- Works whether or not the player tapped "PayID" in the app first.
create or replace function public.admin_confirm_entry(p_handle text, p_reference text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  u uuid; e pool_entries;
begin
  select id into u from profiles where handle = lower(trim(p_handle));
  if u is null then raise exception 'No player called %', p_handle; end if;
  select * into e from pool_entries where user_id = u and season = current_season() for update;
  if found and e.status = 'paid' then return jsonb_build_object('handle', p_handle, 'already_paid', true, 'paid_at', e.paid_at); end if;
  insert into pool_entries (user_id, season, rail, status, reference, amount, paid_at)
  values (u, current_season(), 'cash', 'paid', p_reference, pool_setting('pool_entry_usd')::numeric, now())
  on conflict (user_id, season) do update set
    rail = case when pool_entries.rail = 'usdc' then 'cash' else pool_entries.rail end,
    status = 'paid', reference = coalesce(excluded.reference, pool_entries.reference),
    amount = excluded.amount, paid_at = now();
  perform pool_activate(u, current_season());
  return jsonb_build_object('handle', p_handle, 'paid', true, 'season', current_season());
end $$;
revoke all on function public.admin_confirm_entry(text, text) from public, anon, authenticated;

-- Refund or mistake: the entry stops counting. The account keeps playing on hard mode.
create or replace function public.admin_void_entry(p_handle text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid; n int;
begin
  select id into u from profiles where handle = lower(trim(p_handle));
  update pool_entries set status = 'void' where user_id = u and season = current_season();
  get diagnostics n = row_count;
  return jsonb_build_object('handle', p_handle, 'voided', n > 0);
end $$;
revoke all on function public.admin_void_entry(text) from public, anon, authenticated;

-- ---------- Hard-mode rules ------------------------------------------

-- At most max_qty micros open at once (prediction contracts don't count).
create or replace function public.pool_size_cap() returns trigger
language plpgsql security definer set search_path = public as $$
declare a accounts; open_qty int;
begin
  if new.market = 'prediction' then return new; end if;
  select * into a from accounts where user_id = new.user_id and season = new.season;
  if found and a.tier = 'pool' and a.max_qty is not null then
    select coalesce(sum(quantity), 0) into open_qty from positions where user_id = new.user_id and season = new.season and market <> 'prediction';
    if open_qty + new.quantity > a.max_qty then
      raise exception 'Hard mode: max % micros open at once (you have %).', a.max_qty, open_qty using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists pool_size_cap on public.positions;
create trigger pool_size_cap before insert on public.positions for each row execute function public.pool_size_cap();

-- No buy-back on hard mode. Everything else is the live buy_back unchanged.
create or replace function public.buy_back() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := require_user();
  a accounts := ensure_account(uid);
begin
  if a.tier = 'pool' then raise exception 'Hard mode has no buy-back. This season''s pool run is over; the free season is still yours.' using errcode = 'P0001'; end if;
  if a.status <> 'blown' then raise exception 'You can only buy back after blowing your account.' using errcode = 'P0001'; end if;
  if a.resets_used >= 1 then raise exception 'You''ve used your one buy-back this season.' using errcode = 'P0001'; end if;
  update accounts set cash = starting_balance(), start_balance = starting_balance(), peak_equity = starting_balance(),
                      eod_peak = starting_balance(), day_start_equity = starting_balance(), trading_day = trading_today(),
                      status = 'active', daily_loss_pct = 4, max_dd_pct = 8, resets_used = resets_used + 1,
                      funded_at = null, target_hit_at = null,
                      protection_credit = 0, worst_drawdown = 0, qualify_from = now()
   where user_id = uid and season = a.season;
  return jsonb_build_object('ok', true);
end $$;

-- ---------- The pool and its split -----------------------------------

-- Paid entries × entry × (1 − house%).
create or replace function public.pool_amount(p_season date) returns numeric
language sql stable security definer set search_path = public as $$
  select round(count(*) * pool_setting('pool_entry_usd')::numeric * (1 - pool_setting('pool_house_pct')::numeric / 100), 2)
  from pool_entries where season = p_season and status = 'paid'
$$;

-- One row per paid entry with its season return and whether it can be paid.
create or replace function public.pool_rows(p_season date) returns table (
  user_id uuid, handle text, return_pct numeric, status text, trading_days int, qualified boolean, eligible boolean)
language sql stable security definer set search_path = public as $$
  with r as (
    select e.user_id, p.handle,
           round((coalesce(a.cash, starting_balance()) + unrealized(e.user_id, p_season) - coalesce(a.start_balance, starting_balance()))
                 / coalesce(a.start_balance, starting_balance()) * 100, 2) as return_pct,
           coalesce(a.status, 'active') as status,
           trading_days(e.user_id, p_season) as trading_days,
           coalesce(a.tier, 'free') as tier
    from pool_entries e
    join profiles p on p.id = e.user_id
    left join accounts a on a.user_id = e.user_id and a.season = p_season
    where e.season = p_season and e.status = 'paid'
  )
  select user_id, handle, return_pct, status, trading_days,
         trading_days >= pool_setting('pool_min_days')::int as qualified,
         tier = 'pool' and status <> 'blown' and trading_days >= pool_setting('pool_min_days')::int and return_pct > 0 as eligible
  from r
$$;

create or replace function public.pool_has_winner(p_season date) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from pool_rows(p_season) where eligible)
$$;

-- Winnerless pools roll forward until a season with a winner.
create or replace function public.pool_rollover(p_season date) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(pool_amount(s.season)), 0)
  from (select distinct season from pool_entries where status = 'paid' and season < p_season) s
  where not pool_has_winner(s.season)
    and s.season > coalesce((select max(w.season) from (select distinct season from pool_entries where status = 'paid' and season < p_season) w where pool_has_winner(w.season)), '-infinity'::date)
$$;

-- Live standings: who's in, the pool, and what each eligible player would be paid right now.
create or replace function public.pool_standings(p_season date default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  s date := coalesce(p_season, current_season());
  pool numeric := pool_amount(s);
  roll numeric := pool_rollover(s);
  total numeric := pool_amount(s) + pool_rollover(s);
  gains numeric;
  rows jsonb;
begin
  select coalesce(sum(return_pct), 0) into gains from pool_rows(s) where eligible;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.eligible desc, x.return_pct desc, x.handle), '[]'::jsonb) into rows from (
    select r.handle, r.return_pct, r.status, r.trading_days, r.qualified, r.eligible,
           case when r.eligible and gains > 0 then round(r.return_pct / gains * 100, 2) else 0 end as share_pct,
           case when r.eligible and gains > 0 then round(total * r.return_pct / gains, 2) else 0 end as payout,
           r.user_id = auth.uid() as is_you
    from pool_rows(s) r) x;
  return jsonb_build_object(
    'season', s, 'season_number', season_number(s), 'ends_at', season_ends_at(s),
    'entries', (select count(*) from pool_entries where season = s and status = 'paid'),
    'entry_usd', pool_setting('pool_entry_usd')::numeric, 'house_pct', pool_setting('pool_house_pct')::numeric,
    'pool', pool, 'rollover', roll, 'total', total, 'has_winner', gains > 0,
    'min_days', pool_setting('pool_min_days')::int, 'rows', rows);
end $$;
grant execute on function public.pool_standings(date) to authenticated;

-- Everything the You page shows: config, your own entry, your account's tier, the standings.
create or replace function public.my_pool() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := require_user();
  e pool_entries;
  a accounts;
begin
  select * into e from pool_entries where user_id = uid and season = current_season();
  select * into a from accounts where user_id = uid and season = current_season();
  return jsonb_build_object(
    'config', pool_config(),
    'entry', case when e.id is null then null else jsonb_build_object(
      'rail', e.rail, 'wallet', e.wallet, 'status', e.status, 'amount', e.amount, 'reference', e.reference, 'paid_at', e.paid_at) end,
    'tier', coalesce(a.tier, 'free'), 'max_qty', a.max_qty,
    'standings', pool_standings(current_season()));
end $$;
grant execute on function public.my_pool() to authenticated;

-- Season-end payout sheet for Sam: select * from pool_payouts();   (or pool_payouts(date '2026-10-19'))
create or replace function public.pool_payouts(p_season date default null) returns table (
  handle text, rail text, wallet text, return_pct numeric, share_pct numeric, payout numeric)
language sql stable security definer set search_path = public as $$
  with s as (select pool_standings(coalesce(p_season, current_season())) j)
  select x->>'handle', e.rail, e.wallet, (x->>'return_pct')::numeric, (x->>'share_pct')::numeric, (x->>'payout')::numeric
  from s, jsonb_array_elements(s.j->'rows') x
  join profiles p on p.handle = x->>'handle'
  join pool_entries e on e.user_id = p.id and e.season = coalesce(p_season, current_season()) and e.status = 'paid'
  where (x->>'eligible')::boolean
  order by (x->>'payout')::numeric desc
$$;
revoke all on function public.pool_payouts(date) from public, anon, authenticated;
