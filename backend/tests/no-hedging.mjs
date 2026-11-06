import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const root=new URL('../',import.meta.url).pathname,db=new PGlite();
try {
 await db.exec(`create schema cron;create table cron.job(jobid int,jobname text);create function cron.unschedule(text) returns boolean language sql as 'select true';create function cron.schedule(text,text,text) returns int language sql as 'select 1';`);
 for(const f of ['supabase_stub.sql','schema.sql','seasons_v2.sql','v3.sql','partials.sql','trading_day.sql','trade_sharing.sql','rules_v4.sql','funded.sql','us30.sql','bars.sql','weekend_markets.sql','weekend.sql','predictions.sql','prediction_tokens.sql','avatars.sql','clean_floor.sql','server_brackets.sql','capped_eod_floor.sql','remove_daily_loss.sql','no_hedging.sql','no_hedging.sql']){
  if(f==='us30.sql')await db.exec("alter type public.market add value if not exists 'us30'");await db.exec(readFileSync(root+f,'utf8'));
 }
 const uid='f1000000-0000-0000-0000-000000000001';
 await db.exec(`insert into auth.users(id) values('${uid}');insert into profiles(id,handle) values('${uid}','netting_test');set request.jwt.claim.sub='${uid}';select ensure_account('${uid}');create or replace function public.market_session_open(p_market public.market,p_at timestamptz default now()) returns boolean language sql stable as 'select true';insert into quotes(market,price,quoted_at,source) values('nas',30000,now(),'test'),('gold',4000,now(),'test') on conflict(market) do update set price=excluded.price,quoted_at=excluded.quoted_at;`);
 const rpc=async sql=>(await db.query(sql)).rows[0].r;
 const p=await rpc("select open_position('nas','long',10) r");
 await rpc("select open_position('nas','long',5) r");
 await assert.rejects(rpc("select open_position('nas','short',1) r"),/Reduce or close/);
 assert.equal((await db.query(`select sum(quantity)::int n from positions where user_id='${uid}' and market='nas'`)).rows[0].n,15,'rejected hedge adds no position');
 await rpc(`select set_position_bracket('${p.id}','sl',29990) r`);
 const reduced=await rpc("select reduce_position('nas','long',3) r");assert.equal(reduced.closed,3);
 assert.equal((await db.query(`select sum(quantity)::int n from positions where user_id='${uid}' and market='nas'`)).rows[0].n,12);
 assert((await db.query(`select stop_loss from positions where user_id='${uid}' and market='nas'`)).rows.every(p=>Number(p.stop_loss)===29990),'remaining size retains bracket');
 await rpc("select open_position('gold','short',1) r");
 await rpc("select reduce_position('nas','long',100) r");
 const short=await rpc("select open_position('nas','short',1) r");assert.equal(short.side,'short','new direction opens after flattening');
 assert.equal((await db.query(`select count(*)::int n from trades where user_id='${uid}'`)).rows[0].n,3,'all partial/close receipts preserved');
 await assert.rejects(db.exec('set role authenticated;select guard_one_direction()'),/permission denied/);
 console.log('PASS no hedging: same-direction adds, opposing opens rejected, partials and brackets preserved, separate markets independent, reversal after flat, exact receipt history and rerunnable guard');
} catch(e){console.error(e.message);process.exitCode=1;}finally{await db.close();}
