-- Disposable database only.
insert into auth.users values('00000000-0000-0000-0000-000000009001'),('00000000-0000-0000-0000-000000009002');
insert into profiles(id,handle,show_global) values('00000000-0000-0000-0000-000000009001','tokens_test',true),('00000000-0000-0000-0000-000000009002','tokens_other',true);
insert into accounts(user_id,season,cash,start_balance,day_start_equity,peak_equity,eod_peak,trading_day)
select id,current_season(),100000,100000,100000,100000,100000,trading_today() from profiles where handle like 'tokens_%';
select ingest_predictions(jsonb_build_array(jsonb_build_object('id','TOKEN-EVENT','title','Will the test pass?','rules','Yes if it passes.',
 'close_at',now()+interval '1 day','status','active','yes_bid',0.4,'yes_ask',0.5,'no_bid',0.4,'no_ask',0.5,'quoted_at',now(),'volume',1000)));
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000009001',false);
select pg_temp.check((prediction_board()->>'balance')::numeric=0,'new wallet starts at zero');
select pg_temp.check(pg_temp.err($q$select open_prediction('TOKEN-EVENT','yes',1)$q$) like 'Not enough tokens%','competition cash cannot fund predictions');
select pg_temp.check(pg_temp.err($q$select award_prediction_token('00000000-0000-0000-0000-000000009001',trading_today())$q$) is not null,'cannot claim own rewards');
select pg_temp.check(pg_temp.err($q$update prediction_wallets set balance=100$q$) is not null,'cannot edit token balances');
select pg_temp.check(pg_temp.err($q$select * from prediction_rewards$q$) is not null,'reward ledger private');
select pg_temp.check(pg_temp.err($q$select open_position('gold','long',1)$q$) is not null,'failed stale trade rejected');
select pg_temp.check((prediction_board()->>'balance')::numeric=0,'failed trade earns no reward');
reset role;
alter table positions disable trigger set_position_session;
insert into positions(user_id,season,market,side,quantity,entry_price,session_closes_at) values
 ('00000000-0000-0000-0000-000000009001',current_season(),'btc','long',1,100000,now()+interval '1 day'),
 ('00000000-0000-0000-0000-000000009001',current_season(),'btc','short',1,100000,now()+interval '1 day');
alter table positions enable trigger set_position_session;
select pg_temp.check((select balance=1 from prediction_wallets where user_id='00000000-0000-0000-0000-000000009001'),'two trades earn only one token');
select pg_temp.check((select count(*)=1 from prediction_rewards where user_id='00000000-0000-0000-0000-000000009001'),'one reward row per day');
select award_prediction_token('00000000-0000-0000-0000-000000009001',trading_today()-1);
select award_prediction_token('00000000-0000-0000-0000-000000009001',trading_today()-1);
select pg_temp.check((select balance=2 from prediction_wallets where user_id='00000000-0000-0000-0000-000000009001'),'different trading day earns exactly one more');
select pg_temp.check(trading_day_of('2026-10-25 20:59:59Z')<>trading_day_of('2026-10-25 21:00Z'),'reward day rolls at New York 5pm');
select pg_temp.check(trading_day_of('2026-11-08 21:59:59Z')<>trading_day_of('2026-11-08 22:00Z'),'reward day follows DST');
update accounts set status='blown' where user_id='00000000-0000-0000-0000-000000009001';
create temp table competition_before as select to_jsonb(a) as data from accounts a where user_id='00000000-0000-0000-0000-000000009001';
set role authenticated;
select pg_temp.check((prediction_board()->>'earned_today')::boolean,'earned status exposed');
select open_prediction('TOKEN-EVENT','yes',1);
select pg_temp.check((prediction_board()->>'balance')::numeric=1,'stake debited from tokens');
select pg_temp.check((prediction_board()->'positions'->0->>'quantity')::numeric=2,'one token buys two half-token shares');
select pg_temp.check(jsonb_array_length(my_state()->'positions')=2,'prediction does not enter competition positions');
select pg_temp.check(pg_temp.err($q$select open_prediction('TOKEN-EVENT','yes',2)$q$) like 'Not enough tokens%','overspending rejected');
select pg_temp.check(pg_temp.err($q$select open_prediction('TOKEN-EVENT','yes',0)$q$) is not null,'zero stake rejected');
select pg_temp.check(pg_temp.err($q$select open_prediction('TOKEN-EVENT','yes',1.5)$q$) is not null,'fractional stake rejected');
select pg_temp.check(pg_temp.err($q$select open_prediction('TOKEN-EVENT','yes','NaN'::numeric)$q$) is not null,'NaN stake rejected');
select pg_temp.check(pg_temp.err($q$select open_prediction('TOKEN-EVENT','maybe',1)$q$) is not null,'bad outcome rejected');
reset role;
create temp table held_prediction as select id from prediction_positions;
grant select on held_prediction to authenticated;
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000009002',false);
select pg_temp.check(jsonb_array_length(prediction_board()->'positions')=0,'other player cannot see positions');
select pg_temp.check(pg_temp.err($q$select close_prediction((select id from held_prediction))$q$) is not null,'cannot close another player prediction');
select pg_temp.check(pg_temp.err($q$select settle_token_prediction((select id from held_prediction))$q$) is not null,'cannot invoke internal settlement');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000009001',false);
select pg_temp.check((close_prediction((select id from held_prediction))->>'payout')::numeric=.8,'early close pays the bid in tokens');
select pg_temp.check((prediction_board()->>'balance')::numeric=1.8,'early close token balance reconciles');
select pg_temp.check(pg_temp.err($q$select close_prediction((select id from held_prediction))$q$) is not null,'repeated close cannot credit twice');
select pg_temp.check(jsonb_array_length(prediction_board()->'trades')=1,'private token history exposed');
select open_prediction('TOKEN-EVENT','no',1);
reset role;
select pg_temp.check((select count(*)=2 from prediction_rewards where user_id='00000000-0000-0000-0000-000000009001'),'predictions never earn daily tokens');
select ingest_predictions(jsonb_build_array(jsonb_build_object('id','TOKEN-EVENT','title','Will the test pass?','rules','Yes if it passes.',
 'close_at',now()-interval '1 second','status','closed','yes_bid',0,'yes_ask',0,'no_bid',0,'no_ask',0,'quoted_at',now(),'volume',1000)));
