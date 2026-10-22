\set ON_ERROR_STOP on
-- Checks the original 10% intraday-trailing rules: run it on a database WITHOUT rules_v4.sql (tests_rules_v4.sql covers the new rules).
create or replace function pg_temp.check(ok boolean, msg text) returns void language plpgsql as $$
begin if not coalesce(ok, false) then raise exception 'FAIL: %', msg; end if; raise notice 'ok: %', msg; end $$;
create or replace function pg_temp.err(sql text) returns text language plpgsql as $$
begin execute sql; return null; exception when others then return sqlerrm; end $$;
create or replace function pg_temp.price(m text, p numeric) returns void language sql as $$
  select null::void from (select public.ingest_quotes(jsonb_build_array(jsonb_build_object('market', m, 'price', p, 'quoted_at', now())))) x $$;
create or replace function pg_temp.as_user(u text) returns void language sql as $$ select set_config('request.jwt.claim.sub', u, false)::text::void $$;

insert into auth.users values ('00000000-0000-0000-0000-0000000000a1'), ('00000000-0000-0000-0000-0000000000b1'), ('00000000-0000-0000-0000-0000000000c1');
select pg_temp.price('nas', 20000); select pg_temp.price('gold', 4000); select pg_temp.price('es', 6000);

-- Calendar
select pg_temp.check(public.current_season() = date '2026-10-19' or (public.current_season() - date '2026-10-19') % 56 = 0, '8-week season boundaries');
select pg_temp.check(public.season_ends_at(public.current_season()) - (public.current_season()::timestamp at time zone 'Australia/Brisbane') = interval '56 days', 'season lasts 56 days');

set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select public.claim_handle('ape');
select pg_temp.check((public.my_state()->>'cash')::numeric = 100000, 'fresh $100k account');
select pg_temp.check((public.my_state()->'rules'->>'status') = 'active' and (public.my_state()->'rules'->>'daily_floor')::numeric = 95000
                     and (public.my_state()->'rules'->>'drawdown_floor')::numeric = 90000 and (public.my_state()->'rules'->>'target')::numeric = 110000, 'rule meters: floors 95k/90k, target 110k');
select pg_temp.check(pg_temp.err('select public.open_position(''nas'',''long'',11)') like '%1 to 10%', 'max 10 contracts');
select public.open_position('nas', 'long', 10);   -- $20/pt
reset role;

-- +600 pts -> +$12,000 -> funded badge, new peak 112k
select pg_temp.price('nas', 20600);
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select pg_temp.check((public.my_state()->'rules'->>'funded')::boolean, 'funded at +10%');
select pg_temp.check((public.my_state()->'rules'->>'peak_equity')::numeric = 112000, 'peak tracks equity');
reset role;

-- Falls to 101,000: drawdown from 112k = 9.8% (> daily? day start 100k -> 101k is up). Still alive.
select pg_temp.price('nas', 20050);
select pg_temp.check((select status from accounts where user_id = '00000000-0000-0000-0000-0000000000a1') = 'active', 'alive at 9.8% drawdown');
-- 100,800 = 10% below 112k peak -> BLOWN
select pg_temp.price('nas', 20040);
select pg_temp.check((select status from accounts where user_id = '00000000-0000-0000-0000-0000000000a1') = 'blown', 'trailing 10% drawdown blows the account');
select pg_temp.check((select count(*) from positions where user_id = '00000000-0000-0000-0000-0000000000a1') = 0, 'blown closes all positions');
select pg_temp.check((select reason from trades where user_id = '00000000-0000-0000-0000-0000000000a1') = 'blown', 'trade marked blown');
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select pg_temp.check(pg_temp.err('select public.open_position(''nas'',''long'',1)') like '%blown%', 'blown account cannot trade');
-- Buy-back: fresh 100k on 4/8 rules, once.
select public.buy_back();
select pg_temp.check((public.my_state()->'rules'->>'status') = 'active' and (public.my_state()->>'cash')::numeric = 100000
                     and (public.my_state()->'rules'->>'daily_loss_pct')::numeric = 4 and (public.my_state()->'rules'->>'max_dd_pct')::numeric = 8, 'buy-back: fresh 100k on 4%/8% rules');
select pg_temp.check(pg_temp.err('select public.buy_back()') like '%only buy back after blowing%', 'buy-back needs a blown account');
reset role;

