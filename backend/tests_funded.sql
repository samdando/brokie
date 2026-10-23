\set ON_ERROR_STOP on
-- Run after supabase_stub, schema, seasons_v2, v3, partials, trading_day, trade_sharing, rules_v4 and funded.
create or replace function pg_temp.check(ok boolean, msg text) returns void language plpgsql as $$
begin if not coalesce(ok, false) then raise exception 'FAIL: %', msg; end if; raise notice 'ok: %', msg; end $$;
create or replace function pg_temp.price(m text, p numeric) returns void language sql as $$
  select null::void from (select public.ingest_quotes(jsonb_build_array(jsonb_build_object('market', m, 'price', p, 'quoted_at', now())))) x $$;
create or replace function pg_temp.as_user(u text) returns void language sql as $$ select set_config('request.jwt.claim.sub', u, false)::text::void $$;
-- Adds a closed $0 trade opened N trading days ago, so it counts as a trading day.
create or replace function pg_temp.day_ago(u text, n int) returns void language sql as $$
  insert into public.trades (id, user_id, season, market, side, quantity, entry_price, exit_price, pnl, opened_at, closed_at, reason)
  values (gen_random_uuid(), u::uuid, public.current_season(), 'gold', 'long', 1, 4000, 4000, 0, now() - n * interval '1 day', now() - n * interval '1 day', 'closed') $$;
create or replace function pg_temp.acct(u text) returns public.accounts language sql as $$ select * from public.accounts where user_id = u::uuid $$;

insert into auth.users values ('00000000-0000-0000-0000-0000000005a1'), ('00000000-0000-0000-0000-0000000005b1');
select pg_temp.price('nas', 20000); select pg_temp.price('gold', 4000); select pg_temp.price('es', 6000);

-- ---- Target on day 1 is only 🎯 TARGET HIT --------------------------------
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-0000000005a1');
select public.claim_handle('quickhit');
select public.open_position('nas', 'long', 10);   -- $20 per point
reset role;
select pg_temp.price('nas', 20500);                -- +10,000 -> 110k
select pg_temp.check((pg_temp.acct('00000000-0000-0000-0000-0000000005a1')).target_hit_at is not null, 'hitting +10% sets target hit');
select pg_temp.check((pg_temp.acct('00000000-0000-0000-0000-0000000005a1')).funded_at is null, 'one trading day is not funded');
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-0000000005a1');
select pg_temp.check((public.my_state()->'rules'->>'target_hit')::boolean and not (public.my_state()->'rules'->>'funded')::boolean, 'my_state: target_hit true, funded false');
reset role;

-- ---- Day 5 with equity still at target -> 🏆 FUNDED ----------------------
select pg_temp.day_ago('00000000-0000-0000-0000-0000000005a1', 1), pg_temp.day_ago('00000000-0000-0000-0000-0000000005a1', 2), pg_temp.day_ago('00000000-0000-0000-0000-0000000005a1', 3);
select pg_temp.price('nas', 20510);
select pg_temp.check(public.trading_days('00000000-0000-0000-0000-0000000005a1', public.current_season()) = 4 and (pg_temp.acct('00000000-0000-0000-0000-0000000005a1')).funded_at is null, '4 trading days at target: still not funded');
select pg_temp.day_ago('00000000-0000-0000-0000-0000000005a1', 4);
select pg_temp.price('nas', 20520);
select pg_temp.check((pg_temp.acct('00000000-0000-0000-0000-0000000005a1')).funded_at is not null, '5 trading days + at target: funded');
-- Sticky: dropping back under target keeps it.
select pg_temp.price('nas', 20200);
select pg_temp.check((pg_temp.acct('00000000-0000-0000-0000-0000000005a1')).funded_at is not null, 'funded is sticky after giving some back');

-- ---- Hit target early, below it by day 5 -> not funded until back -------
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-0000000005b1');
select public.claim_handle('fader');
select public.open_position('es', 'long', 10);
reset role;
update accounts set daily_loss_pct = 50 where user_id = '00000000-0000-0000-0000-0000000005b1';
select pg_temp.price('es', 6000 + 10000.0 / (select point_value * 10 from markets where id = 'es'));   -- +10k
select pg_temp.check((pg_temp.acct('00000000-0000-0000-0000-0000000005b1')).target_hit_at is not null, 'fader hit target');
select pg_temp.price('es', 6000);                  -- back to 100k
select pg_temp.day_ago('00000000-0000-0000-0000-0000000005b1', 1), pg_temp.day_ago('00000000-0000-0000-0000-0000000005b1', 2), pg_temp.day_ago('00000000-0000-0000-0000-0000000005b1', 3), pg_temp.day_ago('00000000-0000-0000-0000-0000000005b1', 4);
select pg_temp.price('es', 6000);
select pg_temp.check((pg_temp.acct('00000000-0000-0000-0000-0000000005b1')).funded_at is null, '5 days but under target now: not funded');
select pg_temp.price('es', 6000 + 10000.0 / (select point_value * 10 from markets where id = 'es'));
select pg_temp.check((pg_temp.acct('00000000-0000-0000-0000-0000000005b1')).funded_at is not null, 'back at target with 5 days: funded');

-- ---- Migration moved old badges and is re-runnable ------------------------
\i funded.sql
select pg_temp.check((select count(*) from accounts where funded_at is not null and public.trading_days(user_id, season) < 5) = 0, 'nobody funded with under 5 trading days');
select pg_temp.check((select count(*) from accounts where funded_at is not null and target_hit_at is null) = 0, 'every funded account also has target hit');
