import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const root = new URL('../', import.meta.url).pathname, db = new PGlite();
try {
  await db.exec(`create schema cron; create table cron.job(jobid int,jobname text); create function cron.unschedule(text) returns boolean language sql as 'select true'; create function cron.schedule(text,text,text) returns int language sql as 'select 1';`);
  for (const file of ['supabase_stub.sql','schema.sql','seasons_v2.sql','v3.sql','partials.sql','trading_day.sql','trade_sharing.sql','rules_v4.sql','funded.sql','us30.sql','bars.sql','weekend_markets.sql','weekend.sql','predictions.sql','prediction_tokens.sql','avatars.sql','clean_floor.sql','chart_history.sql','chart_history.sql']) {
    if (file === 'us30.sql') await db.exec("alter type public.market add value if not exists 'us30'");
    await db.exec(readFileSync(root + file, 'utf8'));
  }
  const users = ['viewer', 'spammer', 'quiet', 'outsider'].map((handle, i) => ({ handle, id: `c1000000-0000-0000-0000-00000000000${i + 1}` }));
  for (const u of users) await db.exec(`insert into auth.users(id) values('${u.id}'); insert into profiles(id,handle) values('${u.id}','${u.handle}'); select ensure_account('${u.id}');`);
  const [viewer, spammer, quiet, outsider] = users, squad = 'c2000000-0000-0000-0000-000000000001';
  await db.exec(`insert into squads(id,name,invite_code,owner_id) values('${squad}','History test','HIST01','${viewer.id}'); insert into squad_members(squad_id,user_id) values('${squad}','${viewer.id}'),('${squad}','${spammer.id}'),('${squad}','${quiet.id}');
    insert into quotes(market,price,quoted_at,source) values('nas',100,now(),'test') on conflict(market) do update set price=100,quoted_at=now();
    insert into trades(id,user_id,season,market,side,quantity,entry_price,exit_price,pnl,opened_at,closed_at,reason)
    select gen_random_uuid(),'${spammer.id}',current_season(),'nas','long',1,100,101,2,now()-interval '30 minutes',now()-i*interval '1 second','closed' from generate_series(1,200) i;
    insert into trades(id,user_id,season,market,side,quantity,entry_price,exit_price,pnl,opened_at,closed_at,reason) values
      (gen_random_uuid(),'${quiet.id}',current_season(),'nas','short',1,102,100,4,now()-interval '4 hours',now()-interval '3 hours','closed'),
      (gen_random_uuid(),'${viewer.id}',current_season(),'nas','long',1,100,102,4,now()-interval '4 hours',now()-interval '3 hours','closed'),
      (gen_random_uuid(),'${quiet.id}',current_season(),'nas','long',1,100,102,4,now()-interval '31 hours',now()-interval '30 hours','closed'),
      (gen_random_uuid(),'${outsider.id}',current_season(),'nas','long',1,100,102,4,now()-interval '4 hours',now()-interval '3 hours','closed'),
      (gen_random_uuid(),'${quiet.id}',current_season(),'gold','long',1,100,102,20,now()-interval '4 hours',now()-interval '3 hours','closed');
    alter table positions disable trigger set_position_session; -- fixture must not depend on market hours (CI runs on weekends)
    insert into positions(user_id,season,market,side,quantity,entry_price,opened_at) values('${quiet.id}',current_season(),'nas','long',1,100,now()-interval '31 hours');
    alter table positions enable trigger set_position_session;
    set role authenticated; set request.jwt.claim.sub='${viewer.id}';`);
  const rpc = async args => (await db.query(`select chart_bubbles(${args}) data`)).rows[0].data;
  const rows = await rpc(`'nas','${squad}'`);
  assert.equal(rows.filter(b => b.handle === 'spammer').length, 200, 'no global row cap');
  assert.equal(rows.filter(b => b.handle === 'quiet' && b.state === 'closed').length, 1, 'quiet player survives 200 later closes');
  assert.equal(rows.filter(b => b.is_you).length, 1, 'viewer history retained');
  assert.equal(rows.filter(b => b.handle === 'outsider').length, 0, 'only squad and viewer');
  assert.equal(rows.find(b => b.state === 'open').entry_price, 100, 'old open positions always included');
  assert.equal(rows.find(b => b.state === 'open').dd_floor, 92000, 'EOD drawdown floor preserved');
  assert(rows.every(b => b.opened_at && b.at), 'entry and exit timestamps available');
  const expanded = await rpc(`'nas','${squad}',now()-interval '48 hours'`);
  assert.equal(expanded.filter(b => b.handle === 'quiet' && b.state === 'closed').length, 2, 'expanded chart history includes older fills');
  const narrow = await rpc(`'nas','${squad}',now()-interval '1 hour'`);
  assert.equal(narrow.filter(b => b.state === 'closed').length, 200, 'window applies to closed history');
  assert.equal(narrow.filter(b => b.state === 'open').length, 1, 'window never hides open positions');
  assert((await rpc("'nas',null")).every(b => b.is_you), 'no squad means own trades only');
  assert((await rpc("'nas'")).every(b => b.is_you), 'one-argument legacy clients supported');
  await assert.rejects(rpc("'nas','c2000000-0000-0000-0000-000000000002'"), /not in that squad/);
  await db.exec('reset role; set role anon');
  await assert.rejects(rpc("'nas',null,null"), /permission denied/);
  console.log('PASS SQL: 200 spam closes preserve quiet players, exact fills, open positions, history windows, legacy defaults, drawdown floors, authorization and rerunnable migration');
} finally { await db.close(); }
