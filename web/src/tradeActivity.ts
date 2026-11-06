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
