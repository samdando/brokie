// Brokie · ingest-quotes
// Pulls Gold, NAS100, US500 and US30 from an OANDA practice account and hands them
// to the database, which rounds to the tick, stores the candle history and
// liquidates blown accounts.
//
// Two ways to call it (pg_cron does, see cron.sql / cron_fast.sql):
//   body {}                      one price pull, then reply (the old 10-second schedule)
//   body {"loop_seconds": 55}    reply straight away, then keep pulling every
//                                "every_ms" (default 2000) for that long in the
//                                background. Run once a minute, that gives ~2 s prices
//                                for ~43k function calls a month (free plan: 500k).
//
// Secrets (Supabase → Edge Functions → Secrets):
//   OANDA_TOKEN        your OANDA practice API token
//   OANDA_ACCOUNT_ID   your practice account id, e.g. 101-011-12345678-001
//   OANDA_HOST         optional, defaults to the practice host
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided automatically.
//
// Deploy with "Verify JWT" turned OFF: a secret the database generated for
// itself (brokie_private.cron_secret) protects it instead.

import { toQuotes } from "../_shared/oanda.ts";

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

Deno.serve(async (req) => {
  // Works with the legacy service_role JWT or a newer sb_secret_ key.
  const serviceKey = Deno.env.get("BROKIE_SERVICE_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!serviceKey) return json({ error: "No service key available to the function" }, 500);
  const headers: Record<string, string> = { apikey: serviceKey, "Content-Type": "application/json" };
  if (serviceKey.startsWith("eyJ")) headers.Authorization = `Bearer ${serviceKey}`;
  const rest = `${Deno.env.get("SUPABASE_URL")}/rest/v1/rpc`;

  // Only our own cron job knows the secret the database generated for itself.
  const check = await fetch(`${rest}/check_cron_secret`, {
    method: "POST", headers, body: JSON.stringify({ p_secret: req.headers.get("x-cron-secret") ?? "" }),
  });
  if (!check.ok || (await check.json()) !== true) return new Response("forbidden", { status: 403 });

  const token = Deno.env.get("OANDA_TOKEN");
  const account = Deno.env.get("OANDA_ACCOUNT_ID");
  if (!token || !account) return json({ error: "OANDA_TOKEN / OANDA_ACCOUNT_ID not set" }, 500);
  const host = Deno.env.get("OANDA_HOST") ?? "https://api-fxpractice.oanda.com";

  const pull = async (): Promise<Response> => {
    const feed = await fetch(
      `${host}/v3/accounts/${encodeURIComponent(account)}/pricing?instruments=XAU_USD,NAS100_USD,SPX500_USD,US30_USD`,
      { headers: { Authorization: `Bearer ${token}`, "Accept-Datetime-Format": "RFC3339" } },
    );
    if (!feed.ok) return json({ error: `OANDA ${feed.status}`, detail: (await feed.text()).slice(0, 300) }, 502);
    const quotes = toQuotes(await feed.json());
    // Nothing tradeable (weekend / maintenance): leave prices stale so the
    // server pauses new trades instead of filling on old prices.
    if (quotes.length === 0) return json({ accepted: 0, note: "market closed" });
    const rpc = await fetch(`${rest}/ingest_quotes`, { method: "POST", headers, body: JSON.stringify({ p_quotes: quotes }) });
    return new Response(await rpc.text(), { status: rpc.status, headers: { "Content-Type": "application/json" } });
  };

  let opts: { loop_seconds?: unknown; every_ms?: unknown } = {};
  try { opts = await req.json(); } catch { /* empty body = single pull */ }
  const loopSeconds = Math.min(58, Math.max(0, Number(opts.loop_seconds) || 0));
  if (!loopSeconds || typeof EdgeRuntime === "undefined") return pull();

  const every = Math.min(10_000, Math.max(1000, Number(opts.every_ms) || 2000));
  const until = Date.now() + loopSeconds * 1000;
  EdgeRuntime.waitUntil((async () => {
    while (Date.now() < until) {
      const started = Date.now();
      try {
        const r = await pull();
        await r.body?.cancel();
        if (r.status === 502) break;   // OANDA refused: stop hammering it until the next minute
      } catch { /* network blip: try again next beat */ }
      const wait = every - (Date.now() - started);
      if (Date.now() + Math.max(0, wait) >= until) break;
      if (wait > 0) await new Promise((res) => setTimeout(res, wait));
    }
  })());
  return json({ looping: loopSeconds, every_ms: every }, 202);
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
