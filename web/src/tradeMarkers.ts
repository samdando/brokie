import type { ToXY } from "./Chart";
import type { Bubble } from "./types";

export interface MarkerGroup {
  key: string;
  trades: Bubble[];
  exit: boolean;
  x: number;
  y: number;
  anchorX: number;
  anchorY: number;
  mixed?: boolean;
}

/** Cluster only the same player's nearby fills. Every fill remains in the group;
 * another player's activity can never replace it. Displaced faces get a stem
 * back to the actual fill, while trade connectors always use exact coordinates. */
export function tradeMarkers(bubbles: Bubble[], toXY: ToXY, width: number, height: number, hideMine: boolean, showHistory: boolean): MarkerGroup[] {
  const groups = new Map<string, MarkerGroup>();
  const add = (b: Bubble, exit: boolean) => {
    const at = toXY(Date.parse(exit ? b.at : b.opened_at) / 1000, exit ? b.exit_price! : b.entry_price);
    if (!at) return;
    const key = `${b.handle}|${b.side}|${b.state}|${exit ? "exit" : "entry"}|${Math.floor(at.x / 40)}|${Math.floor(at.y / 40)}`;
    const group = groups.get(key);
    if (group) group.trades.push(b);
    else groups.set(key, { key, trades: [b], exit, x: at.x, y: at.y, anchorX: at.x, anchorY: at.y });
  };
  for (const b of [...bubbles].sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || a.id.localeCompare(b.id))) {
    if (b.state === "open") { if (!(hideMine && b.is_you)) add(b, false); }
    else if (showHistory && b.exit_price !== null) { add(b, false); add(b, true); }
  }
  // Give every player a face before allocating additional spots to busy players.
  // Start with quiet players, so spam cannot consume the chart's entire capacity.
  const placed: MarkerGroup[] = [];
  const cells = new Map<string, MarkerGroup[]>();
  const cell = (x: number, y: number) => `${Math.floor(x / 36)},${Math.floor(y / 36)}`;
  const free = (x: number, y: number) => {
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      const near = cells.get(cell(x + dx * 36, y + dy * 36)) ?? [];
      if (near.some(p => Math.hypot(p.x - x, p.y - y) < 36)) return false;
    }
    return true;
  };
  const byPlayer = new Map<string, MarkerGroup[]>();
  for (const group of groups.values()) {
    const handle = group.trades[0].handle;
    byPlayer.set(handle, [...(byPlayer.get(handle) ?? []), group]);
  }
  const activity = new Map<string, number>();
  for (const b of bubbles) activity.set(b.handle, (activity.get(b.handle) ?? 0) + 1);
  const players = [...byPlayer.keys()].sort((a, b) => activity.get(a)! - activity.get(b)! || a.localeCompare(b));
  byPlayer.forEach(groups => groups.sort((a, b) => a.trades.length - b.trades.length || a.key.localeCompare(b.key)));
  const ordered: MarkerGroup[] = [];
  for (let round = 0; round < Math.max(0, ...[...byPlayer.values()].map(groups => groups.length)); round++) {
    for (const player of players) { const group = byPlayer.get(player)![round]; if (group) ordered.push(group); }
  }
  for (const group of ordered) {
    const clampX = (x: number) => Math.max(18, Math.min(width - 18, x));
    const clampY = (y: number) => Math.max(18, Math.min(height - 18, y));
    group.x = clampX(group.x); group.y = clampY(group.y);
    let available = free(group.x, group.y);
    if (!available) {
      search: for (let radius = 36; radius < Math.max(width, height); radius += 36) {
        const steps = Math.ceil(2 * Math.PI * radius / 32);
        for (let step = 0; step < steps; step++) {
          const angle = step / steps * Math.PI * 2;
          const x = clampX(group.anchorX + Math.cos(angle) * radius), y = clampY(group.anchorY + Math.sin(angle) * radius);
          if (free(x, y)) { group.x = x; group.y = y; available = true; break search; }
        }
      }
    }
    if (!available) {
      // A packed chart grows a player's existing count instead of placing an
      // overlapping face on someone else. Its list still includes every fill.
      const owner = placed.filter(p => p.trades[0].handle === group.trades[0].handle);
      const sameKind = owner.filter(p => p.exit === group.exit && p.trades[0].side === group.trades[0].side && p.trades[0].state === group.trades[0].state);
      const target = (sameKind.length ? sameKind : owner).sort((a, b) => Math.hypot(a.x - group.anchorX, a.y - group.anchorY) - Math.hypot(b.x - group.anchorX, b.y - group.anchorY))[0];
      if (target) {
        target.mixed ||= target.exit !== group.exit || target.trades[0].side !== group.trades[0].side || target.trades[0].state !== group.trades[0].state;
        const ids = new Set(target.trades.map(b => b.id));
        target.trades.push(...group.trades.filter(b => !ids.has(b.id)));
        continue;
      }
    }
    placed.push(group);
    const key = cell(group.x, group.y);
    cells.set(key, [...(cells.get(key) ?? []), group]);
  }
  return placed;
}