select pg_temp.check((select count(*)=1 from prediction_positions),'tentative outcome stays pending');
set role authenticated;
select pg_temp.check(pg_temp.err($q$select close_prediction((prediction_board()->'positions'->0->>'id')::uuid)$q$) is not null,'closed market waits for official settlement');
reset role;
select ingest_predictions(jsonb_build_array(jsonb_build_object('id','TOKEN-EVENT','title','Will the test pass?','rules','Yes if it passes.',
 'close_at',now()-interval '1 second','status','finalized','yes_bid',0,'yes_ask',0,'no_bid',1,'no_ask',1,'payout_yes',0,'quoted_at',now(),'volume',1000)));
select pg_temp.check((select count(*)=0 from prediction_positions),'official result settles offline');
select pg_temp.check((select balance=2.8 from prediction_wallets where user_id='00000000-0000-0000-0000-000000009001'),'winning shares pay tokens');
select ingest_predictions('[]');
select pg_temp.check((select balance=2.8 from prediction_wallets where user_id='00000000-0000-0000-0000-000000009001'),'repeated settlement cannot pay twice');
select pg_temp.check((select count(*)=0 from trades where market='prediction'),'token receipts never enter competition history');
select pg_temp.check((select to_jsonb(a)=(select data from competition_before) from accounts a where user_id='00000000-0000-0000-0000-000000009001'),'all competition account fields unchanged by token trades');
set role authenticated;
select pg_temp.check((select (r->>'today_pnl')::numeric=0 from jsonb_array_elements(global_leaderboard()->'rows')r where r->>'handle'='tokens_test'),'prediction results excluded from competition daily P&L');
select pg_temp.check(pg_temp.err($q$select open_prediction('TOKEN-EVENT','yes',1)$q$) is not null,'cannot reopen finalized event');
reset role;
insert into quotes(market,price,quoted_at,source) values('prediction',.5,now(),'test');
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000009002',false);
select pg_temp.check(pg_temp.err($q$select open_position('prediction','long',1)$q$) is not null,'competition RPC cannot bypass token wallet');
reset role;
insert into trades(id,user_id,season,market,side,quantity,entry_price,exit_price,pnl,opened_at,reason)
values(gen_random_uuid(),'00000000-0000-0000-0000-000000009002',current_season(),'btc','long',1,100000,100000,0,now()-interval '1 day','market_close');
select pg_temp.check(not exists(select 1 from prediction_rewards where user_id='00000000-0000-0000-0000-000000009002'),'auto-settlement earns no reward');
insert into trades(id,user_id,season,market,side,quantity,entry_price,exit_price,pnl,opened_at,reason)
values(gen_random_uuid(),'00000000-0000-0000-0000-000000009002',current_season(),'btc','long',1,100000,100000,0,now()-interval '1 day','closed');
select pg_temp.check((select balance=1 from prediction_wallets where user_id='00000000-0000-0000-0000-000000009002'),'manual close earns daily reward');
-- Losses, void/scalar payouts, and fractional quantities all settle only in tokens.
do $$ declare before_balance numeric; expected numeric; event text; result numeric; begin
 for event,result,expected in values ('TOKEN-LOSS',0::numeric,0::numeric),('TOKEN-VOID',.5::numeric,1::numeric),('TOKEN-ROUND',1::numeric,1.818181::numeric) loop
  perform award_prediction_token('00000000-0000-0000-0000-000000009001',trading_today()-case event when 'TOKEN-LOSS' then 2 when 'TOKEN-VOID' then 3 else 4 end);
  select balance into before_balance from prediction_wallets where user_id='00000000-0000-0000-0000-000000009001';
  perform ingest_predictions(jsonb_build_array(jsonb_build_object('id',event,'title',event,'rules','Test only','close_at',now()+interval '1 day','status','active','yes_bid',.4,'yes_ask',case when event='TOKEN-ROUND' then .55 else .5 end,'no_bid',.4,'no_ask',.5,'quoted_at',now())));
  perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000009001',false);
  perform open_prediction(event,'yes',1);
  perform ingest_predictions(jsonb_build_array(jsonb_build_object('id',event,'title',event,'rules','Test only','close_at',now()-interval '1 second','status','finalized','yes_bid',result,'yes_ask',result,'no_bid',1-result,'no_ask',1-result,'payout_yes',result,'quoted_at',now())));
  perform pg_temp.check((select balance=before_balance-1+expected from prediction_wallets where user_id='00000000-0000-0000-0000-000000009001'),event||' balance reconciles');
 end loop;
end $$;
select pg_temp.check((select to_jsonb(a)=(select data from competition_before) from accounts a where user_id='00000000-0000-0000-0000-000000009001'),'loss/void/rounding do not affect competition');
