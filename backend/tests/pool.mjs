// $1 pool: entries (USDC on Base or PayID/cash), hard-mode restart, size cap, no buy-back,
// trailing max loss, profit-weighted split, rollover and permissions.
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const root = new URL('../', import.meta.url).pathname, db = new PGlite();
try {
await db.exec(`create schema cron;create table cron.job(jobid int,jobname text);create function cron.unschedule(text) returns boolean language sql as 'select true';create function cron.schedule(text,text,text) returns int language sql as 'select 1';`);
for (const file of ['supabase_stub.sql','schema.sql','seasons_v2.sql','v3.sql','partials.sql','trading_day.sql','trade_sharing.sql','rules_v4.sql','funded.sql','us30.sql','bars.sql','weekend_markets.sql','weekend.sql','predictions.sql','prediction_tokens.sql','avatars.sql','clean_floor.sql','server_brackets.sql','chart_history.sql','capped_eod_floor.sql']) {
  if (file === 'us30.sql') await db.exec("alter type public.market add value if not exists 'us30'");
  try { await db.exec(readFileSync(root + file, 'utf8')); } catch (e) { console.error(file, e.message); throw e; }
}
const migration = readFileSync(root + 'pool.sql', 'utf8'); await db.exec(migration); await db.exec(migration);

const ids = { a: 'f1000000-0000-0000-0000-00000000000a', b: 'f1000000-0000-0000-0000-00000000000b', c: 'f1000000-0000-0000-0000-00000000000c', d: 'f1000000-0000-0000-0000-00000000000d' };
await db.exec(`insert into auth.users(id) values ${Object.values(ids).map(i => `('${i}')`).join(',')};
insert into profiles(id,handle) values ('${ids.a}','pool_a'),('${ids.b}','pool_b'),('${ids.c}','pool_c'),('${ids.d}','free_d');
create or replace function public.market_session_open(p_market public.market,p_at timestamptz default now()) returns boolean language sql stable as 'select true';`);
for (const u of Object.values(ids)) await db.exec(`select ensure_account('${u}')`);
const rpc = async (sql) => (await db.query(sql)).rows[0].r;
const as = async (u) => db.exec(`set request.jwt.claim.sub='${u}'`);
const acct = async (u) => (await db.query(`select cash::float,status,tier,dd_mode,max_qty,daily_loss_pct::float dl,max_dd_pct::float dd,resets_used,qualify_from,dd_floor(accounts)::float floor from accounts where user_id='${u}' and season=current_season()`)).rows[0];
const quote = async (price) => db.exec(`select ingest_quotes(jsonb_build_array(jsonb_build_object('market','nas','price',${price},'quoted_at',now())))`);
const open = async (qty, side = 'long') => rpc(`select open_position('nas','${side}',${qty}) r`);

// ---- Closed until Sam sets a treasury or PayID -------------------------
await as(ids.a);
assert.equal((await rpc('select pool_config() r')).open, false, 'pool closed by default');
await assert.rejects(rpc(`select join_pool('usdc','0x1111111111111111111111111111111111111111') r`), /aren't open yet/);
await db.exec(`insert into brokie_private(key,value) values ('pool_usdc_treasury','0xAbCdEf0000000000000000000000000000000001'),('pool_payid','0400 000 000')`);
const cfg = await rpc('select pool_config() r');
assert.equal(cfg.open, true); assert.equal(cfg.rules.max_qty, 5); assert.equal(cfg.rules.dd_mode, 'trailing'); assert.equal(cfg.house_pct, 10);
assert.equal(cfg.usdc_treasury, '0xAbCdEf0000000000000000000000000000000001');

// ---- Registering a wallet --------------------------------------------
await assert.rejects(rpc(`select join_pool('usdc','nope') r`), /Base wallet address/);
await assert.rejects(rpc(`select join_pool('usdc','0xabcdef0000000000000000000000000000000001') r`), /treasury/);
await assert.rejects(rpc(`select join_pool('card') r`), /Pick USDC or PayID/);
let mine = await rpc(`select join_pool('usdc','0xAAAA000000000000000000000000000000000001') r`);
assert.equal(mine.entry.status, 'pending'); assert.equal(mine.entry.wallet, '0xaaaa000000000000000000000000000000000001', 'wallet stored lower-case'); assert.equal(mine.tier, 'free');
await as(ids.b);
await assert.rejects(rpc(`select join_pool('usdc','0xaaaa000000000000000000000000000000000001') r`), /another player/);
mine = await rpc(`select join_pool('payid') r`); assert.equal(mine.entry.rail, 'payid'); assert.equal(mine.entry.status, 'pending');
mine = await rpc('select leave_pool() r'); assert.equal(mine.entry, null, 'pending entry can be withdrawn');

// ---- Payment lands: account restarts on hard mode ----------------------
await as(ids.a); await quote(20000); await open(10);
await db.exec(`update positions set opened_at=now()-interval '10 seconds' where user_id='${ids.a}'`);
await quote(20100);   // +2,000 open
assert.equal((await acct(ids.a)).cash, 100000);
await db.exec('reset role');
let r = (await db.query(`select pool_mark_paid('0xAAAA000000000000000000000000000000000001','0xtx1',0.5) r`)).rows[0].r;
assert.equal(r.short, true, 'half an entry stays pending');
assert.equal((await db.query(`select status, amount::float from pool_entries where user_id='${ids.a}'`)).rows[0].status, 'pending');
r = (await db.query(`select pool_mark_paid('0xaaaa000000000000000000000000000000000001','0xtx2',1) r`)).rows[0].r;
assert.equal(r.paid, true); assert.equal(r.handle, 'pool_a');
let a = await acct(ids.a);
assert.equal(a.cash, 100000, 'restart at $100k, the +2k open profit is gone'); assert.equal(a.tier, 'pool'); assert.equal(a.dd_mode, 'trailing');
assert.equal(a.dl, 3); assert.equal(a.dd, 5); assert.equal(a.max_qty, 5); assert.equal(a.status, 'active'); assert.equal(a.floor, 95000, 'trailing floor 5% under peak');
assert.equal((await db.query(`select reason from trades where user_id='${ids.a}'`)).rows[0].reason, 'reset', 'open position closed with a reset receipt');
assert.equal((await db.query(`select count(*)::int n from positions where user_id='${ids.a}'`)).rows[0].n, 0);
r = (await db.query(`select pool_mark_paid('0xaaaa000000000000000000000000000000000001','0xtx2',1) r`)).rows[0].r;
assert.equal(r.duplicate, true, 'same tx twice is ignored');
r = (await db.query(`select pool_mark_paid('0xbbbb000000000000000000000000000000000001','0xtx3',1) r`)).rows[0].r;
assert.equal(r.matched, false, 'unknown wallet does not match');
await as(ids.a);
await assert.rejects(rpc(`select join_pool('payid') r`), /already in/);
mine = await rpc('select my_pool() r'); assert.equal(mine.tier, 'pool'); assert.equal(mine.entry.status, 'paid'); assert.equal(mine.standings.entries, 1); assert.equal(mine.standings.total, 0.9);

// ---- Hard mode: at most 5 micros open ---------------------------------
await quote(20000);
await open(3); await open(2);
await assert.rejects(open(1), /Hard mode: max 5 micros/);
await db.exec(`update positions set opened_at=now()-interval '10 seconds' where user_id='${ids.a}'`);

// ---- Trailing 5%: a spike then a 5% fall from the peak blows it ---------
// 5 micros × $2/pt: +$5,000 needs +500 pts. Peak 105k, floor 99,750; 99,750 ⇒ 20,000 - 50 pts.
await quote(20500); a = await acct(ids.a); assert.equal(a.floor, 99750, 'floor trails the intraday peak');
await quote(19950); a = await acct(ids.a); assert.equal(a.status, 'blown', 'touching the trailing floor blows the account');
await assert.rejects(rpc('select buy_back() r'), /no buy-back/);

// ---- Standings: split by positive return among qualified, unblown players ----
await as(ids.b); await rpc(`select join_pool('payid') r`); await db.exec('reset role');
await db.exec(`select admin_confirm_entry('pool_b','payid 1234'); select admin_confirm_entry('pool_c');`);
assert.equal((await db.query(`select rail,reference from pool_entries where user_id='${ids.b}'`)).rows[0].rail, 'payid', 'a PayID entry keeps its rail when confirmed');
assert.equal((await db.query(`select rail,status from pool_entries where user_id='${ids.c}'`)).rows[0].rail, 'cash', 'confirming someone who never tapped makes a cash entry');
assert.equal((await db.query(`select admin_confirm_entry('pool_b') r`)).rows[0].r.already_paid, true);
assert.equal((await acct(ids.b)).tier, 'pool');
const days = async (u, n) => { for (let i = 1; i <= n; i++) await db.exec(`insert into trades (id,user_id,season,market,side,quantity,entry_price,exit_price,pnl,opened_at,closed_at,reason) values (gen_random_uuid(),'${u}',current_season(),'gold','long',1,4000,4000,0,now()-${i}*interval '1 day',now()-${i}*interval '1 day','closed')`); await db.exec(`update accounts set qualify_from=now()-interval '30 days' where user_id='${u}'`); };
await db.exec(`update accounts set cash=105000 where user_id='${ids.b}' and season=current_season(); update accounts set cash=102500 where user_id='${ids.c}' and season=current_season();`);
await as(ids.b);
let st = await rpc('select pool_standings() r');
assert.equal(st.entries, 3); assert.equal(st.pool, 2.7); assert.equal(st.total, 2.7); assert.equal(st.has_winner, false, 'nobody has 5 trading days yet');
await db.exec('reset role'); await days(ids.b, 5); await days(ids.c, 5); await as(ids.b);
st = await rpc('select pool_standings() r');
assert.equal(st.has_winner, true);
const row = (h) => st.rows.find((x) => x.handle === h);
assert.equal(row('pool_b').is_you, true); assert.equal(row('pool_b').eligible, true); assert.equal(row('pool_b').share_pct, 66.67); assert.equal(row('pool_b').payout, 1.8);
assert.equal(row('pool_c').share_pct, 33.33); assert.equal(row('pool_c').payout, 0.9);
assert.equal(row('pool_a').eligible, false); assert.equal(row('pool_a').payout, 0, 'blown gets nothing');
assert.equal(st.rows[0].handle, 'pool_b', 'sorted by eligibility then return');
// One in profit takes it all.
await db.exec(`update accounts set cash=99000 where user_id='${ids.c}' and season=current_season()`);
st = await rpc('select pool_standings() r'); assert.equal(row('pool_b').payout, 2.7); assert.equal(row('pool_c').eligible, false, 'a loss gets nothing');
// Free players are not in the standings.
assert.equal(st.rows.some((x) => x.handle === 'free_d'), false);

// ---- Rollover: a winnerless earlier season carries forward ----------------
await db.exec('reset role');
await db.exec(`insert into accounts (user_id,season,cash,start_balance,peak_equity,day_start_equity,trading_day,status,tier) values ('${ids.d}',current_season()-56,98000,100000,100000,100000,current_season(),'active','pool');
insert into pool_entries (user_id,season,rail,status,amount,paid_at) values ('${ids.d}',current_season()-56,'cash','paid',1,now());`);
await as(ids.b);
st = await rpc('select pool_standings() r'); assert.equal(st.rollover, 0.9); assert.equal(st.total, 3.6); assert.equal(row('pool_b').payout, 3.6);
assert.equal((await rpc(`select pool_standings(current_season()-56) r`)).has_winner, false);

// ---- Payout sheet and permissions ----------------------------------------
await db.exec('reset role');
const sheet = (await db.query('select * from pool_payouts()')).rows;
assert.equal(sheet.length, 1); assert.equal(sheet[0].handle, 'pool_b'); assert.equal(+sheet[0].payout, 3.6); assert.equal(sheet[0].rail, 'payid');
const ws = (await db.query('select pool_watch_state() r')).rows[0].r;
assert.equal(ws.treasury, '0xAbCdEf0000000000000000000000000000000001'); assert.equal(ws.last_block, 0); assert.deepEqual(ws.pending, []);
await db.exec('select pool_set_cursor(123456)'); assert.equal((await db.query('select pool_watch_state() r')).rows[0].r.last_block, 123456);
await db.exec(`select admin_void_entry('pool_c')`);
await as(ids.b); st = await rpc('select pool_standings() r'); assert.equal(st.entries, 2, 'voided entry stops counting');
for (const sql of [`select pool_mark_paid('0x','x',1)`, `select admin_confirm_entry('pool_c')`, `select admin_void_entry('pool_c')`, 'select * from pool_payouts()', 'select pool_watch_state()', 'select pool_set_cursor(1)', 'select * from pool_entries', `select pool_setting('pool_usdc_treasury')`]) {
  await assert.rejects(db.exec(`set role authenticated; ${sql}`), /permission denied/, sql); await db.exec('reset role');
}
await db.exec(`set role authenticated; set request.jwt.claim.sub='${ids.b}'; select my_pool(); select pool_config(); select pool_standings(); reset role;`);
console.log('PASS $1 pool: closed until configured, wallet checks, short/duplicate/unknown payments, hard-mode restart, 5-micro cap, trailing 5% blow-up, no buy-back, PayID/cash confirm, profit-weighted split, winner takes all, rollover, payout sheet, voiding, permissions, re-runnable');
} finally { await db.close(); }