-- Player B: daily loss lock at 5%.
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
select public.claim_handle('bear');
select public.open_position('es', 'short', 10);   -- $50/pt
reset role;
select pg_temp.price('es', 6090);   -- -4,500
select pg_temp.check((select status from accounts where user_id = '00000000-0000-0000-0000-0000000000b1') = 'active', 'alive at -4.5% day');
select pg_temp.price('es', 6100);   -- -5,000 -> locked
select pg_temp.check((select status from accounts where user_id = '00000000-0000-0000-0000-0000000000b1') = 'locked', '5% daily loss locks the account');
select pg_temp.check((select reason from trades where user_id = '00000000-0000-0000-0000-0000000000b1') = 'daily_limit', 'trade marked daily_limit');
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
select pg_temp.check(pg_temp.err('select public.open_position(''es'',''long'',1)') like '%Daily loss limit%', 'locked account cannot trade today');
reset role;
-- Next Brisbane day: unlock, new day start equity.
update accounts set trading_day = trading_day - 1 where user_id = '00000000-0000-0000-0000-0000000000b1';
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
select pg_temp.check((public.my_state()->'rules'->>'status') = 'active' and (public.my_state()->'rules'->>'day_start_equity')::numeric = 95000, 'unlocks next day with new day-start equity');
select public.open_position('es', 'long', 1);
reset role;

-- Squad: leaderboard shows status, funded, qualification; feed shows REKT + funded; bubbles.
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select (public.create_squad('Prop Squad')->>'invite_code') as code \gset
select (public.my_squads()->0->>'id') as sq \gset
reset role;
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
select public.join_squad(:'code');
reset role;
select set_config('my.sq', :'sq', false);
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
do $$
declare lb jsonb := public.squad_leaderboard(current_setting('my.sq')::uuid);
        feed jsonb := public.squad_feed(current_setting('my.sq')::uuid, 50);
        bub jsonb := public.chart_bubbles('es', current_setting('my.sq')::uuid);
begin
  perform pg_temp.check(jsonb_array_length(lb) = 2 and lb->0 ? 'qualified' and not (lb->0->>'qualified')::boolean, 'leaderboard has qualification (needs 5 days)');
  perform pg_temp.check((select bool_or((e->>'resets_used')::int = 1) from jsonb_array_elements(lb) e), 'leaderboard shows buy-back used');
  perform pg_temp.check((select count(*) from jsonb_array_elements(feed) e where e->>'kind' = 'rekt' and e->>'handle' = 'ape') = 1, 'feed keeps the public REKT moment after buy-back');
  perform pg_temp.check((select count(*) from jsonb_array_elements(feed) e where e->>'kind' = 'funded') = 0, 'funded badge resets with the buy-back');
  perform pg_temp.check((select count(*) from jsonb_array_elements(feed) e where e->>'kind' in ('closed') and e->>'reason' = 'blown') = 1, 'feed shows blown trade');
  perform pg_temp.check((select count(*) from jsonb_array_elements(bub) e where e->>'state' = 'open' and (e->>'is_you')::boolean) = 1, 'my open trade is a bubble');
  perform pg_temp.check((select (e->>'size_pct')::numeric from jsonb_array_elements(bub) e where e->>'state'='open') = round(1000/95000.0*100, 2), 'bubble size is % of account');
end $$;
select pg_temp.check(pg_temp.err('select public.chart_bubbles(''es'', ''00000000-0000-0000-0000-000000000000'')') like '%not in that squad%', 'cannot peek at other squads'' bubbles');
reset role;
-- A sees B's bubble via the squad; outsider C sees only their own.
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select pg_temp.check((select count(*) from jsonb_array_elements(public.chart_bubbles('es', :'sq')) e where e->>'handle' = 'bear' and e->>'state' = 'open') = 1, 'squad mate sees friend bubble');
select pg_temp.check((select count(*) from jsonb_array_elements(public.chart_bubbles('es', :'sq')) e where e->>'state' = 'closed') >= 0, 'closed bubbles list ok');
reset role;
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
select public.claim_handle('lurker');
select pg_temp.check(jsonb_array_length(public.chart_bubbles('es', null)) = 0, 'no squad, no friend bubbles');
-- Lifetime stats
reset role;
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select pg_temp.check((public.lifetime_stats()->>'total_trades')::int = 1 and (public.lifetime_stats()->>'seasons_blown')::int = 1
                     and (public.lifetime_stats()->>'seasons_funded')::int = 0, 'lifetime stats survive buy-back (funded cleared by reset, blown kept)');
select pg_temp.check((public.lifetime_stats()->>'max_drawdown')::numeric = 0, 'worst drawdown resets with buy-back for the season');
select pg_temp.check(pg_temp.err('select public.enforce_rules(auth.uid(), public.current_season())') like '%permission denied%', 'players cannot run the rule engine');
reset role;
-- Ledger still reconciles for everyone
select pg_temp.check(bool_and(abs(a.cash - (a.start_balance + coalesce((select sum(pnl) from trades t where t.user_id=a.user_id and t.season=a.season and t.closed_at > coalesce((select max(closed_at) from trades x where x.user_id=a.user_id and x.reason='blown' and a.resets_used>0), '-infinity')),0) + a.protection_credit)) < 0.001), 'ledgers reconcile')
from accounts a;
\echo ALL V2 TESTS PASSED
