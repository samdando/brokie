import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
const root=new URL('../', import.meta.url).pathname;
const db=new PGlite();
await db.exec(`create schema cron; create table cron.job(jobid int,jobname text); create function cron.unschedule(text) returns boolean language sql as 'select true'; create function cron.schedule(text,text,text) returns int language sql as 'select 1';`);
for (const file of ['supabase_stub.sql','schema.sql','seasons_v2.sql','v3.sql','partials.sql','trading_day.sql','trade_sharing.sql','rules_v4.sql','funded.sql','us30.sql','bars.sql','weekend_markets.sql','weekend.sql']) {
  try { if(file==='us30.sql') await db.exec("alter type public.market add value if not exists 'us30';"); await db.exec(readFileSync(root+file,'utf8')); console.log('Loaded',file); } catch(e) { console.error(file,e.message); process.exit(1); }
}
await db.exec(readFileSync(root+'weekend.sql','utf8')); console.log('Migration rerun passed'); await db.exec(readFileSync(root+'predictions.sql','utf8')); await db.exec(readFileSync(root+'predictions.sql','utf8')); console.log('Prediction migration rerun passed');
await db.exec(readFileSync(root+'tests_weekend.sql','utf8')); console.log('Weekend SQL checks passed'); await db.exec('begin;'); await db.exec(readFileSync(root+'tests_predictions.sql','utf8')); await db.exec('rollback;'); console.log('Prediction SQL checks passed');
await db.exec(readFileSync(root+'prediction_tokens.sql','utf8'));
await db.exec(readFileSync(root+'prediction_tokens.sql','utf8')); console.log('Token migration rerun passed');
await db.exec(readFileSync(root+'tests_prediction_tokens.sql','utf8')); console.log('Prediction token SQL checks passed');
await db.close();
