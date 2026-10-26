// Public market data only. All orders and payouts stay in Brokie's separate token ledger.
// https://docs.kalshi.com/api-reference/market/get-markets
const FEED = "https://api.elections.kalshi.com/trade-api/v2";
export function parseMarket(m: Record<string, unknown>, at = new Date().toISOString()) {
  if (typeof m.ticker !== "string" || typeof m.title !== "string" || m.market_type !== "binary" || Number(m.notional_value_dollars) !== 1 || m.mve_collection_ticker) return null;
  const prices = [m.yes_bid_dollars,m.yes_ask_dollars,m.no_bid_dollars,m.no_ask_dollars].map(v => v == null || v === "" ? NaN : Number(v));
  if (prices.some(p => !Number.isFinite(p) || p < 0 || p > 1) || !Number.isFinite(Date.parse(String(m.close_time)))) return null;
  const [yes_bid,yes_ask,no_bid,no_ask] = prices;
  if (m.status === "active" && (yes_bid > yes_ask || no_bid > no_ask)) return null;
  // A tentative result is not a settlement. Respect final scalar/void payouts as well as Yes/No.
  let payout: number | null = null;
  if (m.status === "finalized" || m.status === "settled") {
    const value = m.settlement_value_dollars == null || m.settlement_value_dollars === "" ? NaN : Number(m.settlement_value_dollars);
    if (Number.isFinite(value) && value >= 0 && value <= 1) payout = value;
    else if (m.result === "yes") payout = 1;
    else if (m.result === "no") payout = 0;
  }
  const rules = [m.rules_primary,m.rules_secondary].filter(v => typeof v === "string" && v).join("\n\n");
  const subtitle = typeof m.yes_sub_title === "string" ? m.yes_sub_title.trim() : "";
  const title = subtitle && !m.title.includes(subtitle) ? `${m.title} · ${subtitle}` : m.title;
  return { id:m.ticker,title,rules,close_at:m.close_time,status:rules ? m.status : "paused",yes_bid,yes_ask,no_bid,no_ask,payout_yes:payout,quoted_at:at,volume:Number(m.volume_24h_fp)||0 };
}
Deno.serve(async (req: Request) => {
  const key = Deno.env.get("BROKIE_SERVICE_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"), base = Deno.env.get("SUPABASE_URL");
  if (!key || !base) return Response.json({ error:"Missing server configuration" },{status:500});
  const headers:Record<string,string>={apikey:key,"Content-Type":"application/json"};
  if (key.startsWith("eyJ")) headers.Authorization=`Bearer ${key}`;
  const rpc=(name:string,body:unknown)=>fetch(`${base}/rest/v1/rpc/${name}`,{method:"POST",headers,body:JSON.stringify(body),signal:AbortSignal.timeout(8000)});
  const check=await rpc("check_cron_secret",{p_secret:req.headers.get("x-cron-secret")??""});
  if(!check.ok || await check.json()!==true)return new Response("Forbidden",{status:403});
  const get=async(path:string)=>{const r=await fetch(`${FEED}${path}`,{headers:{Accept:"application/json"},signal:AbortSignal.timeout(6000)});if(!r.ok)throw new Error(`Feed ${r.status}`);return r.json();};
  const watchResponse=await rpc("prediction_watchlist",{});
  if(!watchResponse.ok)return Response.json({error:"Watchlist unavailable"},{status:502});
  const watch:string[]=await watchResponse.json();
  // Finance-only discovery; held legacy markets are still fetched below for exits/settlement.
  // Series verified with the provider's public catalogue on 27 Oct 2026.
  const categories = [/^KXINX/i, /^KXNASDAQ/i, /^KXDJIA/i, /^KXGOLD/i, /^KX(?:BTC|ETH)/i, /^KXTNOTE/i];
  const series = ["KXINXU", "KXNASDAQ100U", "KXDJIA", "KXGOLD", "KXGOLDPRICE", "KXTNOTE", "KXBTC15M", "KXETH15M"];
  const requests=[...series.map(ticker=>get(`/markets?status=open&limit=1000&series_ticker=${encodeURIComponent(ticker)}`)),
    ...Array.from({length:Math.ceil(watch.length/50)},(_,i)=>get(`/markets?limit=100&tickers=${encodeURIComponent(watch.slice(i*50,i*50+50).join(','))}`))];
  const results=await Promise.allSettled(requests);
  const all=results.flatMap(r=>r.status==='fulfilled' && Array.isArray(r.value.markets)?r.value.markets:[]);
  const parsed=all.map(m=>parseMarket(m)).filter((m):m is NonNullable<ReturnType<typeof parseMarket>>=>m!==null);
  const tracked=parsed.filter(m=>watch.includes(m.id));
  const eligible=parsed.filter(m=>series.some(s=>m.id.startsWith(s+'-')) && m.status==='active' && m.volume>0 && m.yes_ask-m.yes_bid<=0.2 && m.no_ask-m.no_bid<=0.2 && m.yes_ask>0 && m.yes_ask<1 && m.no_ask>0 && m.no_ask<1 && Date.parse(String(m.close_at))>Date.now()).sort((a,b)=>b.volume-a.volume);
  // Reserve room per financial underlying so crypto cannot crowd out index contracts.
  const preferred=categories.flatMap(pattern=>eligible.filter(m=>pattern.test(`${m.id} ${m.title}`)).slice(0,4));
  const candidates=[...new Map([...preferred,...eligible].map(m=>[m.id,m])).values()].slice(0,24);
  const rows=[...new Map([...candidates,...tracked].map(m=>[m.id,m])).values()];
  if(!rows.length)return Response.json({error:"No fresh prediction markets"},{status:502});
  const out=await rpc("ingest_predictions",{p_rows:rows});
  return new Response(await out.text(),{status:out.status,headers:{"Content-Type":"application/json"}});
});
