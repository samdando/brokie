import type { Bubble, Market, MyState } from "./types";

/** Account fills stay visible even when the social request is unavailable. */
export function accountBubbles(me: MyState, market: Market, social: Bubble[], crowd = true): Bubble[] {
  const fills = new Map<string, Bubble>();
  for (const b of social) {
    if ((!crowd && !b.is_you) || (b.is_you && b.state === "open")) continue;
    fills.set(`${b.state}:${b.id}`, b);
  }
  for (const t of me.trades.filter(t => t.market === market)) {
    const key = `closed:${t.id}`, prior = fills.get(key);
    fills.set(key, { ...t, state: "closed", handle: me.handle, is_you: true,
      opened_at: t.opened_at ?? prior?.opened_at ?? "", at: t.closed_at,
      size_pct: null, dd_floor: null, equity: null });
  }
  for (const p of me.positions.filter(p => p.market === market)) {
    fills.set(`open:${p.id}`, { ...p, state: "open", handle: me.handle, is_you: true,
      exit_price: null, pnl: null, reason: null, at: p.opened_at,
      size_pct: null, dd_floor: null, equity: null });
  }
  return [...fills.values()].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}

export interface FillGroup { key: string; market: Market; fills: Bubble[]; quantity: number }
/** Same entry/exit event can have several real legs. Present it once, while
 * keeping every receipt accessible and preserving its actual fill prices. */
export function groupFills(bubbles: Bubble[], market: Market): FillGroup[] {
  const groups = new Map<string, FillGroup>();
  for (const b of bubbles) {
    const key = JSON.stringify([market,b.handle,b.side,b.state,b.prediction_id,b.prediction_outcome,b.prediction_question,b.entry_price,b.exit_price,Number.isFinite(Date.parse(b.opened_at)) ? Math.floor(Date.parse(b.opened_at)/60000) : b.id,Math.floor(Date.parse(b.at)/(b.state === "closed" ? 1000 : 60000)),b.reason]);
    const group = groups.get(key);
    if (group) { group.fills.push(b); group.quantity += b.quantity; }
    else groups.set(key, { key, market, fills: [b], quantity: b.quantity });
  }
  return [...groups.values()];
}
