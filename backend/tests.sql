\set ON_ERROR_STOP on
create or replace function pg_temp.check(ok boolean, msg text) returns void language plpgsql as $$
begin if not coalesce(ok, false) then raise exception 'FAIL: %', msg; end if; raise notice 'ok: %', msg; end $$;
create or replace function pg_temp.err(sql text) returns text language plpgsql as $$
begin execute sql; return null; exception when others then return sqlerrm; end $$;

insert into auth.users values ('00000000-0000-0000-0000-00000000000a'), ('00000000-0000-0000-0000-00000000000b'), ('00000000-0000-0000-0000-00000000000c');

-- Feed prices (as service role).
set role service_role;
select pg_temp.check((public.ingest_quotes(jsonb_build_array(
  jsonb_build_object('market','gold','price',4012.37,'quoted_at',now()),
  jsonb_build_object('market','nas','price',20100.13,'quoted_at',now()),
  jsonb_build_object('market','es','price',6000.1,'quoted_at',now()),
  jsonb_build_object('market','btc','price',1,'quoted_at',now()),
  jsonb_build_object('market','es','price',-5,'quoted_at',now())
))->>'accepted')::int = 3, 'ingest accepts 3 valid quotes, skips unknown and negative');
reset role;
select pg_temp.check((select price from quotes where market='gold') = 4012.4, 'gold rounded to 0.1 tick');
select pg_temp.check((select price from quotes where market='nas') = 20100.25, 'nas rounded to 0.25 tick');

-- Anonymous visitors can read prices but nothing private.
set role anon;
select pg_temp.check((select count(*) from quotes) = 3, 'anon can read quotes');
select pg_temp.check(pg_temp.err('select * from accounts') like '%permission denied%', 'anon cannot read accounts');
select pg_temp.check(pg_temp.err('select public.ingest_quotes(''[]'')') like '%permission denied%', 'anon cannot ingest');
reset role;

-- Player A
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
select pg_temp.check(pg_temp.err('select public.my_state()') like '%handle%', 'must pick handle first');
select pg_temp.check(pg_temp.err('select public.claim_handle(''No'')') like '%3–18%', 'rejects short handle');
select pg_temp.check((public.claim_handle('Jess_Exe')->>'handle') = 'jess_exe', 'claims lowercased handle');
select pg_temp.check(pg_temp.err('select public.ingest_quotes(''[]'')') like '%permission denied%', 'players cannot ingest');
select pg_temp.check(pg_temp.err('select * from trades') like '%permission denied%', 'players cannot read trades table directly');
select pg_temp.check(pg_temp.err('select public.ensure_account(auth.uid())') like '%permission denied%', 'internal helpers are private');
select pg_temp.check((public.my_state()->>'cash')::numeric = 10000, 'fresh $10k season account');

select pg_temp.check(pg_temp.err('select public.open_position(''nas'',''long'',4)') like '%1, 2, or 3%', 'rejects oversize');
select public.open_position('nas','long',3);
select public.open_position('nas','long',3);
select public.open_position('gold','short',3);
select pg_temp.check(pg_temp.err('select public.open_position(''es'',''long'',2)') like '%buying power%', 'margin check blocks 10th contract-thousand');
select public.open_position('es','long',1);
select pg_temp.check(jsonb_array_length(public.my_state()->'positions') = 4, 'four open positions');
reset role;

-- Price moves: NAS +50 pts → 6 contracts × $2 × 50 = +600; gold +10 against short 3 → -300.
set role service_role;
select public.ingest_quotes(jsonb_build_array(
  jsonb_build_object('market','nas','price',20150.25,'quoted_at',now()),
  jsonb_build_object('market','gold','price',4022.4,'quoted_at',now())));
