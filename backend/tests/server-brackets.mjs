import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const root=new URL('../',import.meta.url).pathname, db=new PGlite();
await db.exec(`create schema cron; create table cron.job(jobid int,jobname text); create function cron.unschedule(text) returns boolean language sql as 'select true'; create function cron.schedule(text,text,text) returns int language sql as 'select 1';`);
for(const file of ['supabase_stub.sql','schema.sql','seasons_v2.sql','v3.sql','partials.sql','trading_day.sql','trade_sharing.sql','rules_v4.sql','funded.sql','us30.sql','bars.sql','weekend_markets.sql','weekend.sql','predictions.sql','prediction_tokens.sql','avatars.sql']) {
 if(file==='us30.sql') await db.exec("alter type public.market add value if not exists 'us30';");
 try { await db.exec(readFileSync(root+file,'utf8')); } catch(e) {console.error(file,e.message);throw e;}
}

await db.exec(readFileSync(root+'clean_floor.sql','utf8'));
const migration=readFileSync(root+'server_brackets.sql','utf8');await db.exec(migration);await db.exec(migration);
const uid='d1000000-0000-0000-0000-000000000001', other='d1000000-0000-0000-0000-000000000002';
await db.exec(`insert into auth.users(id) values('${uid}'),('${other}');insert into profiles(id,handle) values('${uid}','stop_sam'),('${other}','stop_other');set request.jwt.claim.sub='${uid}';select ensure_account('${uid}');select ensure_account('${other}');
create or replace function public.market_session_open(p_market public.market,p_at timestamptz default now()) returns boolean language sql stable as 'select true';`);
const rpc=async sql=>(await db.query(sql)).rows[0].r;
const quote=async(price,offset=0)=>db.exec(`select ingest_quotes(jsonb_build_array(jsonb_build_object('market','nas','price',${price},'quoted_at',now()+interval '${offset} seconds')));`);
const open=async(side='long',qty=1)=>{const p=await rpc(`select open_position('nas','${side}',${qty}) r`);await db.exec(`update positions set opened_at=now()-interval '10 seconds',session_closes_at=now()+interval '1 day' where id='${p.id}';`);return p;};
const save=async(id,kind,level)=>rpc(`select set_position_bracket('${id}','${kind}',${level}) r`);
await quote(30000,-5);const p=await open(),p2=await open();
await save(p.id,'sl',29990);await save(p.id,'tp',30020);
assert.equal((await db.query('select count(*)::int n from positions where stop_loss=29990 and take_profit=30020')).rows[0].n,2,'stop applies to all stack legs');
await assert.rejects(save(p.id,'sl',30001),/already crossed/);
await assert.rejects(save(p.id,'sl',"'NaN'"),/valid price/);
await db.exec(`set request.jwt.claim.sub='${other}';`);await assert.rejects(save(p.id,'sl',29980),/already closed/);await db.exec(`set request.jwt.claim.sub='${uid}';`);
const added=await open();assert.equal((await db.query(`select stop_loss::float sl from positions where id='${added.id}'`)).rows[0].sl,29990,'new size inherits protection');
// No browser call. The feed alone fills all stops at the actual next quote.
await quote(29989,0);
let rows=(await db.query("select reason,exit_price::float,trigger_price::float,pnl::float from trades order by id")).rows;
assert.equal(rows.length,3);assert(rows.every(t=>t.reason==='stop_loss'&&t.exit_price===29989&&t.trigger_price===29990&&t.pnl===-22));
await quote(29989,1);assert.equal((await db.query('select count(*)::int n from trades')).rows[0].n,3,'duplicate feed does not settle twice');
assert.equal((await db.query(`select cash::float from accounts where user_id='${uid}'`)).rows[0].cash,99934);
// Short target, cancel, hedge isolation, old quotes and stale save rejection.
await quote(30000,2);const short=await open('short');await save(short.id,'sl',30010);await save(short.id,'tp',29980);await save(short.id,'sl','null');
assert.equal((await db.query(`select stop_loss from positions where id='${short.id}'`)).rows[0].stop_loss,null);
await quote(29970,-10);assert.equal((await db.query(`select count(*)::int n from positions where id='${short.id}'`)).rows[0].n,1,'older quote cannot trigger');
await quote(29979,3);assert.equal((await db.query(`select reason from trades where id='${short.id}'`)).rows[0].reason,'take_profit');
await db.exec(`update quotes set price=30000,quoted_at=now()-interval '5 seconds' where market='nas';`);
const hedgeLong=await open('long'),hedgeShort=await open('short');await save(hedgeLong.id,'sl',29990);assert.equal((await db.query(`select stop_loss from positions where id='${hedgeShort.id}'`)).rows[0].stop_loss,null,'other side remains independent');
await db.exec(`update quotes set quoted_at=now()-interval '60 seconds' where market='nas';`);await assert.rejects(save(hedgeLong.id,'sl',29980),/fresh price/);
await db.exec(`update quotes set quoted_at=now()-interval '5 seconds' where market='nas';`);
// Stop reason wins over a daily-loss close at the same tick, but legitimate limits still apply.
await db.exec(`update accounts set day_start_equity=(cash+1)/(1-daily_loss_pct/100) where user_id='${uid}';`);await quote(29989,0);
assert.equal((await db.query(`select reason from trades where id='${hedgeLong.id}'`)).rows[0].reason,'stop_loss');
assert.equal((await db.query(`select status from accounts where user_id='${uid}'`)).rows[0].status,'locked');
assert((await rpc('select my_state() r')).rules.unlock_at,'locked state includes reset deadline');
await db.exec('select refresh_daily_locks();');assert.equal((await db.query(`select status from accounts where user_id='${uid}'`)).rows[0].status,'locked','same-day lock is not bypassed');
// A normal rollover unlocks a flat account automatically, without changing its cash.
const before=(await db.query(`select cash::float from accounts where user_id='${uid}'`)).rows[0].cash;
await db.exec(`update accounts set trading_day=trading_today()-1 where user_id='${uid}'; select refresh_daily_locks();`);
const after=(await db.query(`select cash::float,status from accounts where user_id='${uid}'`)).rows[0];assert.equal(after.status,'active');assert.equal(after.cash,before);
// Remaining quantity stays protected after a partial close.
await db.exec(`update quotes set price=30000,quoted_at=now()-interval '5 seconds' where market='nas';`);
const partial=await open('long',3);await save(partial.id,'sl',29990);await rpc("select reduce_position('nas','long',1) r");
const protectedRemainder=(await db.query(`select quantity,stop_loss::float from positions where id='${partial.id}'`)).rows[0];assert.equal(protectedRemainder.quantity,2);assert.equal(protectedRemainder.stop_loss,29990);
await quote(29989,0);assert.equal((await db.query(`select quantity,reason from trades where id='${partial.id}'`)).rows[0].quantity,2);
// Session-end settlement takes precedence over a reopening tick.
await db.exec(`update quotes set price=30000,quoted_at=now()-interval '5 seconds' where market='nas';`);
const expired=await open();await save(expired.id,'sl',29990);await db.exec(`update positions set session_closes_at=now()-interval '1 second' where id='${expired.id}';`);await quote(29970,1);
assert.equal((await db.query(`select reason from trades where id='${expired.id}'`)).rows[0].reason,'market_close');
await db.exec(`update accounts set status='blown',trading_day=trading_today()-1 where user_id='${other}';select refresh_daily_locks();`);assert.equal((await db.query(`select status from accounts where user_id='${other}'`)).rows[0].status,'blown','season failures are not silently reset');
assert((await db.query('select count(*)::int n from bracket_audit')).rows[0].n>5,'saved levels and fills are audited');
await assert.rejects(db.exec(`set role anon;select set_position_bracket('${p.id}','sl',2);`),/permission denied/);await db.exec('reset role;');
await assert.rejects(db.exec('set role authenticated;select process_position_brackets(\'nas\');'),/permission denied/);await db.exec('reset role;');
console.log('PASS server stops: background fills, stacked size/inheritance, long SL, short TP, cancellation, hedge isolation, stale/out-of-order quotes, duplicate fills, risk ordering, daily unlock, audit and ownership');await db.close();
