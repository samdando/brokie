import { pnlOf, type Market, type Position, type Quote } from "./types";

/** Account-wide open P&L; prediction tokens belong to their separate wallet. */
export function tradingSummary(positions: Position[], quotes: Quote[], market: Market, now: number) {
  const trades = positions.filter(p => p.market !== "prediction");
  let pnl: number | null = 0, stale = false;
  for (const p of trades) {
    const q = quotes.find(q => q.market === p.market);
    if (!q || !Number.isFinite(q.price) || q.price <= 0) { pnl = null; stale = true; continue; }
    if (pnl !== null) pnl += pnlOf(p, q.price);
    const age = now - Date.parse(q.quoted_at);
    if (!Number.isFinite(age) || age < -5000 || age >= 45000) stale = true;
  }
  const here = trades.filter(p => p.market === market);
  const long = here.filter(p => p.side === "long").reduce((sum, p) => sum + p.quantity, 0);
  const short = here.filter(p => p.side === "short").reduce((sum, p) => sum + p.quantity, 0);
  const groups = new Set(trades.map(p => `${p.market}:${p.side}`)).size;
  return { pnl, stale, groups, long, short, flat: trades.length === 0 };
}
