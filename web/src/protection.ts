import { MARKETS, direction, pnlOf, type Position } from "./types";

export const protectionPnl = (p: Position, price: number) => pnlOf(p, price);
export const protectionDirection = (p: Position, kind: "sl" | "tp") => (p.side === "long") === (kind === "tp") ? "at or above" : "at or below";

/** A dollar target applies to this market/side stack, then snaps to its real tick. */
export function priceForPnl(p: Position, kind: "sl" | "tp", amount: number): number | null {
  const m = MARKETS[p.market];
  if (!Number.isFinite(amount) || amount <= 0 || p.quantity <= 0) return null;
  const price = p.entry_price + direction(p.side) * (kind === "tp" ? amount : -amount) / (p.quantity * m.pointValue);
  const rounded = Math.round(price / m.tick) * m.tick;
  return Number.isFinite(rounded) && rounded > 0 ? Number(rounded.toFixed(8)) : null;
}
