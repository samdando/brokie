\set ON_ERROR_STOP on
-- Run after supabase_stub, schema, seasons_v2, v3, partials, trading_day, trade_sharing and rules_v4.
create or replace function pg_temp.check(ok boolean, msg text) returns void language plpgsql as $$
begin if not coalesce(ok, false) then raise exception 'FAIL: %', msg; end if; raise notice 'ok: %', msg; end $$;
create or replace function pg_temp.err(sql text) returns text language plpgsql as $$
begin execute sql; return null; exception when others then return sqlerrm; end $$;
create or replace function pg_temp.price(m text, p numeric) returns void language sql as $$
  select null::void from (select public.ingest_quotes(jsonb_build_array(jsonb_build_object('market', m, 'price', p, 'quoted_at', now())))) x $$;
create or replace function pg_temp.as_user(u text) returns void language sql as $$ select set_config('request.jwt.claim.sub', u, false)::text::void $$;
create or replace function pg_temp.status(u text) returns text language sql as $$ select status from public.accounts where user_id = u::uuid $$;
-- Pretend the session rolled over: the next rule check sees a new trading day.
create or replace function pg_temp.new_session(u text) returns void language sql as $$
  update public.accounts set trading_day = trading_day - 1 where user_id = u::uuid $$;

insert into auth.users values ('00000000-0000-0000-0000-0000000004a1'), ('00000000-0000-0000-0000-0000000004b1'), ('00000000-0000-0000-0000-0000000004c1');
select pg_temp.price('nas', 20000); select pg_temp.price('gold', 4000); select pg_temp.price('es', 6000);

-- ---- Fresh account: 8% MLL from the end-of-day balance -------------------
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-0000000004a1');
select public.claim_handle('eod');
select pg_temp.check((public.my_state()->'rules'->>'max_dd_pct')::numeric = 8, 'MLL is 8%');
select pg_temp.check((public.my_state()->'rules'->>'dd_mode') = 'eod', 'drawdown mode is end-of-day');
select pg_temp.check((public.my_state()->'rules'->>'drawdown_floor')::numeric = 92000 and (public.my_state()->'rules'->>'dd_base')::numeric = 100000, 'floor starts at 92k from a 100k base');
select pg_temp.check((public.my_state()->'rules'->>'target')::numeric = 110000, 'profit target still +10%');
reset role;
-- Daily loss is out of the way for these checks, so only the MLL can fire.
update accounts set daily_loss_pct = 50 where user_id = '00000000-0000-0000-0000-0000000004a1';
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-0000000004a1');
select public.open_position('nas', 'long', 10);   -- $20 per point
reset role;

-- Intraday run-up to 110k does not move the floor.
select pg_temp.price('nas', 20500);
select pg_temp.check((select peak_equity from accounts where user_id = '00000000-0000-0000-0000-0000000004a1') = 110000, 'intraday peak still tracked (110k)');
select pg_temp.check((select public.dd_floor(a) from accounts a where user_id = '00000000-0000-0000-0000-0000000004a1') = 92000, 'intraday high does not raise the EOD floor');
-- Give it all back to 100k. Old intraday trailing (10% of 110k = 99k) would have blown here.
select pg_temp.price('nas', 20000);
select pg_temp.check(pg_temp.status('00000000-0000-0000-0000-0000000004a1') = 'active', 'round trip to 100k survives (not trailing)');

-- Session closes at 105k: that end-of-day balance becomes the new base.
select pg_temp.price('nas', 20250);
select pg_temp.new_session('00000000-0000-0000-0000-0000000004a1');
select pg_temp.price('nas', 20250);
select pg_temp.check((select eod_peak from accounts where user_id = '00000000-0000-0000-0000-0000000004a1') = 105000, 'EOD high steps up to the 105k close');
select pg_temp.check((select public.dd_floor(a) from accounts a where user_id = '00000000-0000-0000-0000-0000000004a1') = 96600, 'floor is 8% under the EOD high (96.6k)');
-- A losing close doesn't lower the high.
select pg_temp.price('nas', 20100);
select pg_temp.new_session('00000000-0000-0000-0000-0000000004a1');
select pg_temp.price('nas', 20100);
select pg_temp.check((select eod_peak from accounts where user_id = '00000000-0000-0000-0000-0000000004a1') = 105000, 'a lower close keeps the EOD high');
-- Intraday breach of the floor blows the account.
select pg_temp.price('nas', 19840);   -- 96,800
select pg_temp.check(pg_temp.status('00000000-0000-0000-0000-0000000004a1') = 'active', 'alive just above the floor');
select pg_temp.price('nas', 19830);   -- 96,600
select pg_temp.check(pg_temp.status('00000000-0000-0000-0000-0000000004a1') = 'blown', 'touching the EOD floor intraday blows the account');
select pg_temp.check((select count(*) from positions where user_id = '00000000-0000-0000-0000-0000000004a1') = 0, 'blown closes everything');

