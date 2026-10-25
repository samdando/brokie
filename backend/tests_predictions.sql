insert into auth.users values('00000000-0000-0000-0000-000000009001');
insert into profiles(id,handle) values('00000000-0000-0000-0000-000000009001','predict_test');
insert into accounts(user_id,season,cash,start_balance,day_start_equity,peak_equity,eod_peak,trading_day)
 values('00000000-0000-0000-0000-000000009001',current_season(),100000,100000,100000,100000,100000,trading_today());
select ingest_predictions(jsonb_build_array(jsonb_build_object('id','TEST-EVENT','title','Will the test pass?','rules','Yes if the test passes.',
 'close_at',now()+interval '1 day','status','active','yes_bid',0.50,'yes_ask',0.55,'no_bid',0.45,'no_ask',0.50,'quoted_at',now(),'volume',1000)));
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000009001',false);
select pg_temp.check(jsonb_array_length(prediction_board()->'markets')=1,'live prediction listing');
select open_prediction('TEST-EVENT','yes',100);
select pg_temp.check((my_state()->'positions'->0->>'quantity')::int=181,'stake converted to whole shares');
select pg_temp.check((my_state()->'rules'->>'equity')::numeric=99990.95,'equity includes bid-ask loss');
select pg_temp.check((my_state()->'positions'->0->>'prediction_question')='Will the test pass?','position carries event title');
select pg_temp.check((my_state()->'positions'->0->>'mark_price')::numeric=0.5,'position carries individual outcome mark');
select pg_temp.check((chart_bubbles('prediction')->0->>'prediction_question')='Will the test pass?','squad profiles preserve event identity');
select pg_temp.check((chart_bubbles('prediction')->0->>'mark_price')::numeric=.5,'squad profiles use per-event marks');
select pg_temp.check(pg_temp.err($q$select open_prediction('TEST-EVENT','maybe',100)$q$) is not null,'invalid outcome denied');
select pg_temp.check(pg_temp.err($q$select open_prediction('TEST-EVENT','no',1001)$q$) is not null,'oversized stake denied');
select pg_temp.check(pg_temp.err($q$select ingest_predictions('[]')$q$) is not null,'players cannot set prices or winners');
reset role;
select pg_temp.check((select position_margin(p)=99.55 from positions p where prediction_id='TEST-EVENT'),'prediction maximum loss is reserved');
update prediction_markets set yes_bid=.60,yes_ask=.65,no_bid=.35,no_ask=.40 where id='TEST-EVENT';
set role authenticated;
select close_prediction((my_state()->'positions'->0->>'id')::uuid);
select pg_temp.check((my_state()->>'cash')::numeric=100009.05,'early exit settles at bid and credits profit');
select open_prediction('TEST-EVENT','no',100);
reset role;
-- Tentative results are represented as no payout; no early settlement.
select ingest_predictions(jsonb_build_array(jsonb_build_object('id','TEST-EVENT','title','Will the test pass?','rules','Yes if the test passes.',
 'close_at',now()-interval '1 second','status','closed','yes_bid',0,'yes_ask',0,'no_bid',0,'no_ask',0,'quoted_at',now(),'volume',1000)));
select pg_temp.check((select count(*)=1 from positions where prediction_id='TEST-EVENT'),'closed event waits for official result');
set role authenticated;
select pg_temp.check(pg_temp.err($q$select close_position((my_state()->'positions'->0->>'id')::uuid)$q$) is not null,'legacy close cannot bypass awaiting-result state');
reset role;
select ingest_predictions(jsonb_build_array(jsonb_build_object('id','TEST-EVENT','title','Will the test pass?','rules','Yes if the test passes.',
 'close_at',now()-interval '1 second','status','finalized','yes_bid',0,'yes_ask',0,'no_bid',1,'no_ask',1,'payout_yes',0,'quoted_at',now(),'volume',1000)));
select pg_temp.check((select count(*)=0 from positions where prediction_id='TEST-EVENT'),'final result auto-settles while offline');
select pg_temp.check((select pnl=150 and exit_price=1 and prediction_outcome='no' and prediction_question='Will the test pass?' from trades where reason='prediction_settled'),'No win pays $1/share');
select pg_temp.check((select cash=100159.05 from accounts where user_id='00000000-0000-0000-0000-000000009001'),'prediction ledger reconciles');
select pg_temp.check((select count(*)=2 from trades where prediction_id='TEST-EVENT'),'one receipt per prediction');
set role authenticated;
select pg_temp.check((my_state()->>'cash')::numeric=100159.05,'final balance visible to client');
select pg_temp.check((select (r->>'today_pnl')::numeric=159.05 from jsonb_array_elements(global_leaderboard()->'rows')r where r->>'handle'='predict_test'),'daily profile badge includes prediction P&L');
reset role;
select ingest_predictions(jsonb_build_array(jsonb_build_object('id','TEST-EVENT','title','Will the test pass?','rules','Yes if the test passes.',
 'close_at',now()-interval '1 second','status','finalized','yes_bid',0,'yes_ask',0,'no_bid',1,'no_ask',1,'payout_yes',0,'quoted_at',now(),'volume',1000)));
select pg_temp.check((select cash=100159.05 from accounts where user_id='00000000-0000-0000-0000-000000009001'),'repeated final result does not pay twice');
set role authenticated;
select pg_temp.check(pg_temp.err($q$select open_prediction('TEST-EVENT','yes',100)$q$) is not null,'resolved contracts cannot reopen');
reset role;