reset role;
select pg_temp.check(abs(public.unrealized('00000000-0000-0000-0000-00000000000a', public.current_season()) - 300) < 0.001, 'unrealized = +600 - 300 + 0 = +300') ;
set role authenticated;
select pg_temp.check(pg_temp.err('select public.unrealized(auth.uid(), public.current_season())') like '%permission denied%', 'players cannot call unrealized helper');
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
do $$
declare t jsonb; pid uuid;
begin
  select (p->>'id')::uuid into pid from jsonb_array_elements(public.my_state()->'positions') p where p->>'market' = 'gold';
  t := public.close_position(pid);
  perform pg_temp.check((t->>'pnl')::numeric = -300, 'closing short gold realizes -$300');
  perform pg_temp.check((public.my_state()->>'cash')::numeric = 9700, 'cash reflects realized loss');
  perform pg_temp.check(pg_temp.err(format('select public.close_position(%L)', pid)) like '%already closed%', 'double close rejected');
end $$;
reset role;

-- Player B cannot touch A's position.
insert into auth.users values ('00000000-0000-0000-0000-0000000000bb') on conflict do nothing;
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
select public.claim_handle('chartgremlin');
select pg_temp.check(pg_temp.err('select public.claim_handle(''jess_exe'')') like '%taken%', 'handles are unique');
do $$
declare pid uuid;
begin
  select id into pid from public.positions limit 1;
exception when others then
  perform pg_temp.check(sqlerrm like '%permission denied%', 'B cannot read A positions table');
end $$;
reset role;
select id as a_pos from positions where market='es' \gset
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
select pg_temp.check(pg_temp.err(format('select public.close_position(%L)', :'a_pos')) like '%already closed%', 'B cannot close A position');

-- Squads
select (public.create_squad('Rent Money Club')->>'invite_code') as code \gset
select pg_temp.check(length(:'code') = 6, 'invite code has 6 chars');
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
select (public.join_squad(lower(:'code'))->>'id') as squad \gset
select pg_temp.check((public.join_squad(:'code')->>'member_count')::int = 2, 'joining twice is idempotent, 2 members');
select pg_temp.check(pg_temp.err('select public.join_squad(''ZZZZZZ'')') like '%No squad%', 'bad code rejected');
select pg_temp.check(jsonb_array_length(public.my_squads()) = 1, 'A sees 1 squad');
reset role;
select set_config('my.squad', :'squad', false);
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
do $$
declare lb jsonb := public.squad_leaderboard(current_setting('my.squad')::uuid);
begin
  perform pg_temp.check(jsonb_array_length(lb) = 2, 'leaderboard has both members');
  perform pg_temp.check(lb->0->>'handle' = 'jess_exe' and (lb->0->>'equity')::numeric = 10300, 'A leads: 9700 cash + 600 open');
  perform pg_temp.check((lb->0->>'return_pct')::numeric = 3.00 and (lb->0->>'worst_trade')::numeric = -300, 'return 3% and worst trade -300');
  perform pg_temp.check((lb->0->>'is_you')::boolean and not (lb->1->>'is_you')::boolean, 'is_you flags');
  perform pg_temp.check((lb->1->>'equity')::numeric = 10000, 'B at 10000');
end $$;
do $$
declare feed jsonb := public.squad_feed(current_setting('my.squad')::uuid, 30);
begin
  perform pg_temp.check(jsonb_array_length(feed) = 4, 'feed shows 3 opens + 1 close');
  perform pg_temp.check((select count(*) from jsonb_array_elements(feed) e where e->>'kind'='closed' and (e->>'pnl')::numeric = -300) = 1, 'feed includes closed trade with pnl');
end $$;
reset role;

-- Outsider C can't see the squad.
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', false);
select public.claim_handle('outsider');
select pg_temp.check(pg_temp.err(format('select public.squad_leaderboard(%L)', :'squad')) like '%not in that squad%', 'outsider blocked from leaderboard');
select pg_temp.check(pg_temp.err(format('select public.voice_identity(%L)', :'squad')) like '%not in that squad%', 'outsider blocked from voice');
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
select pg_temp.check(public.voice_identity(:'squad')->>'handle' = 'chartgremlin', 'member gets voice identity');
reset role;

