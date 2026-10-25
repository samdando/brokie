-- Isolated test database only; runner supplies the existing schema/migrations.
create function pg_temp.check(ok boolean,msg text) returns void language plpgsql as $$ begin if not coalesce(ok,false) then raise exception 'FAIL: %',msg; end if; end $$;
create function pg_temp.err(q text) returns text language plpgsql as $$ begin execute q; return null; exception when others then return sqlerrm; end $$;
select pg_temp.check(weekend_mode('2026-10-23 21:00Z') and not weekend_mode('2026-10-23 20:59:59Z'),'Friday switch');
select pg_temp.check(weekend_mode('2026-10-25 21:59:59Z') and not weekend_mode('2026-10-25 22:00Z'),'Sunday switch');
select pg_temp.check(weekend_mode('2026-11-06 22:00Z') and not weekend_mode('2026-11-06 21:59:59Z'),'DST switch');
select pg_temp.check(position_session_end('nas','2026-10-23 06:47:35Z')='2026-10-23 21:00Z'::timestamptz,'NAS close');
select pg_temp.check(position_session_end('gold','2026-11-06 09:00Z')='2026-11-06 22:00Z'::timestamptz,'DST close');
select pg_temp.check(position_session_end('btc','2026-10-24 09:00Z')='2026-10-25 22:00Z'::timestamptz,'crypto Sunday close');
select pg_temp.check(not market_session_open('nas','2026-10-24 03:00Z') and market_session_open('btc','2026-10-24 03:00Z'),'weekend market eligibility');
select pg_temp.check(not market_session_open('nas','2026-10-22 21:30Z'),'daily maintenance blocks entries');
select pg_temp.check(receipt_day('2026-10-23 21:00Z','market_close')='2026-10-23'::date,'market-close profit stays in previous day');
select pg_temp.check(receipt_day('2026-10-23 21:00Z','closed')='2026-10-24'::date,'normal close at boundary belongs to new day');
insert into auth.users values ('00000000-0000-0000-0000-000000008001'),('00000000-0000-0000-0000-000000008002');
insert into profiles(id,handle,show_global) values ('00000000-0000-0000-0000-000000008001','weekend_test',true),('00000000-0000-0000-0000-000000008002','private_test',false);
insert into accounts(user_id,season,cash,start_balance,day_start_equity,peak_equity,eod_peak,trading_day) select id,current_season(),100000,100000,100000,100000,100000,trading_today() from profiles;
alter table positions disable trigger set_position_session;
insert into positions(id,user_id,season,market,side,quantity,entry_price,opened_at,session_closes_at) values
 ('00000000-0000-0000-0000-000000008011','00000000-0000-0000-0000-000000008001',current_season(),'nas','short',3,29080.50,'2026-10-23 06:47:35Z','2026-10-23 21:00Z'),
 ('00000000-0000-0000-0000-000000008012','00000000-0000-0000-0000-000000008001',current_season(),'nas','short',3,29080.50,'2026-10-23 06:47:36Z','2026-10-23 21:00Z');
alter table positions enable trigger set_position_session;
insert into quote_ticks(market,price,quoted_at) values('nas',29019.75,'2026-10-23 20:59:01Z');
-- A Monday reopening quote must never replace Friday's mark.
insert into quotes(market,price,quoted_at,source) values('nas',30000,'2026-10-26 00:00Z','test');
select pg_temp.check((settle_market_closes('2026-10-23 20:59:59Z')->>'settled')::int=0,'does not close early');
select pg_temp.check((settle_market_closes('2026-10-23 21:00Z')->>'settled')::int=2,'offline trades auto-close');
select pg_temp.check((select sum(pnl)=729 from trades),'correct short multiplier and total');
select pg_temp.check((select cash=100729 from accounts where user_id='00000000-0000-0000-0000-000000008001'),'cash ledger reconciles');
select pg_temp.check((settle_market_closes('2026-10-26 09:00Z')->>'settled')::int=0,'retry is idempotent');
select pg_temp.check((select count(*)=0 from positions),'positions removed only after receipts');
select pg_temp.check((select bool_and(exit_price=29019.75 and exit_quoted_at='2026-10-23 20:59:01Z') from trades),'pre-close price and timestamp retained');
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000008001',false);
select pg_temp.check((daily_leaderboard('2026-10-23')->'rows'->0->>'pnl')::numeric=729,'daily realized result');
select pg_temp.check(jsonb_array_length(daily_leaderboard('2026-10-23')->'rows')=1,'hidden accounts excluded globally');
select pg_temp.check(jsonb_array_length(daily_receipts('weekend_test','2026-10-23'))=2,'daily receipts match result');
select pg_temp.check(pg_temp.err($q$select daily_receipts('private_test','2026-10-23')$q$) is not null,'private receipts denied');
select pg_temp.check(pg_temp.err($q$select settle_market_closes()$q$) is not null,'players cannot call settlement');
select save_trade_note('00000000-0000-0000-0000-000000008011','Waited for my setup.');
select pg_temp.check(review_trade('00000000-0000-0000-0000-000000008011')->>'note'='Waited for my setup.','private notes persist');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000008002',false);
select pg_temp.check(pg_temp.err($q$select review_trade('00000000-0000-0000-0000-000000008011')$q$) is not null,'cannot review another account private notes');
select pg_temp.check(pg_temp.err($q$select save_trade_note('00000000-0000-0000-0000-000000008011','tamper')$q$) is not null,'cannot edit another account note');
reset role;
-- Missing quotes stay pending rather than fabricating a fill at entry or a reopening mark.
alter table positions disable trigger set_position_session;
insert into positions(id,user_id,season,market,side,quantity,entry_price,opened_at,session_closes_at) values
 ('00000000-0000-0000-0000-000000008013','00000000-0000-0000-0000-000000008001',current_season(),'gold','long',1,4000,'2026-10-23 06:47:35Z','2026-10-23 21:00Z');
alter table positions enable trigger set_position_session;
select pg_temp.check((settle_market_closes('2026-10-24 09:00Z')->>'pending')::int=1,'missing closing price flagged');
select pg_temp.check((select count(*)=1 from positions),'pending position is retained');
-- A regular close cannot bypass historical settlement.
select pg_temp.check(pg_temp.err($q$select settle_position(p,'closed') from positions p where id='00000000-0000-0000-0000-000000008013'$q$) is not null,'manual close cannot use wrong-session price');
-- Crypto P&L uses actual coin units, not the index multipliers.
select pg_temp.check((select point_value*1000=10 from markets where id='btc'),'BTC micro is 0.01 BTC');
select pg_temp.check((select point_value*100=10 from markets where id='eth'),'ETH micro is 0.1 ETH');
select pg_temp.check((select point_value*10=10 from markets where id='sol'),'SOL micro is 1 SOL');
