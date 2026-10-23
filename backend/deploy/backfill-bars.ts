// Brokie · backfill-bars (one-off, safe to rerun)
// Pulls OANDA mid candles for every market in `markets` and folds them into public.bars via
// backfill_bars(): 1-minute (last ~3.5 trading days), 1-hour (~10 months) and daily (~2 years,
// 00:00 UTC days, matching how the chart buckets time). Live ticks and history merge the same
// way, so running this again, or while prices are flowing, is harmless.
//
// Deploy as `backfill-bars` with "Verify JWT" OFF; it checks the same database-generated
// secret as the price feed (brokie_private.cron_secret). Run it once from SQL:
//   select net.http_post(
//     url := replace((select value from brokie_private where key = 'ingest_url'), 'smart-action', 'backfill-bars'),
//     headers := jsonb_build_object('Content-Type', 'application/json',
//       'x-cron-secret', (select value from brokie_private where key = 'cron_secret')),
//     body := '{}'::jsonb, timeout_milliseconds := 120000);
// and read the result in net._http_response.

const GRANULARITIES: { g: string; secs: number; count: number }[] = [
  { g: "M1", secs: 60, count: 5000 },
  { g: "H1", secs: 3600, count: 5000 },
  { g: "D", secs: 86400, count: 730 },
];

Deno.serve(async (req: Request) => {
  const serviceKey = Deno.env.get("BROKIE_SERVICE_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!serviceKey) return json({ error: "No service key available to the function" }, 500);
  const headers: Record<string, string> = { apikey: serviceKey, "Content-Type": "application/json" };
  if (serviceKey.startsWith("eyJ")) headers.Authorization = `Bearer ${serviceKey}`;
  const base = `${Deno.env.get("SUPABASE_URL")}/rest/v1`;

  const check = await fetch(`${base}/rpc/check_cron_secret`, {
    method: "POST", headers, body: JSON.stringify({ p_secret: req.headers.get("x-cron-secret") ?? "" }),
  });
  if (!check.ok || (await check.json()) !== true) return new Response("forbidden", { status: 403 });

  const token = Deno.env.get("OANDA_TOKEN");
  if (!token) return json({ error: "OANDA_TOKEN not set" }, 500);
  const host = Deno.env.get("OANDA_HOST") ?? "https://api-fxpractice.oanda.com";

  const mk = await fetch(`${base}/markets?select=id,instrument`, { headers });
  if (!mk.ok) return json({ error: `markets ${mk.status}` }, 502);
  const markets = (await mk.json()) as { id: string; instrument: string }[];

  const report: Record<string, unknown> = {};
  for (const m of markets) {
    for (const { g, secs, count } of GRANULARITIES) {
      const url = `${host}/v3/instruments/${m.instrument}/candles?granularity=${g}&count=${count}&price=M` +
        `&alignmentTimezone=UTC&dailyAlignment=0`;
      const r = await fetch(url, { headers: { Authorization: `Bearer ${token}`, "Accept-Datetime-Format": "RFC3339" } });
      if (!r.ok) { report[`${m.id}:${g}`] = `OANDA ${r.status}: ${(await r.text()).slice(0, 120)}`; continue; }
      const body = await r.json() as { candles?: { time: string; complete: boolean; mid?: { o: string; h: string; l: string; c: string } }[] };
      const rows = (body.candles ?? []).filter((c) => c.mid).map((c) => ({
        market: m.id, secs, time: c.time, complete: c.complete,
        o: Number(c.mid!.o), h: Number(c.mid!.h), l: Number(c.mid!.l), c: Number(c.mid!.c),
      }));
      let merged = 0;
      for (let i = 0; i < rows.length; i += 1000) {
        const put = await fetch(`${base}/rpc/backfill_bars`, { method: "POST", headers, body: JSON.stringify({ p_rows: rows.slice(i, i + 1000) }) });
        if (!put.ok) { report[`${m.id}:${g}`] = `backfill ${put.status}: ${(await put.text()).slice(0, 120)}`; break; }
        merged += ((await put.json()) as { merged: number }).merged;
      }
      report[`${m.id}:${g}`] ??= { candles: rows.length, merged, from: rows[0]?.time ?? null };
    }
  }
  return json(report);
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