-- Stale price: opening blocked, closing allowed.
update quotes set quoted_at = now() - interval '10 minutes' where market = 'es';
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
select pg_temp.check(pg_temp.err('select public.open_position(''es'',''long'',1)') like '%stale%', 'stale feed blocks opening');
reset role;
update quotes set quoted_at = now() where market = 'es';

-- Liquidation: B goes 3 long NAS, then NAS crashes 2000 pts → -12000.
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
select public.open_position('nas','long',3);
reset role;
set role service_role;
select pg_temp.check((public.ingest_quotes(jsonb_build_array(jsonb_build_object('market','nas','price',18150.25,'quoted_at',now())))->>'liquidated')::int >= 1, 'crash triggers liquidation');
reset role;
select pg_temp.check((select cash from accounts where user_id='00000000-0000-0000-0000-00000000000b') = 0, 'B cash floored at zero');
select pg_temp.check((select protection_credit from accounts where user_id='00000000-0000-0000-0000-00000000000b') = 2000, 'B protection credit 2000');
select pg_temp.check((select count(*) from trades where user_id='00000000-0000-0000-0000-00000000000b' and reason='liquidated') = 1, 'B trade marked liquidated');
-- A also had 6 NAS long at 20100.25: now -1950 pts × 12 = -23400 → A liquidated too.
select pg_temp.check((select liquidations from accounts where user_id='00000000-0000-0000-0000-00000000000a') = 1, 'A also liquidated');
select pg_temp.check((select count(*) from positions) = 0, 'no positions left after liquidations');
-- Ledger reconciles: cash = 10000 + sum(pnl) + protection_credit
select pg_temp.check(bool_and(abs(a.cash - (10000 + coalesce((select sum(pnl) from trades t where t.user_id=a.user_id and t.season=a.season),0) + a.protection_credit)) < 0.001), 'ledgers reconcile')
from accounts a;

-- Candles
reset role;
insert into quote_ticks (market, price, quoted_at)
select 'gold', 4000 + g, date_trunc('minute', now()) - interval '10 minutes' + make_interval(secs => g * 10) from generate_series(0, 59) g;
set role anon;
do $$
declare c jsonb := public.candles('gold', 60, 60);
begin
  perform pg_temp.check(jsonb_array_length(c) >= 10, 'candles returns minute bars');
  perform pg_temp.check((select bool_and((e->>'low')::numeric <= least((e->>'open')::numeric,(e->>'close')::numeric) and (e->>'high')::numeric >= greatest((e->>'open')::numeric,(e->>'close')::numeric)) from jsonb_array_elements(c) e), 'candle bounds');
  perform pg_temp.check((select bool_and(((c->(i+1))->>'index')::bigint > ((c->i)->>'index')::bigint) from generate_series(0, jsonb_array_length(c)-2) i), 'candles ascending');
end $$;
reset role;

-- Season end: a position from last week gets settled when the player returns.
insert into accounts (user_id, season) values ('00000000-0000-0000-0000-00000000000c', current_season() - 7);
insert into positions (user_id, season, market, side, quantity, entry_price) values ('00000000-0000-0000-0000-00000000000c', current_season() - 7, 'es', 'long', 1, 5990);
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', false);
select pg_temp.check((public.my_state()->>'cash')::numeric = 10000 and jsonb_array_length(public.my_state()->'positions') = 0, 'new week starts fresh at 10k');
reset role;
select pg_temp.check((select reason from trades where user_id='00000000-0000-0000-0000-00000000000c') = 'season_end', 'old position settled at season end');
select pg_temp.check((select pnl from trades where user_id='00000000-0000-0000-0000-00000000000c') = (6000.0 - 5990) * 5, 'season-end P&L at last price');

