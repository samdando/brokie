import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const root=new URL('../',import.meta.url).pathname, db=new PGlite();
try {
 await db.exec(`create schema cron;create table cron.job(jobid int,jobname text);create function cron.unschedule(text) returns boolean language sql as 'select true';create function cron.schedule(text,text,text) returns int language sql as 'select 1';`);
 for(const file of ['supabase_stub.sql','schema.sql','seasons_v2.sql','v3.sql','partials.sql','trading_day.sql','trade_sharing.sql','rules_v4.sql','funded.sql','us30.sql','bars.sql','weekend_markets.sql','weekend.sql','predictions.sql','prediction_tokens.sql','avatars.sql','clean_floor.sql','server_brackets.sql','capped_eod_floor.sql']) {
  if(file==='us30.sql')await db.exec("alter type public.market add value if not exists 'us30'");
  await db.exec(readFileSync(root+file,'utf8'));
 }
 const uid='d1000000-0000-0000-0000-000000000001', other='d1000000-0000-0000-0000-000000000002';
 await db.exec(`insert into auth.users(id) values('${uid}'),('${other}');insert into profiles(id,handle) values('${uid}','test_fuko'),('${other}','test_sam');select ensure_account('${uid}');select ensure_account('${other}');
 update accounts set cash=283542,day_start_equity=300000,eod_peak=300000,peak_equity=320000,status='locked',locked_at=now(),daily_loss_amount=2000 where user_id='${uid}';
 insert into trades(id,user_id,season,market,side,quantity,entry_price,exit_price,pnl,opened_at,closed_at,reason) values(gen_random_uuid(),'${uid}',current_season(),'nas','short',100,28214,28251.5,-7500,now()-interval '2 hours',now()-interval '1 hour','daily_limit');`);
 const row=async()=> (await db.query(`select * from accounts where user_id='${uid}' and season=current_season()`)).rows[0];
 const before=await row();
 for(let i=0;i<2;i++)await db.exec(readFileSync(root+'remove_daily_loss.sql','utf8'));
 const after=await row();assert.equal(after.cash,before.cash);assert.equal(after.status,'active');assert.equal(after.locked_at,null);assert.equal(after.daily_loss_pct,'0');assert.equal(after.daily_loss_amount,null);assert.equal(after.resets_used,before.resets_used);
 assert.equal((await db.query(`select count(*)::int n from risk_rule_audit where user_id='${uid}' and action='remove_daily_loss'`)).rows[0].n,1,'idempotent audit');
 const enforce=async()=> (await db.query(`select enforce_rules('${uid}',current_season()) s`)).rows[0].s;
 assert.equal(await enforce(),'active','large daily loss above season floor stays active');
 await db.exec(`update accounts set cash=150000,day_start_equity=300000,daily_loss_amount=2000,daily_loss_pct=5,status='locked' where user_id='${uid}'`);
 assert.equal(await enforce(),'active','50% daily loss still does not lock');assert.equal((await row()).daily_loss_pct,'0','legacy writes cannot restore daily stops');
 await db.exec(`set request.jwt.claim.sub='${uid}'`);const state=(await db.query('select my_state() s')).rows[0].s;assert.equal(state.rules.daily_loss_enabled,false);assert.equal(state.rules.daily_loss_pct,0);assert.equal(state.rules.daily_floor,0);assert.equal(state.trades[0].reason,'daily_limit','historical fills remain recorded');
 await db.exec(`insert into accounts(user_id,season,cash,start_balance,peak_equity,day_start_equity,daily_loss_pct,daily_loss_amount) values('${uid}',current_season()+56,100000,100000,100000,100000,3,2000)`);
 assert.equal((await db.query(`select daily_loss_pct::float v from accounts where user_id='${uid}' and season=current_season()+56`)).rows[0].v,0,'future and hard-mode values normalized');
 await db.exec(`update accounts set cash=100000 where user_id='${uid}' and season=current_season()`);assert.equal(await enforce(),'blown','season max loss remains enforced');
 await db.exec(`select buy_back()`);assert.equal((await row()).daily_loss_pct,'0','restart cannot restore daily limit');
 await db.exec(readFileSync(root+'admin_reset_paper_account.sql','utf8'));await db.exec(readFileSync(root+'admin_reset_paper_account.sql','utf8'));
 const reset=async(cash=100000)=> (await db.query(`select admin_reset_paper_account('test_fuko',${cash},'active','test-request-1') r`)).rows[0].r;
 await assert.rejects(reset(123),/Account changed/);assert.equal((await reset()).changed,true);assert.equal((await row()).cash,'100000');assert.equal((await row()).resets_used,0);assert.equal((await row()).status,'active');assert.equal((await row()).blown_at,null);
 assert.equal((await db.query(`select count(*)::int n from trades where user_id='${uid}'`)).rows[0].n,1,'reset preserves history');
 await db.exec(`update accounts set cash=110000 where user_id='${uid}' and season=current_season()`);assert.equal((await reset()).changed,false);assert.equal((await row()).cash,'110000','repeated reset cannot wipe new progress');
 await assert.rejects(db.exec(`set role authenticated;select admin_reset_paper_account('test_fuko',110000,'active','test-request-2')`),/permission denied/);await db.exec('reset role');
 await assert.rejects(db.exec('set role anon;select * from risk_rule_audit'),/permission denied/);
 console.log('PASS no DLL: existing/future/restarted accounts, large daily losses, unlocks, season floor retained, truthful receipts, audited guarded Fuko reset, history preservation, idempotency and denied client access');
} catch(e) { console.error(e.message); process.exitCode=1; } finally { await db.close(); }
