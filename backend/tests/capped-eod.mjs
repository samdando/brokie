import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const root=new URL('../',import.meta.url).pathname,db=new PGlite();
try {
await db.exec(`create schema cron;create table cron.job(jobid int,jobname text);create function cron.unschedule(text) returns boolean language sql as 'select true';create function cron.schedule(text,text,text) returns int language sql as 'select 1';`);
for(const file of ['supabase_stub.sql','schema.sql','seasons_v2.sql','v3.sql','partials.sql','trading_day.sql','trade_sharing.sql','rules_v4.sql','funded.sql','us30.sql','bars.sql','weekend_markets.sql','weekend.sql','predictions.sql','prediction_tokens.sql','avatars.sql','clean_floor.sql','server_brackets.sql']){
 if(file==='us30.sql')await db.exec("alter type public.market add value if not exists 'us30'");
 await db.exec(readFileSync(root+file,'utf8'));
}
const migration=readFileSync(root+'capped_eod_floor.sql','utf8');await db.exec(migration);await db.exec(migration);
const uid='e1000000-0000-0000-0000-000000000001';
await db.exec(`insert into auth.users(id) values('${uid}');insert into profiles(id,handle) values('${uid}','cap_test');select ensure_account('${uid}');`);
const row=async()=> (await db.query(`select cash::float,status,resets_used,blown_at,qualify_from,dd_floor(accounts)::float as floor,trading_day from accounts where user_id='${uid}'`)).rows[0];
await db.exec(`update accounts set cash=100000,eod_peak=100000,peak_equity=150000,day_start_equity=100000,trading_day=trading_today() where user_id='${uid}'`);
assert.equal((await row()).floor,95800,'initial fixed $4,200 allowance');
assert.equal((await db.query(`select enforce_rules('${uid}',current_season()) status`)).rows[0].status,'active');assert.equal((await row()).floor,95800,'intraday spike cannot move an EOD floor');
// Dollar trail, threshold, cap and actual session rollover.
await db.exec(`update accounts set cash=104200 where user_id='${uid}'`);
assert.equal((await row()).floor,95800,'intraday gain still cannot raise the floor');
await db.exec(`update accounts set trading_day=trading_today()-1 where user_id='${uid}';select enforce_rules('${uid}',current_season())`);
assert.equal((await row()).floor,100000,'EOD rollover at $104,200 caps at $100k');
await db.exec(`update accounts set eod_peak=104199.99 where user_id='${uid}'`);assert.equal((await row()).floor,99999.99,'one cent below threshold');
await db.exec(`update accounts set start_balance=50000,eod_peak=52100 where user_id='${uid}'`);assert.equal((await row()).floor,50000,'$50k / $52,100 user example');
await db.exec(`update accounts set start_balance=100000,eod_peak=104200,dd_mode='eod' where user_id='${uid}';set request.jwt.claim.sub='${uid}'`);
const state=(await db.query('select my_state() r')).rows[0].r;assert.equal(state.rules.max_loss_amount,4200);assert.equal(state.rules.drawdown_cap,100000);assert.equal(state.rules.drawdown_floor,100000);
await db.exec(`update accounts set eod_peak=120000,day_start_equity=105000,cash=102000 where user_id='${uid}'`);assert.equal((await row()).floor,100000,'high EOD locks the floor at starting funds');
assert.equal((await db.query(`select enforce_rules('${uid}',current_season()) status`)).rows[0].status,'active','positive buffer above start remains tradeable');
await db.exec(`update accounts set dd_mode='trailing' where user_id='${uid}'`);assert.equal((await row()).floor,138000,'explicit hard mode retains existing intraday rule');
await db.exec(`update accounts set dd_mode='eod',status='blown',blown_at='2026-10-20T12:00:00Z',cash=102000,eod_peak=112000,day_start_equity=104000 where user_id='${uid}'`);
const restore=async(cash=102000)=> (await db.query(`select restore_capped_eod_account('cap_test',${cash},'2026-10-20T12:00:00Z') r`)).rows[0].r;
await assert.rejects(restore(102001),/Account changed/);const before=await row();const result=await restore();assert.equal(result.changed,true);const after=await row();assert.equal(after.status,'active');assert.equal(after.cash,before.cash);assert.equal(after.resets_used,before.resets_used);assert.equal(after.qualify_from,before.qualify_from);assert.equal(after.blown_at,null);assert.equal((await restore()).changed,false);assert.equal((await db.query('select count(*)::int n from risk_rule_audit')).rows[0].n,1);
await db.exec(`update accounts set status='blown',blown_at='2026-10-20T12:00:00Z',cash=99000 where user_id='${uid}'`);await assert.rejects(restore(99000),/another loss rule/);
await db.exec(`update accounts set status='active',cash=100000,day_start_equity=100000,trading_day=trading_today() where user_id='${uid}'`);assert.equal((await db.query(`select enforce_rules('${uid}',current_season()) status`)).rows[0].status,'blown','touching capped floor still fails');
await assert.rejects(db.exec("set role authenticated;select restore_capped_eod_account('cap_test',102000,'2026-10-20T12:00:00Z')"),/permission denied/);await db.exec('reset role;');
await assert.rejects(db.exec('set role anon;select * from risk_rule_audit'),/permission denied/);await db.exec('reset role;');
console.log('PASS capped EOD floor: fixed $4,200 trail, $50k scaling, EOD rollover, intraday isolation, start-balance cap, remaining buffer, hard mode, exact breach, guarded restoration, no balance/restart/qualifying changes, audit and permissions');
}finally{await db.close()}