-- Leaving: owner leaves, ownership passes on; last one out deletes the squad.
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
select public.leave_squad(:'squad');
reset role;
select pg_temp.check((select owner_id from squads where id = :'squad') = '00000000-0000-0000-0000-00000000000a', 'ownership passed to A');
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
select public.leave_squad(:'squad');
reset role;
select pg_temp.check(not exists (select 1 from squads where id = :'squad'), 'empty squad removed');
-- Backup codes: D trades, gets a code, "loses the phone", restores on a new login.
insert into auth.users values ('00000000-0000-0000-0000-00000000000d'), ('00000000-0000-0000-0000-0000000000d2'), ('00000000-0000-0000-0000-0000000000d3');
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000d', false);
select public.claim_handle('diamondhands');
select public.open_position('gold', 'long', 1);
select (public.create_squad('Backup Crew')->>'id') as dsquad \gset
select pg_temp.check(not (public.my_state()->>'has_backup_code')::boolean, 'no backup code yet');
select (public.issue_backup_code()->>'code') as dcode \gset
select pg_temp.check(:'dcode' ~ '^BRK-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$', 'backup code format');
select pg_temp.check((public.my_state()->>'has_backup_code')::boolean, 'has backup code');
reset role;
select pg_temp.check((select code_hash from account_recovery where user_id = '00000000-0000-0000-0000-00000000000d') <> :'dcode', 'only a hash is stored');
-- New phone
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000d2', false);
select pg_temp.check(public.restore_account('diamondhands', 'BRK-AAAA-AAAA-AAAA')->>'error' like '%don''t match%', 'wrong code rejected');
select pg_temp.check(public.restore_account('someoneelse', :'dcode')->>'error' like '%don''t match%', 'right code wrong handle rejected');
select (public.restore_account('DiamondHands', lower(replace(:'dcode', '-', ' ')))->>'code') as newcode \gset
select pg_temp.check(:'newcode' <> :'dcode', 'restore issues a fresh code');
select pg_temp.check(public.my_state()->>'handle' = 'diamondhands', 'new login owns the handle');
select pg_temp.check(jsonb_array_length(public.my_state()->'positions') = 1, 'open position came along');
select pg_temp.check(jsonb_array_length(public.my_squads()) = 1, 'squad membership came along');
select pg_temp.check(public.squad_leaderboard(:'dsquad')->0->>'handle' = 'diamondhands', 'leaderboard follows the account');
select pg_temp.check(pg_temp.err('select public.restore_account(''diamondhands'', ' || quote_literal(:'newcode') || ')') like '%already has%', 'cannot restore onto a phone that has an account');
reset role;
select pg_temp.check((select owner_id from squads where id = :'dsquad') = '00000000-0000-0000-0000-0000000000d2', 'squad ownership moved');
select pg_temp.check(not exists (select 1 from accounts where user_id = '00000000-0000-0000-0000-00000000000d'), 'old login holds nothing');
-- Old code is dead; brute force is rate limited.
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000d3', false);
select pg_temp.check(public.restore_account('diamondhands', :'dcode')->>'error' like '%don''t match%', 'old code no longer works');
select public.restore_account('diamondhands', 'x') from generate_series(1, 4);
select pg_temp.check(public.restore_account('diamondhands', :'newcode')->>'error' like '%Too many tries%', 'rate limit after 5 tries, even with the right code');
select pg_temp.check(pg_temp.err('select public.check_cron_secret(''x'')') like '%permission denied%', 'players cannot probe the cron secret');
reset role;
set role service_role;
select pg_temp.check(not public.check_cron_secret('nope'), 'wrong cron secret rejected');
reset role;
select value as cron from brokie_private where key = 'cron_secret' \gset
set role service_role;
select pg_temp.check(public.check_cron_secret(:'cron') and length(:'cron') = 64, 'generated cron secret accepted');
reset role;
\echo ALL BACKEND TESTS PASSED
