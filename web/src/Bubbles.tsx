// pump.fun-style live trade bubbles: every squad mate's open trade sits on
// the chart at its fill, with live P&L. Exits pop (green), deflate (red) or
// crack and sink (REKT).
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { ToXY } from "./Chart";
import type { Bubble, Market } from "./types";
import { MARKETS, direction } from "./types";

interface Placed { b: Bubble; x: number; y: number; r: number; pnl: number; pct: number; danger: boolean; markY: number | null }
interface Exit { b: Bubble; kind: "win" | "loss" | "rekt"; born: number }

const pctOf = (b: Bubble, mark: number, mkt: Market) => {
  const pnl = (mark - b.entry_price) * MARKETS[mkt].pointValue * b.quantity * direction(b.side);
  return { pnl, pct: b.equity ? (pnl / b.equity) * 100 : 0 };
};

export function BubbleLayer({ bubbles, market, quote, toXY, width, onSelect, onEnter }:
  { bubbles: Bubble[]; market: Market; quote: number | null; toXY: ToXY; width: number; onSelect: (b: Bubble) => void; onEnter: (b: Bubble) => void }) {
  const seenOpen = useRef<Set<string> | null>(null);
  const seenExit = useRef<Set<string>>(new Set());
  const seenMarket = useRef(market);
  const [exits, setExits] = useState<Exit[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);

  // Detect new entries (toast) and new exits (animation), once each.
  useEffect(() => {
    if (seenMarket.current !== market) {
      seenMarket.current = market;
      seenOpen.current = null;
      seenExit.current.clear();
    }
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
      fresh.push({ b, kind, born: Date.now() });
    }
    if (fresh.length) {
      setExits((e) => [...e, ...fresh]);
    }
  }, [bubbles, market, onEnter, toXY]);

  useEffect(() => {
    if (!exits.length) return;
    const untilExpiry = Math.max(0, Math.min(...exits.map((e) => e.born + 1900)) - Date.now());
    const timer = setTimeout(() => setExits((e) => e.filter((x) => Date.now() - x.born < 1900)), untilExpiry);
    return () => clearTimeout(timer);
  }, [exits]);

  // Reset when switching markets.
  useEffect(() => { setExits([]); setExpanded(null); }, [market]);

  const placed: Placed[] = useMemo(() => {
    const out: Placed[] = [];
    for (const b of bubbles) {
      if (b.state !== "open") continue;
      const at = toXY(Date.parse(b.opened_at) / 1000, b.entry_price);
      if (!at) continue;
      const { pnl, pct } = quote ? pctOf(b, quote, market) : { pnl: 0, pct: 0 };
      const sizePct = Number.isFinite(b.size_pct) ? Math.max(0, b.size_pct ?? 0) : 0;
      const r = Math.max(14, Math.min(24, 14 + sizePct * 0.5));
      const room = b.equity && b.dd_floor ? (b.equity - b.dd_floor) / Math.max(1, b.equity * 0.1) : 1;
      const mark = quote === null ? null : toXY(Date.parse(b.opened_at) / 1000, quote);
      out.push({ b, x: at.x, y: at.y, r, pnl, pct, danger: room < 0.2, markY: mark?.y ?? null });
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
      <svg width={width} height="100%" aria-hidden="true" style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
        {placed.map((p) => p.markY !== null && <line key={p.b.id} x1={p.x} y1={p.y} x2={p.x} y2={p.markY}
          stroke={p.b.side === "long" ? "var(--lime)" : "var(--red)"} strokeWidth="1" strokeDasharray="2 4" opacity="0.4" />)}
      </svg>
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
            <button key={key} type="button" className="cluster" style={{ left: cx, top: cy }} onClick={() => setExpanded(key)}
              aria-label={`Expand ${g.length} trades: ${up} long, ${g.length - up} short`} aria-expanded={false} data-testid="bubble-cluster">
              <span className="lime">{up} ▲</span> / <span className="red">{g.length - up} ▼</span>
            </button>
          );
        }
        const centerX = g.reduce((sum, p) => sum + p.x, 0) / g.length;
        const centerY = g.reduce((sum, p) => sum + p.y, 0) / g.length;
        const spacing = Math.min(54, Math.max(0, width - 52) / Math.max(1, g.length - 1));
        const halfSpan = (g.length - 1) * spacing / 2;
        const fanCenter = Math.min(width - 26 - halfSpan, Math.max(26 + halfSpan, centerX));
        return <Fragment key={key}>
          {g.map((p, i) => {
            // Fan out only while inspecting a cluster; thin tethers retain the
            // actual fill anchors so the displaced buttons aren't fake entries.
            const fanX = g.length > 1 ? fanCenter + (i - (g.length - 1) / 2) * spacing : p.x;
            return <Fragment key={p.b.id}>
              {fanX !== p.x && <svg width={width} height="100%" aria-hidden="true" style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
                <line x1={p.x} y1={p.y} x2={fanX} y2={p.y} stroke="var(--muted)" strokeWidth="1" strokeDasharray="2 3" />
                <circle cx={p.x} cy={p.y} r="2" fill="var(--muted)" />
              </svg>}
              <BubbleDot p={{ ...p, x: fanX }} onClick={() => onSelect(p.b)} />
            </Fragment>;
          })}
          {g.length > 1 && <button type="button" className="cluster cluster-collapse" style={{ left: centerX, top: centerY + 47 }}
            onClick={() => setExpanded(null)} aria-label="Collapse trade cluster" aria-expanded={true}>Collapse</button>}
        </Fragment>;
      })}
      {exits.map((e) => {
        const at = toXY(Date.parse(e.b.at) / 1000, e.b.exit_price ?? e.b.entry_price);
        return at && <ExitFx key={e.b.id} e={{ ...e, x: at.x, y: at.y }} />;
      })}
    </>
  );
}

function BubbleDot({ p, onClick }: { p: Placed; onClick: () => void }) {
  const long = p.b.side === "long";
  const tag = `${p.pct >= 0 ? "+" : "−"}${Math.abs(p.pct).toFixed(2)}%`;
  const hitSize = Math.max(44, p.r * 2);
  return (
    <button type="button" className="bub-hit"
      style={{ left: p.x, top: p.y, width: hitSize, height: hitSize }} onClick={onClick}
      data-testid="bubble" aria-label={`${p.b.handle} ${p.b.side} ${p.b.quantity} micros at ${p.b.entry_price}, ${tag}`}>
      <span aria-hidden="true" className={`bub ${long ? "long" : "short"} ${p.b.is_you ? "me" : "friend"} ${p.danger ? "danger" : ""}`}
        style={{ left: "50%", top: "50%", width: p.r * 2, height: p.r * 2, fontSize: p.r * 0.8 }}>
        <span className="bub-av">{p.b.handle[0]?.toUpperCase() ?? "?"}</span>
        <span className="bub-dir">{long ? "▲" : "▼"}</span>
        <span className={`bub-tag ${p.pct >= 0 ? "lime" : "red"}`}>{tag}</span>
      </span>
    </button>
  );
}

function ExitFx({ e }: { e: Exit & { x: number; y: number } }) {
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
