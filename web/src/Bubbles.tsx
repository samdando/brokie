// pump.fun-style live trade bubbles: every squad mate's open trade sits on
// the chart at its fill, with live P&L. Exits pop (green), deflate (red) or
// crack and sink (REKT).
import { useEffect, useMemo, useRef, useState } from "react";
import type { ToXY } from "./Chart";
import type { Bubble, Market } from "./types";
import { MARKETS, direction } from "./types";

interface Placed { b: Bubble; x: number; y: number; r: number; pnl: number; pct: number; danger: boolean }
interface Exit { b: Bubble; kind: "win" | "loss" | "rekt"; x: number; y: number; born: number }

const pctOf = (b: Bubble, mark: number, mkt: Market) => {
  const pnl = (mark - b.entry_price) * MARKETS[mkt].pointValue * b.quantity * direction(b.side);
  return { pnl, pct: b.equity ? (pnl / b.equity) * 100 : 0 };
};

export function BubbleLayer({ bubbles, market, quote, toXY, width, onSelect, onEnter }:
  { bubbles: Bubble[]; market: Market; quote: number | null; toXY: ToXY; width: number; onSelect: (b: Bubble) => void; onEnter: (b: Bubble) => void }) {
  const seenOpen = useRef<Set<string> | null>(null);
  const seenExit = useRef<Set<string>>(new Set());
  const [exits, setExits] = useState<Exit[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);

  // Detect new entries (toast) and new exits (animation), once each.
  useEffect(() => {
    const opens = bubbles.filter((b) => b.state === "open");
    if (seenOpen.current === null) {
      seenOpen.current = new Set(opens.map((b) => b.id));
      bubbles.filter((b) => b.state === "closed").forEach((b) => seenExit.current.add(b.id));
      return;
    }
    for (const b of opens) if (!seenOpen.current.has(b.id)) { seenOpen.current.add(b.id); if (!b.is_you) onEnter(b); }
    const fresh: Exit[] = [];
    for (const b of bubbles.filter((x) => x.state === "closed")) {
      if (seenExit.current.has(b.id)) continue;
      seenExit.current.add(b.id);
      const at = toXY(Date.parse(b.at) / 1000, b.exit_price ?? b.entry_price);
      if (!at) continue;
      const kind = b.reason === "blown" ? "rekt" : (b.pnl ?? 0) >= 0 ? "win" : "loss";
      fresh.push({ b, kind, x: at.x, y: at.y, born: Date.now() });
    }
    if (fresh.length) {
      setExits((e) => [...e, ...fresh]);
      setTimeout(() => setExits((e) => e.filter((x) => Date.now() - x.born < 1900)), 2000);
    }
  }, [bubbles]); // eslint-disable-line

  // Reset when switching markets.
  useEffect(() => { seenOpen.current = null; setExits([]); setExpanded(null); }, [market]);

  const placed: Placed[] = useMemo(() => {
    const out: Placed[] = [];
    for (const b of bubbles) {
      if (b.state !== "open") continue;
      const at = toXY(Date.parse(b.opened_at) / 1000, b.entry_price);
      if (!at) continue;
      const { pnl, pct } = quote ? pctOf(b, quote, market) : { pnl: 0, pct: 0 };
      const r = Math.max(13, Math.min(24, 12 + (b.size_pct ?? 1) * 1.4));
      const room = b.equity && b.dd_floor ? (b.equity - b.dd_floor) / Math.max(1, b.equity * 0.1) : 1;
      out.push({ b, x: Math.min(Math.max(at.x, r + 2), width - 64), y: at.y, r, pnl, pct, danger: room < 0.2 });
    }
    return out;
  }, [bubbles, toXY, quote, market, width]);

  // Cluster bubbles that would overlap into a "3 ▲ / 1 ▼" pill.
  const groups = useMemo(() => {
    const gs: Placed[][] = [];
    for (const p of [...placed].sort((a, b) => a.x - b.x)) {
      const g = gs.find((g) => g.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < q.r + p.r + 2));
      if (g) g.push(p); else gs.push([p]);
    }
    return gs;
  }, [placed]);

  const longs = placed.filter((p) => p.b.side === "long").length, shorts = placed.length - longs;

  return (
    <>
      {placed.length > 0 && (
        <div className="sentiment" title={`${longs} long / ${shorts} short`}>
          <div style={{ height: `${(longs / placed.length) * 100}%`, background: "var(--lime)" }} />
          <div style={{ flex: 1, background: "var(--red)" }} />
        </div>
      )}
      {groups.map((g) => {
        const key = g.map((p) => p.b.id).join("|");
        if (g.length > 1 && expanded !== key) {
          const cx = g.reduce((s, p) => s + p.x, 0) / g.length, cy = g.reduce((s, p) => s + p.y, 0) / g.length;
          const up = g.filter((p) => p.b.side === "long").length;
          return (
            <button key={key} className="cluster" style={{ left: cx, top: cy }} onClick={() => setExpanded(key)} data-testid="bubble-cluster">
              <span className="lime">{up} ▲</span> / <span className="red">{g.length - up} ▼</span>
            </button>
          );
        }
        return g.map((p, i) => {
          const fan = g.length > 1 ? (i - (g.length - 1) / 2) * (p.r * 2 + 6) : 0;
          return <BubbleDot key={p.b.id} p={{ ...p, x: p.x + fan }} onClick={() => onSelect(p.b)} />;
        });
      })}
      {exits.map((e) => <ExitFx key={e.b.id} e={e} />)}
    </>
  );
}

function BubbleDot({ p, onClick }: { p: Placed; onClick: () => void }) {
  const long = p.b.side === "long";
  const tag = `${p.pct >= 0 ? "+" : "−"}${Math.abs(p.pct).toFixed(2)}%`;
  return (
    <button className={`bub ${long ? "long" : "short"} ${p.b.is_you ? "me" : "friend"} ${p.danger ? "danger" : ""}`}
      style={{ left: p.x, top: p.y, width: p.r * 2, height: p.r * 2, fontSize: p.r * 0.8 }} onClick={onClick}
      data-testid="bubble" aria-label={`${p.b.handle} ${p.b.side} ${p.b.quantity}, ${tag}`}>
      <span className="bub-av">{p.b.handle[0].toUpperCase()}</span>
      <span className="bub-dir">{long ? "▲" : "▼"}</span>
      <span className={`bub-tag ${p.pct >= 0 ? "lime" : "red"}`}>{tag}</span>
    </button>
  );
}

function ExitFx({ e }: { e: Exit }) {
  const pnl = e.b.pnl ?? 0;
  const txt = e.kind === "rekt" ? "💀 REKT" : `${pnl >= 0 ? "+" : "−"}$${Math.abs(pnl).toFixed(0)}${pnl >= 0 ? " 🚀" : ""}`;
  return (
    <div className={`exit ${e.kind}`} style={{ left: e.x, top: e.y }} data-testid={`exit-${e.kind}`}>
      {e.kind === "win" && Array.from({ length: 12 }, (_, i) => (
        <i key={i} style={{ ["--a" as string]: `${i * 30}deg`, ["--d" as string]: `${26 + (i % 3) * 10}px` }} />
      ))}
      <span className="exit-av">{e.kind === "rekt" ? "💀" : e.b.handle[0].toUpperCase()}</span>
      <b className="exit-txt">{txt}</b>
    </div>
  );
}
