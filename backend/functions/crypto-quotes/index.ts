// Server-side Coinbase quotes for Brokie paper contracts. Called by our secret-protected cron.
// https://docs.cdp.coinbase.com/api-reference/exchange-api/rest-api/products/get-product-ticker
const products = { btc: "BTC-USD", eth: "ETH-USD", sol: "SOL-USD" };
export function parseTicker(market: string, payload: { price?: string; time?: string }, now = Date.now()) {
  const price = Number(payload.price), at = Date.parse(payload.time ?? "");
  if (!Object.hasOwn(products, market) || !Number.isFinite(price) || price <= 0 || price > 10_000_000 || !Number.isFinite(at) || now-at > 45_000 || at-now > 5000) return null;
  return { market, price, quoted_at: new Date(at).toISOString(), source: "coinbase" };
}
Deno.serve(async (req: Request) => {
  const key = Deno.env.get("BROKIE_SERVICE_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const base = Deno.env.get("SUPABASE_URL");
  if (!key || !base) return Response.json({ error: "Missing server configuration" }, { status: 500 });
  const headers: Record<string,string> = { apikey: key, "Content-Type": "application/json" };
  if (key.startsWith("eyJ")) headers.Authorization = `Bearer ${key}`;
  const rpc = (name: string, body: unknown) => fetch(`${base}/rest/v1/rpc/${name}`, { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(8000) });
  const auth = await rpc("check_cron_secret", { p_secret: req.headers.get("x-cron-secret") ?? "" });
  if (!auth.ok || await auth.json() !== true) return new Response("Forbidden", { status: 403 });
  // Independent requests: a failure for one product never fabricates a quote or blocks the others.
  const results = await Promise.allSettled(Object.entries(products).map(async ([market, product]) => {
    const response = await fetch(`https://api.exchange.coinbase.com/products/${product}/ticker`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error(`${market}: HTTP ${response.status}`);
    return parseTicker(market, await response.json());
  }));
  const quotes = results.flatMap(r => r.status === "fulfilled" && r.value ? [r.value] : []);
  if (!quotes.length) return Response.json({ error: "No fresh crypto quotes" }, { status: 502 });
  const result = await rpc("ingest_quotes", { p_quotes: quotes });
  return new Response(await result.text(), { status: result.status, headers: { "Content-Type": "application/json" } });
});
