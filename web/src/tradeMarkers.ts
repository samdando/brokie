import type { ToXY } from "./Chart";
import type { Bubble } from "./types";

export interface MarkerGroup {
  key: string;
  trades: Bubble[];
  entries: Bubble[];
  exit: boolean;
  x: number;
  y: number;
  mixed?: boolean;
}

/** Nearby activity shares one target, anchored to a real fill. Open positions
 * take priority. Never scatter overlapping faces across unrelated candles;
 * every trade in a cluster remains available in its activity list. */
export function tradeMarkers(bubbles: Bubble[], toXY: ToXY, width: number, height: number, hideMine: boolean, showHistory: boolean): MarkerGroup[] {
  const groups: MarkerGroup[] = [];
  const ordered = [...bubbles].sort((a, b) =>
    Number(b.state === "open") - Number(a.state === "open") ||
    Number(b.is_you) - Number(a.is_you) ||
    Date.parse(b.at) - Date.parse(a.at) || a.id.localeCompare(b.id));
  const add = (b: Bubble, exit: boolean) => {
    const at = toXY(Date.parse(exit ? b.at : b.opened_at) / 1000, exit ? b.exit_price! : b.entry_price);
    if (!at || at.x < 0 || at.x > width || at.y < 0 || at.y > height) return;
    // Leave room for two compact faces and their direction arrows. Rectangular
    // spacing also keeps the wider activity pills' touch targets separate.
    let nearest: MarkerGroup | undefined;
    let distance = Infinity;
    for (const group of groups) {
      const dx = Math.abs(group.x - at.x), dy = Math.abs(group.y - at.y);
      const next = Math.hypot(dx, dy);
      if (dx < 68 && dy < 44 && next < distance) { nearest = group; distance = next; }
    }
    if (nearest) {
      const first = nearest.trades[0];
      nearest.mixed ||= first.handle !== b.handle || first.side !== b.side || first.state !== b.state || nearest.exit !== exit;
      if (!nearest.trades.some(t => t.id === b.id)) nearest.trades.push(b);
      if (!exit && !nearest.entries.some(t => t.id === b.id)) nearest.entries.push(b);
    } else groups.push({ key: `${b.id}:${exit ? "exit" : "entry"}`, trades: [b], entries: exit ? [] : [b], exit, x: at.x, y: at.y });
  };
  for (const b of ordered) {
    if (b.state === "open") { if (!(hideMine && b.is_you)) add(b, false); }
    else if (showHistory && b.exit_price !== null) add(b, false);
  }
  // Entry pictures always anchor to an entry. Exits can join an existing group
  // afterwards, or keep their own small cross when no entry is nearby.
  if (showHistory) for (const b of ordered) if (b.state === "closed" && b.exit_price !== null) add(b, true);
  return groups;
}
