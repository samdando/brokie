// pump.fun-style live trade bubbles: every squad mate's open trade sits on
// the chart at its fill, with live P&L. Exits pop (green), deflate (red) or
// crack and sink (REKT).
import { CSSProperties, Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { ToXY } from "./Chart";
import type { Bubble, Market, Side } from "./types";
import { MARKETS, direction } from "./types";

interface Placed { b: Bubble; x: number; y: number; r: number; edge: boolean; pnl: number; pct: number; danger: boolean; markY: number | null; hedged: boolean }

const FLIP_MS = 1100;

/** Ids that showed up after the first render, kept "fresh" for one flip-in animation. */
export function useFreshIds(ids: string[]): Set<string> {
  const seen = useRef<Set<string> | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const key = ids.join("|");
  useEffect(() => {
    if (seen.current === null) { seen.current = new Set(ids); return; }
    const added = ids.filter((id) => !seen.current!.has(id));
    if (!added.length) return;
    added.forEach((id) => seen.current!.add(id));
    setFresh((f) => new Set([...f, ...added]));
    const t = setTimeout(() => setFresh((f) => { const n = new Set(f); added.forEach((id) => n.delete(id)); return n; }), FLIP_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return fresh;
}

/** The shared trade bubble: gradient ring, glow, avatar initial, ▲/▼ and size badge. When `fresh`
 *  it plays the entry: 3D coin flip with overshoot, a ring shockwave and a short glow trail.
 *  Transform/opacity only, so it stays on the compositor at 60fps. */
export function CoinBubble({ side, initial, size, qty, me, fresh, hedged, danger, tag, tagUp, style, testId, label }:
  { side: Side; initial: string; size: number; qty: number; me?: boolean; fresh?: boolean; hedged?: boolean; danger?: boolean;
    tag?: string; tagUp?: boolean; style?: CSSProperties; testId?: string; label?: string }) {
  const long = side === "long";
  return (
    <span className={`coin ${long ? "long" : "short"} ${me ? "me" : ""} ${fresh ? "fresh" : ""} ${danger ? "danger" : ""}`}
      style={{ width: size, height: size, fontSize: size * 0.4, ...style }} data-testid={testId} aria-label={label} role={label ? "img" : undefined}>
      {fresh && <><i className="coin-trail" aria-hidden="true" /><i className="coin-wave" aria-hidden="true" /></>}
      <span className="coin-face" aria-hidden="true">
        <span className="coin-av">{initial.toUpperCase()}</span>
        <span className="coin-dir">{long ? "▲" : "▼"}</span>
        <span className="coin-qty">{qty}</span>
      </span>
      {tag && <span className={`bub-tag ${tagUp ? "lime" : "red"}`} aria-hidden="true">{tag}</span>}
      {hedged && <span className="coin-hedge" aria-hidden="true">H</span>}
    </span>
  );
}
interface Exit { b: Bubble; kind: "win" | "loss" | "rekt"; born: number }

const pctOf = (b: Bubble, mark: number, mkt: Market) => {
  const pnl = (mark - b.entry_price) * MARKETS[mkt].pointValue * b.quantity * direction(b.side);
  return { pnl, pct: b.equity ? (pnl / b.equity) * 100 : 0 };
};

export function BubbleLayer({ bubbles, market, quote, toXY, width, onSelect, onEnter, hideMine }:
  { hideMine?: boolean; bubbles: Bubble[]; market: Market; quote: number | null; toXY: ToXY; width: number; onSelect: (b: Bubble) => void; onEnter: (b: Bubble) => void }) {
  const seenOpen = useRef<Set<string> | null>(null);
  const fresh = useFreshIds(bubbles.filter((b) => b.state === "open").map((b) => b.id));
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
      // Your own open trade is drawn by the chart itself (pinned at entry, ticket C1).
      if (hideMine && b.is_you) continue;
      // Opened before the visible window? Keep it on the left edge at its price instead of dropping it.
      const at = toXY(Date.parse(b.opened_at) / 1000, b.entry_price) ?? toXY(Date.now() / 1000, b.entry_price);
      if (!at) continue;
      const { pnl, pct } = quote ? pctOf(b, quote, market) : { pnl: 0, pct: 0 };
      const sizePct = Number.isFinite(b.size_pct) ? Math.max(0, b.size_pct ?? 0) : 0;
      const r = Math.max(11, Math.min(17, 11 + sizePct * 0.3));
      const room = b.equity && b.dd_floor ? (b.equity - b.dd_floor) / Math.max(1, b.equity * 0.1) : 1;
      const mark = quote === null ? null : toXY(Date.parse(b.opened_at) / 1000, quote);
      // Trades opened before the visible window hug the edge instead of clipping off-screen.
      const min = r + 6, max = Math.max(min, width - r - 6);
      const x = Math.min(max, Math.max(min, at.x));
      out.push({ b, x, y: at.y, r, edge: x !== at.x, pnl, pct, danger: room < 0.2, markY: mark?.y ?? null, hedged: false });
    }
    // A player holding a long and a short at once is hedged: show both bubbles, flagged.
    const sides = new Map<string, Set<string>>();
    for (const b of bubbles) if (b.state === "open") sides.set(b.handle, (sides.get(b.handle) ?? new Set()).add(b.side));
    for (const p of out) p.hedged = (sides.get(p.b.handle)?.size ?? 0) > 1;
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

  // Closed trades stay on the chart: entry → exit line with the result at the exit.
  const marks = useMemo(() => {
    const out: { b: Bubble; x1: number; y1: number; x2: number; y2: number }[] = [];
    for (const b of bubbles) {
      if (b.state !== "closed" || b.exit_price === null) continue;
      const a = toXY(Date.parse(b.opened_at) / 1000, b.entry_price);
      const z = toXY(Date.parse(b.at) / 1000, b.exit_price);
      if (!z) continue;
      out.push({ b, x1: a?.x ?? z.x, y1: a?.y ?? z.y, x2: z.x, y2: z.y });
    }
    return out.slice(-12);
  }, [bubbles, toXY, width]);

  const openAll = bubbles.filter((b) => b.state === "open");
  const longs = openAll.filter((b) => b.side === "long").length, shorts = openAll.length - longs;

  return (
    <>
      <svg width={width} height="100%" aria-hidden="true" style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
        {marks.map((m) => <line key={`l-${m.b.id}`} x1={m.x1} y1={m.y1} x2={m.x2} y2={m.y2}
          stroke={(m.b.pnl ?? 0) >= 0 ? "var(--lime)" : "var(--red)"} strokeWidth="1.5" strokeDasharray="3 3" opacity="0.55" />)}
        {marks.map((m) => <circle key={`c-${m.b.id}`} cx={m.x1} cy={m.y1} r="2.5" fill="var(--muted)" />)}
        {placed.map((p) => p.markY !== null && <line key={p.b.id} x1={p.x} y1={p.y} x2={p.x} y2={p.markY}
          stroke={p.b.side === "long" ? "var(--lime)" : "var(--red)"} strokeWidth="1" strokeDasharray="2 4" opacity="0.4" />)}
      </svg>
      {openAll.length > 0 && (
        <div className="sentiment" title={`${longs} long / ${shorts} short`} data-testid="sentiment" aria-label={`${longs} long, ${shorts} short`}>
          <span className="lime">{longs}▲</span><span className="red">{shorts}▼</span>
        </div>
      )}
      {groups.map((g) => {
        const key = g.map((p) => p.b.id).join("|");
        if (g.length > 1 && expanded !== key && !g.some((p) => fresh.has(p.b.id))) {
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
              <BubbleDot p={{ ...p, x: fanX }} fresh={fresh.has(p.b.id)} onClick={() => onSelect(p.b)} />
            </Fragment>;
          })}
          {g.length > 1 && expanded === key && <button type="button" className="cluster cluster-collapse" style={{ left: centerX, top: centerY + 47 }}
            onClick={() => setExpanded(null)} aria-label="Collapse trade cluster" aria-expanded={true}>Collapse</button>}
        </Fragment>;
      })}
      {marks.map((m) => {
        const pnl = m.b.pnl ?? 0;
        const label = m.b.reason === "blown" ? "💀" : `${pnl >= 0 ? "+" : "−"}$${Math.abs(pnl).toFixed(0)}`;
        const right = m.x2 > width - 60;
        return <span key={`x-${m.b.id}`} className={`exit-mark ${pnl >= 0 ? "win" : "loss"} ${m.b.is_you ? "me" : ""} ${right ? "left" : ""}`}
          style={{ left: m.x2, top: m.y2 }} data-testid="exit-mark" title={`@${m.b.handle} closed ${m.b.side} ×${m.b.quantity}`}>
          <i aria-hidden="true">✕</i><span>{m.b.is_you ? "" : `@${m.b.handle} `}{label}</span>
        </span>;
      })}
      {exits.map((e) => {
        const at = toXY(Date.parse(e.b.at) / 1000, e.b.exit_price ?? e.b.entry_price);
        return at && <ExitFx key={e.b.id} e={{ ...e, x: at.x, y: at.y }} />;
      })}
    </>
  );
}

function BubbleDot({ p, fresh, onClick }: { p: Placed; fresh: boolean; onClick: () => void }) {
  const tag = `${p.pct >= 0 ? "+" : "−"}${Math.abs(p.pct).toFixed(2)}%`;
  const hitSize = Math.max(44, p.r * 2);
  return (
    <button type="button" className="bub-hit"
      style={{ left: p.x, top: p.y, width: hitSize, height: hitSize }} onClick={onClick}
      data-testid="bubble" aria-label={`${p.b.handle} ${p.b.side} ${p.b.quantity} micros at ${p.b.entry_price}, ${tag}${p.hedged ? ", hedged" : ""}`}>
      <CoinBubble side={p.b.side} initial={p.b.handle[0] ?? "?"} size={p.r * 2} qty={p.b.quantity} me={p.b.is_you}
        fresh={fresh} hedged={p.hedged} danger={p.danger} tag={tag} tagUp={p.pct >= 0} style={{ left: "50%", top: "50%" }} />
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
