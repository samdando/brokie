import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const root=new URL('../',import.meta.url).pathname, db=new PGlite();
await db.exec(`create schema cron; create table cron.job(jobid int,jobname text); create function cron.unschedule(text) returns boolean language sql as 'select true'; create function cron.schedule(text,text,text) returns int language sql as 'select 1';`);
for(const file of ['supabase_stub.sql','schema.sql','seasons_v2.sql','v3.sql','partials.sql','trading_day.sql','trade_sharing.sql','rules_v4.sql','funded.sql','us30.sql','bars.sql','weekend_markets.sql','weekend.sql','predictions.sql','prediction_tokens.sql','avatars.sql']) {
 if(file==='us30.sql') await db.exec("alter type public.market add value if not exists 'us30';");
 try { await db.exec(readFileSync(root+file,'utf8')); } catch(e) {console.error(file,e.message);throw e;}
}
const uid='c1000000-0000-0000-0000-000000000001', next='c1000000-0000-0000-0000-000000000002';
await db.exec(`insert into auth.users(id) values('${uid}'); insert into profiles(id,handle) values('${uid}','clean_sam'); insert into prediction_wallets(user_id,balance) values('${uid}',3);`);
const migration=readFileSync(root+'clean_floor.sql','utf8'); await db.exec(migration); await db.exec(migration);
assert.equal((await db.query(`select balance::float from prediction_wallets where user_id='${uid}'`)).rows[0].balance,8,'grant once, preserve earnings');
await db.exec(`insert into auth.users(id) values('${next}'); insert into profiles(id,handle) values('${next}','clean_ankit');`);
assert.equal((await db.query(`select balance::float from prediction_wallets where user_id='${next}'`)).rows[0].balance,5,'new player gets five');
await db.exec(`set request.jwt.claim.sub='${uid}';`);
const rpc=async sql=>(await db.query(sql)).rows[0].r;
assert.equal((await rpc(`select avatar_shop() r`)).items.filter(i=>i.price===0).length,4);
await db.exec(`select equip_avatar('koala'); select set_profile_color('#7CC8FF');`);
assert.equal((await rpc(`select player_avatars(array['clean_sam']) r`))['clean_sam'].color,'#7CC8FF');
assert.equal((await rpc(`select avatar_shop() r`)).balance,8,'free equip/colour');
await db.exec(`select buy_avatar('bull'); select buy_avatar('bull');`);
assert.equal((await rpc(`select avatar_shop() r`)).balance,5,'premium charged once');
await assert.rejects(db.exec(`select equip_avatar('crown')`),/Buy this avatar first/);
await assert.rejects(db.exec(`select set_profile_color('javascript:bad')`),/Choose a profile colour/);
await assert.rejects(db.exec(`set role anon; select set_profile_color('#7CC8FF')`),/permission denied/); await db.exec('reset role;');
await db.exec(`select ensure_account('${uid}'); insert into accounts(user_id,season,cash,start_balance,peak_equity,day_start_equity) values('${uid}',current_season()+56,100000,100000,100000,110000);`);
const accounts=(await db.query(`select season=current_season() as current,daily_loss_amount::float,daily_loss_floor(accounts)::float as floor from accounts where user_id='${uid}' order by season`)).rows;
assert.equal(accounts[0].daily_loss_amount,null);assert.equal(accounts[1].daily_loss_amount,2000);assert.equal(accounts[1].floor,108000);
const source=async f=>(await db.query(`select pg_get_functiondef('${f}'::regprocedure) s`)).rows[0].s;
assert((await source('my_state()')).includes('daily_loss_floor(acct)'));
const order=await source('open_position(market,trade_side,integer)');assert(order.includes('p_quantity not between 1 and 100'));assert(order.includes('Not enough buying power'));assert(order.includes('recent >= 5'));
await assert.rejects(db.exec(`select open_position('nas','long',101)`),/Choose 1 to 100/);
await assert.rejects(db.exec(`select open_position('nas','long',null)`),/Choose 1 to 100/);
assert((await source('enforce_rules(uuid,date)')).includes('eq <= daily_loss_floor(a)'));
// Exercise the fixed-dollar boundary rather than relying on function text alone.
await db.exec(`update accounts set trading_day=trading_today(),cash=108001,day_start_equity=110000,eod_peak=110000,peak_equity=110000 where user_id='${uid}' and season=current_season()+56;`);
assert.equal((await db.query(`select enforce_rules('${uid}',current_season()+56) s`)).rows[0].s,'active');
await db.exec(`update accounts set cash=108000 where user_id='${uid}' and season=current_season()+56;`);
assert.equal((await db.query(`select enforce_rules('${uid}',current_season()+56) s`)).rows[0].s,'locked','exact $2k breach locks');
// Feed/session time is fixed only in this disposable database.
await db.exec(`create or replace function public.market_session_open(p_market public.market,p_at timestamptz default now()) returns boolean language sql stable as 'select true';`);
await db.exec(`insert into quotes(market,price,quoted_at,source) values('nas',30000,now(),'test') on conflict(market) do update set price=30000,quoted_at=now();`);
const filled=await rpc(`select open_position('nas','long',100) r`);assert.equal(filled.quantity,100,'100-micro fill');
await assert.rejects(db.exec(`select open_position('nas','long',1)`),/Not enough buying power/);
console.log('PASS starter grant/rerun, new players, free/paid avatars, colours, permissions, next-season $2k floor and order guards'); await db.close();