-- ---- Buy-back: fresh base, tighter daily, qualifying starts again ---------
-- Give the blown season some earlier trading days (3 days ago, 2 days ago).
insert into trades (id, user_id, season, market, side, quantity, entry_price, exit_price, pnl, opened_at, closed_at, reason)
select gen_random_uuid(), '00000000-0000-0000-0000-0000000004a1', current_season(), 'nas', 'long', 1, 20000, 20000, 0, now() - d * interval '1 day', now() - d * interval '1 day', 'closed'
  from generate_series(2, 3) d;
select pg_temp.check(public.trading_days('00000000-0000-0000-0000-0000000004a1', current_season()) >= 2, 'several trading days before the reset');
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-0000000004a1');
select public.buy_back();
select pg_temp.check((public.my_state()->'rules'->>'trading_days')::int = 0, 'buy-back resets qualifying days to 0');
select pg_temp.check((public.my_state()->'rules'->>'daily_loss_pct')::numeric = 4 and (public.my_state()->'rules'->>'max_dd_pct')::numeric = 8, 'buy-back rules: 4% daily, 8% MLL');
select pg_temp.check((public.my_state()->'rules'->>'drawdown_floor')::numeric = 92000, 'buy-back floor from a fresh 100k');
select public.open_position('gold', 'long', 1);
select pg_temp.check((public.my_state()->'rules'->>'trading_days')::int = 1, 'trading after the reset counts as day 1 of 5');
reset role;

-- ---- Trailing hard mode still works behind the flag -----------------------
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-0000000004b1');
select public.claim_handle('hardmode');
reset role;
update accounts set dd_mode = 'trailing', daily_loss_pct = 50 where user_id = '00000000-0000-0000-0000-0000000004b1';
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-0000000004b1');
select public.open_position('es', 'long', 10);   -- $50 per point
reset role;
select pg_temp.price('es', 6200);                 -- 110k intraday peak
select pg_temp.check((select public.dd_floor(a) from accounts a where user_id = '00000000-0000-0000-0000-0000000004b1') = 101200, 'trailing mode: floor follows the intraday peak');
select pg_temp.price('es', 6025);                 -- 101,250
select pg_temp.check(pg_temp.status('00000000-0000-0000-0000-0000000004b1') = 'active', 'trailing mode: alive above the trailing floor');
select pg_temp.price('es', 6024);                 -- 101,200
select pg_temp.check(pg_temp.status('00000000-0000-0000-0000-0000000004b1') = 'blown', 'trailing mode: blown at 8% under the intraday peak');

-- ---- Squad board shows W/L -------------------------------------------------
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-0000000004c1');
select public.claim_handle('winloss');
select (public.create_squad('WL Squad')->>'invite_code') as code \gset
select (public.my_squads()->0->>'id') as sq \gset
select public.open_position('gold', 'long', 1);   -- $10 per point
reset role;
select pg_temp.price('gold', 4010);
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-0000000004c1');
select public.close_position((public.my_state()->'positions'->0->>'id')::uuid);   -- win
select public.open_position('gold', 'long', 1);
reset role;
select pg_temp.price('gold', 4005);
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-0000000004c1');
select public.close_position((public.my_state()->'positions'->0->>'id')::uuid);   -- loss
select pg_temp.check((public.squad_leaderboard(:'sq')->0->>'wins')::int = 1 and (public.squad_leaderboard(:'sq')->0->>'losses')::int = 1, 'squad board has wins and losses');
-- Chart bubbles use the same floor as the rules.
select public.open_position('gold', 'long', 1);
select pg_temp.check((select (e->>'dd_floor')::numeric from jsonb_array_elements(public.chart_bubbles('gold', null)) e where e->>'state' = 'open') = 92000, 'bubble danger uses the EOD floor');
reset role;

-- ---- Migrating accounts that were on the old 10% trailing rules ----------
update accounts set max_dd_pct = 10, eod_peak = null, rules_version = 2, day_start_equity = 103000
 where user_id = '00000000-0000-0000-0000-0000000004c1';
\ir rules_v4.sql
select pg_temp.check((select max_dd_pct = 8 and eod_peak = 103000 and rules_version = 4 and dd_mode = 'eod' from accounts
                       where user_id = '00000000-0000-0000-0000-0000000004c1'), 'old accounts move to 8% EOD from their latest session open; rerunnable');
select pg_temp.check(pg_temp.err('set role authenticated; select public.dd_floor(a) from public.accounts a') like '%permission denied%', 'players cannot call the floor helper');
reset role;
\echo ALL RULES V4 TESTS PASSED
