// rush_candles(): candles() with a chosen end, public, capped at now() and 300 bars. Disposable PGlite DB.
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const root = new URL('../', import.meta.url).pathname, db = new PGlite();
try {
  await db.exec(`create schema cron; create table cron.job(jobid int,jobname text); create function cron.unschedule(text) returns boolean language sql as 'select true'; create function cron.schedule(text,text,text) returns int language sql as 'select 1';`);
  for (const file of ['supabase_stub.sql', 'schema.sql', 'bars.sql', 'rush.sql', 'rush.sql']) await db.exec(readFileSync(root + file, 'utf8'));
  // 600 one-minute NAS bars ending 2 hours ago (price = 20000 + minute number), with a gap of 5 minutes in the middle.
  const endMin = Math.floor(Date.now() / 60000) - 120, startMin = endMin - 600;
  await db.exec(`insert into bars(market,secs,idx,open,high,low,close,first_at,last_at)
    select 'nas',60,m,20000+m-${startMin},20000+m-${startMin}+2,20000+m-${startMin}-1,20000+m-${startMin}+1,to_timestamp(m*60),to_timestamp(m*60+59)
    from generate_series(${startMin},${endMin - 1}) m where m not between ${startMin + 300} and ${startMin + 304};
    insert into bars(market,secs,idx,open,high,low,close,first_at,last_at) values ('gold',60,${endMin - 10},1,1,1,1,now(),now());`);
  const iso = m => new Date(m * 60000).toISOString();
  await db.exec('set role anon');
  const rush = async (end, limit = 100, bucket = 60, market = 'nas') =>
    (await db.query(`select rush_candles('${market}',${bucket},${end === null ? 'null' : `'${end}'`},${limit}) data`)).rows[0].data;

  const a = await rush(iso(endMin - 60));
  assert.equal(a.length, 100, 'returns p_limit bars');
  assert.equal(a.at(-1).index, endMin - 61, 'last bar is the one before p_end (p_end bucket excluded)');
  assert(a.every((b, i) => i === 0 || b.index > a[i - 1].index), 'ascending like candles()');
  assert.deepEqual(Object.keys(a[0]).sort(), ['close', 'high', 'index', 'low', 'open'], 'same shape as candles()');
  assert.equal(a.at(-1).open, 20000 + (endMin - 61 - startMin), 'prices are the stored bars');
  assert.deepEqual(await rush(iso(endMin - 60)), a, 'same seed gives the same bars');
  assert.equal((await rush(iso(endMin - 60) .replace('Z', '+00:00'))).length, 100);
  // Inside a minute: 12:34:30 ends after the 12:33 bar, just like 12:34:00.
  assert.deepEqual(await rush(new Date((endMin - 60) * 60000 + 30000).toISOString()), a, 'mid-minute end excludes the partial bucket');
  assert.equal((await rush(iso(endMin - 60), 1000)).length, 300, 'limit capped at 300');
  assert.equal((await rush(iso(endMin - 60), 1)).length, 5, 'limit floor of 5, like candles()');
  const future = await rush(new Date(Date.now() + 86400e3).toISOString());
  assert.equal(future.at(-1).index, endMin - 1, 'p_end in the future is capped at now()');
  assert.equal((await rush(null)).at(-1).index, endMin - 1, 'null p_end means now');
  const five = await rush(iso(endMin), 20, 300);
  assert.equal(five.length, 20, '5-minute buckets built from 1m bars');
  const b5 = five.at(-1), first = b5.index * 5 - startMin;
  assert.deepEqual([b5.open, b5.close, b5.high, b5.low], [20000 + first, 20000 + first + 5, 20000 + first + 6, 20000 + first - 1], '5m bucket: first open, last close, widest range');
  const gap = await rush(iso(startMin + 340), 100);
  assert.equal(gap.length, 100, 'looks further back to fill the limit, like candles()');
  assert(!gap.some(b => b.index >= startMin + 300 && b.index <= startMin + 304), 'gaps are not invented');
  assert.equal(gap.at(-1).index - gap[0].index, 104, 'missing minutes are skipped, not filled');
  assert.equal((await rush(iso(endMin), 100, 60, 'gold')).length, 1, 'other markets stay separate');
  assert.deepEqual(await rush(iso(startMin - 5000)), [], 'before history: empty array');
  await db.exec('reset role; set role authenticated');
  assert.equal((await rush(iso(endMin - 60))).length, 100, 'signed-in players can call it');
  await assert.rejects(db.query('select count(*) from bars'), /permission denied/, 'bars stay private');
  await db.exec('reset role');
  console.log('PASS SQL rush_candles: fixed end, excludes the p_end bucket, ascending candles() shape, deterministic, limit 5..300, now() cap, 5m aggregation, gaps, anon + authenticated, bars private, rerunnable');
} finally { await db.close(); }
