// Brokie · pool-watch: credits $1 pool entries paid in USDC on Base.
//
// Every minute (pg_cron, see backend/pool_cron.sql) it reads the USDC Transfer
// events into the Brokie treasury since the last block it saw, and for each
// one from a wallet a player registered in the app it calls pool_mark_paid,
// which restarts that player's season account on hard mode.
//
// Paste this whole file into Supabase → Edge Functions → pool-watch → Code, then Deploy
// with "Verify JWT" turned OFF: the database's own cron secret protects it.
//
// Optional secrets: BASE_RPC_URL (defaults to the public https://mainnet.base.org).
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided automatically.
// The treasury address itself lives in the database: brokie_private.pool_usdc_treasury.

const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"; // native USDC on Base, 6 decimals
const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"; // Transfer(address,address,uint256)
const MAX_SPAN = 4000;       // blocks per run (Base makes one every 2 s, so ~2 h); public RPCs cap getLogs ranges
const CONFIRMATIONS = 6;     // ~12 s behind the tip, so a reorg can't un-pay an entry
const FIRST_LOOKBACK = 1800; // on the very first run, look back about an hour

Deno.serve(async (req) => {
  const serviceKey = Deno.env.get("BROKIE_SERVICE_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!serviceKey) return json({ error: "No service key available to the function" }, 500);
  const headers: Record<string, string> = { apikey: serviceKey, "Content-Type": "application/json" };
  if (serviceKey.startsWith("eyJ")) headers.Authorization = `Bearer ${serviceKey}`;
  const rest = `${Deno.env.get("SUPABASE_URL")}/rest/v1/rpc`;
  const rpc = async (name: string, body: unknown = {}) => {
    const res = await fetch(`${rest}/${name}`, { method: "POST", headers, body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`${name} ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  };

  // Only our own cron job knows the secret the database generated for itself.
  if ((await rpc("check_cron_secret", { p_secret: req.headers.get("x-cron-secret") ?? "" })) !== true) {
    return new Response("forbidden", { status: 403 });
  }

  try {
    const state = (await rpc("pool_watch_state")) as { treasury: string | null; last_block: number; pending: string[] };
    if (!state.treasury) return json({ note: "no treasury set (brokie_private.pool_usdc_treasury)" });
    const treasury = state.treasury.toLowerCase();
    if (!/^0x[0-9a-f]{40}$/.test(treasury)) return json({ error: "treasury is not a Base address" }, 500);

    // Public nodes rate-limit now and then, so try the next one on any failure.
    const nodes = [Deno.env.get("BASE_RPC_URL"), "https://base-rpc.publicnode.com", "https://mainnet.base.org", "https://base.drpc.org"].filter((n): n is string => !!n);
    const eth = async (method: string, params: unknown[]) => {
      let last = "no Base node answered";
      for (const node of nodes) {
        try {
          const res = await fetch(node, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
          if (!res.ok) { last = `${node}: ${res.status}`; continue; }
          const body = await res.json();
          if (body.error) { last = `${node}: ${body.error.message ?? JSON.stringify(body.error)}`; continue; }
          return body.result;
        } catch (e) { last = `${node}: ${(e as Error).message}`; }
      }
      throw new Error(`Base RPC: ${last}`);
    };

    const head = parseInt(await eth("eth_blockNumber", []), 16) - CONFIRMATIONS;
    const from = state.last_block > 0 ? state.last_block + 1 : Math.max(0, head - FIRST_LOOKBACK);
    const to = Math.min(head, from + MAX_SPAN - 1);
    if (to < from) return json({ note: "up to date", head, last_block: state.last_block });

    const logs = (await eth("eth_getLogs", [{
      address: USDC, fromBlock: hex(from), toBlock: hex(to),
      topics: [TRANSFER, null, pad(treasury)],
    }])) as { topics: string[]; data: string; transactionHash: string; blockNumber: string; logIndex: string }[];

    const pending = new Set(state.pending.map((w) => w.toLowerCase()));
    const results: unknown[] = [];
    for (const log of logs) {
      const sender = "0x" + log.topics[1].slice(26).toLowerCase();
      const amount = Number(BigInt(log.data)) / 1e6;
      if (!pending.has(sender)) { results.push({ sender, amount, skipped: "no pending entry" }); continue; }
      // One tx can carry several transfers (rare for a wallet send); key on tx + log index.
      const reference = `${log.transactionHash}#${parseInt(log.logIndex, 16)}`;
      const r = await rpc("pool_mark_paid", { p_wallet: sender, p_reference: reference, p_amount: amount });
      results.push({ sender, amount, reference, ...r });
    }
    await rpc("pool_set_cursor", { p_block: to });
    return json({ from, to, head, transfers: logs.length, results });
  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 502);
  }
});

const hex = (n: number) => "0x" + n.toString(16);
const pad = (addr: string) => "0x" + addr.slice(2).padStart(64, "0");
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
