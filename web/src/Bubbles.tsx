import { Avatar } from "./Avatar";
import { tradeMarkers } from "./tradeMarkers";
// pump.fun-style chart markers: every squad trade is a small avatar sitting right on the candles at
// its fill. Green = long, red = short; a closed trade's exit is a hollow ring. Tap one for a trade card. Exits still pop (green), deflate (red) or crack and sink (REKT) as they happen.
import { CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import type { ToXY } from "./Chart";
import type { Bubble, Market } from "./types";
import { MARKETS, direction } from "./types";
import { PlayerLink } from "./Profiles";
import { px, signedMoney } from "./ui";

const FLIP_MS = 900;
const MAX_FX = 2;       // exit animations playing at once

/** Ids that showed up after the first render, kept "fresh" for one pop-in animation. */
export function useFreshIds(ids: string[]): Set<string> {
  const seen = useRef<Set<string> | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const deadlines = useRef(new Map<string, number>());
  const key = ids.join("|");
  useEffect(() => {
    if (seen.current === null) { seen.current = new Set(ids); return; }
    const added = ids.filter(id => !seen.current!.has(id));
    added.forEach(id => { seen.current!.add(id); deadlines.current.set(id, Date.now() + FLIP_MS); });
    if (added.length) setFresh(new Set(deadlines.current.keys()));
  }, [key]);
  useEffect(() => {
    const timer = setInterval(() => {
      let changed = false;
      for (const [id, until] of deadlines.current) if (until <= Date.now()) { deadlines.current.delete(id); changed = true; }
      if (changed) setFresh(new Set(deadlines.current.keys()));
    }, 150);
    return () => clearInterval(timer);
  }, []);
  return fresh;
}

/** A steady colour per player, so the same mate is the same dot everywhere. */
export function avatarColor(handle: string): string {
  let h = 0;
  for (const ch of handle.toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return `hsl(${h % 360} 42% 34%)`;
}

/** The marker: a small green (long) or red (short) avatar; `exit` makes it a hollow ring. */
export function TradeMarker({ handle, long, exit, closed, count = 1, me, fresh, faded, danger, style, onClick, label, testId }:
  { handle: string; long: boolean; exit?: boolean; closed?: boolean; count?: number; me?: boolean; fresh?: boolean; faded?: boolean; danger?: boolean; style?: CSSProperties;
    onClick?: () => void; label: string; testId?: string }) {
  const cls = `tm ${long ? "long" : "short"} ${exit ? "exit" : ""} ${me ? "me" : ""} ${fresh ? "fresh" : ""} ${faded ? "faded" : ""} ${danger ? "danger" : ""}`;
  const face = <><Avatar className="tm-face" handle={handle} /><span className="tm-direction" aria-hidden="true">{exit ? "×" : long ? "▲" : "▼"}</span>{!exit && !closed && !faded && <span className="tm-live" aria-hidden="true" />}{count > 1 && <span className="tm-count" aria-hidden="true">{count}</span>}</>;
  return onClick
    ? <button type="button" className={cls} style={style} onClick={onClick} aria-label={label} data-testid={testId}>{face}</button>
    : <span className={cls} style={style} role="img" aria-label={label} data-testid={testId}>{face}</span>;
}

interface Exit { b: Bubble; kind: "win" | "loss" | "rekt"; born: number }

const pnlAt = (b: Bubble, mark: number, mkt: Market) => (mark - b.entry_price) * MARKETS[mkt].pointValue * b.quantity * direction(b.side);

export function held(ms: number): string {
  const m = Math.max(0, Math.round(ms / 60000));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h ${m % 60}m` : `${Math.floor(h / 24)}d ${h % 24}h`;
}

export function BubbleLayer({ bubbles, market, quote, toXY, width, height, onSelect, onEnter, hideMine, now, onZoomOut, showHistory = true }:
  { height: number; showHistory?: boolean; onZoomOut?: () => void; now: number; hideMine?: boolean; bubbles: Bubble[]; market: Market; quote: number | null; toXY: ToXY; width: number; onSelect: (b: Bubble) => void; onEnter: (b: Bubble) => void }) {
  const seenOpen = useRef<Set<string> | null>(null);
  const [fresh, setFresh] = useState(new Set<string>());
  const entryExpiry = useRef(new Map<string, number>());
  useEffect(() => {
    const timer = setInterval(() => {
      let changed = false;
      for (const [id, until] of entryExpiry.current) if (until <= Date.now()) { entryExpiry.current.delete(id); changed = true; }
      if (changed) setFresh(new Set(entryExpiry.current.keys()));
    }, 150);
    return () => clearInterval(timer);
  }, []);
  const seenExit = useRef<Set<string>>(new Set());
  const seenMarket = useRef(market);
  const [exits, setExits] = useState<Exit[]>([]);
  const [picked, setPicked] = useState<string | null>(null);
  const [pickedGroup, setPickedGroup] = useState<string | null>(null);

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
    for (const b of opens) if (!seenOpen.current.has(b.id)) {
      seenOpen.current.add(b.id);
      const age = now - Date.parse(b.opened_at);
      if (age < -5000 || age > 15000) continue;
      entryExpiry.current.set(b.id, Date.now() + FLIP_MS); setFresh(new Set(entryExpiry.current.keys()));
      if (!b.is_you) onEnter(b);
    }
    const fx: Exit[] = [];
    for (const b of bubbles.filter((x) => x.state === "closed")) {
      if (seenExit.current.has(b.id)) continue;
      seenExit.current.add(b.id);
      if (now - Date.parse(b.at) > 15000 || now - Date.parse(b.at) < -5000) continue;
      if (!toXY(Date.parse(b.at) / 1000, b.exit_price ?? b.entry_price)) continue;
      fx.push({ b, kind: b.reason === "blown" ? "rekt" : (b.pnl ?? 0) >= 0 ? "win" : "loss", born: Date.now() });
    }
    if (fx.length) setExits((e) => [...e, ...fx].slice(-MAX_FX));
  }, [bubbles, market, onEnter, toXY, now]);

  useEffect(() => {
    if (!exits.length) return;
    const untilExpiry = Math.max(0, Math.min(...exits.map((e) => e.born + 1900)) - Date.now());
    const timer = setTimeout(() => setExits((e) => e.filter((x) => Date.now() - x.born < 1900)), untilExpiry);
    return () => clearTimeout(timer);
  }, [exits]);

  // Reset when switching markets.
  useEffect(() => { setExits([]); setPicked(null); setPickedGroup(null); }, [market]);

  const markers = useMemo(() => tradeMarkers(bubbles, toXY, width, height, !!hideMine, showHistory), [bubbles, toXY, width, height, hideMine, showHistory]);
  const paths = showHistory ? bubbles.flatMap(b => {
    if (b.state !== "closed" || b.exit_price === null) return [];
    const entry = toXY(Date.parse(b.opened_at) / 1000, b.entry_price, true);
    const exit = toXY(Date.parse(b.at) / 1000, b.exit_price, true);
    return entry && exit ? [{ b, entry, exit }] : [];
  }) : [];

  // Mates' exits that are off the left edge of this timeframe: offer to zoom out to find them.
  const earlier = bubbles.filter((b) => b.state === "closed" && b.exit_price !== null && !toXY(Date.parse(b.opened_at) / 1000, b.entry_price) && !toXY(Date.parse(b.at) / 1000, b.exit_price)).length;
  const sel = picked ? bubbles.find((b) => b.id === picked) : undefined;
  const group = markers.find(m => m.key === pickedGroup);

  return (
    <>
      <svg className="trade-connectors" width={width} height={height} aria-hidden="true">
        {paths.map(({ b, entry, exit }) => <g key={b.id} className={`trade-path ${b.side} ${picked === b.id ? "selected" : ""}`} data-testid="trade-path" data-trade-id={b.id}>
          <line className="trade-path-outline" x1={entry.x} y1={entry.y} x2={exit.x} y2={exit.y} />
          <line className="trade-path-line" x1={entry.x} y1={entry.y} x2={exit.x} y2={exit.y} />
        </g>)}
        {markers.filter(m => Math.hypot(m.x - m.anchorX, m.y - m.anchorY) > 2).map(m => <g key={m.key} className="trade-stem">
          <line x1={m.anchorX} y1={m.anchorY} x2={m.x} y2={m.y} /><circle cx={m.anchorX} cy={m.anchorY} r="2.5" />
        </g>)}
      </svg>
      {markers.map((m) => {
        const b = m.trades[0];
        const room = b.equity && b.dd_floor ? (b.equity - b.dd_floor) / Math.max(1, b.equity * 0.08) : 1;
        return <TradeMarker key={m.key} handle={b.handle} long={b.side === "long"} exit={m.exit} closed={b.state === "closed"} me={b.is_you} count={m.trades.length} fresh={!m.exit && m.trades.some(b => fresh.has(b.id))} danger={b.state === "open" && room < 0.2}
          style={{ left: m.x, top: m.y }} testId={m.exit ? "exit-mark" : b.is_you && b.state === "open" ? "my-bubble" : "bubble"}
          onClick={() => { setPickedGroup(m.trades.length > 1 ? m.key : null); setPicked(m.trades.length > 1 ? null : b.id); onSelect(b); }}
          label={`${b.is_you ? "You" : `@${b.handle}`} ${m.trades.length > 1 || m.mixed ? `${m.trades.length} ${m.mixed ? "trades" : m.exit ? "exits" : "entries"}. Tap to view every trade` : `${m.exit ? "exited" : "entered"} ${b.side} ${b.quantity} micros at ${px(m.exit ? b.exit_price! : b.entry_price)}`}`} />;
      })}
      {exits.map((e) => {
        const at = toXY(Date.parse(e.b.at) / 1000, e.b.exit_price ?? e.b.entry_price);
        return at && <ExitFx key={e.b.id} e={{ ...e, x: at.x, y: Math.max(24, at.y - 30) }} />;
      })}
      {showHistory && earlier > 0 && onZoomOut && <button type="button" className="earlier-pill" onClick={onZoomOut} data-testid="earlier-trades">
        ◂ {earlier} offscreen trade{earlier === 1 ? "" : "s"} · zoom out</button>}
      {group && !sel && <div className="trade-card trade-group" role="dialog" aria-label={`${group.trades[0].handle}'s trades`} data-testid="trade-group" onPointerDown={e => e.stopPropagation()}>
        <div className="row between"><b>@{group.trades[0].handle} · {group.trades.length} trades</b><button className="tc-x" aria-label="Close trade list" onClick={() => setPickedGroup(null)}>✕</button></div>
        <div className="trade-group-list">{group.trades.map(b => <button type="button" key={b.id} onClick={() => { setPicked(b.id); onSelect(b); }}>
          <span>{b.side === "long" ? "▲ Long" : "▼ Short"} ×{b.quantity}<small>{new Date(b.opened_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</small></span>
          <span>{px(b.entry_price)} → {b.exit_price === null ? "Open" : px(b.exit_price)}<small className={(b.pnl ?? 0) >= 0 ? "lime" : "red"}>{b.pnl === null ? "Holding" : signedMoney(b.pnl)}</small></span>
        </button>)}</div>
      </div>}
      {sel && <TradeCard b={sel} quote={quote} market={market} now={now} onClose={() => setPicked(null)} />}
    </>
  );
}

/** The tap-a-marker card (like pump.fun's trader popover): who, size, entry, profit, how long. */
export function TradeCard({ b, quote, market, now, onClose }: { b: Bubble; quote: number | null; market: Market; now: number; onClose: () => void }) {
  const open = b.state === "open";
  const pnl = open ? (quote != null ? pnlAt(b, quote, market) : null) : b.pnl;
  return (
    <div className="trade-card" role="dialog" aria-label={`${b.handle}'s trade`} data-testid="trade-card" onPointerDown={(e) => e.stopPropagation()}>
      <div className="row between">
        <span className="tc-kind"><i className={b.side} />{b.side === "long" ? "Long" : "Short"} {MARKETS[market].title}</span>
        <span className="row" style={{ gap: 8 }}>
          <span className={`tc-state ${open ? "open" : ""}`}>{open ? "Open" : b.reason === "blown" ? "REKT" : "Closed"}</span>
          <button type="button" className="muted tc-x" onClick={onClose} aria-label="Close trade card">✕</button>
        </span>
      </div>
      <div className="row" style={{ gap: 10, margin: "8px 0 10px" }}>
        <Avatar className={`tc-av ${b.side}`} handle={b.handle} />
        <div style={{ minWidth: 0 }}>
          <b style={{ fontSize: 13 }}>{b.is_you ? "You" : `@${b.handle}`}</b>
          <div className="muted" style={{ fontSize: 10 }}>{b.quantity} micro{b.quantity === 1 ? "" : "s"}{b.size_pct ? ` · ${b.size_pct.toFixed(1)}% of account` : ""}</div>
        </div>
      </div>
      <div className={`tc-result ${pnl === null ? "muted" : pnl >= 0 ? "lime" : "red"}`} data-testid="bubble-pnl"><span>P&amp;L</span><strong>{pnl === null ? "—" : signedMoney(pnl)}</strong><small>{open ? "Live · position open" : b.reason === "market_close" ? "Final · market close" : "Final · trade closed"}</small></div>
      <div className="tc-grid">
        <div><span>Entry price</span><b>{px(b.entry_price)}</b></div>
        <div><span>{open ? "Price now" : "Exit price"}</span><b>{open ? (quote != null ? px(quote) : "—") : px(b.exit_price ?? b.entry_price)}</b></div>
        <div><span>Entry time</span><b>{new Date(b.opened_at).toLocaleString()}</b></div>
        <div><span>Held for</span><b>{held((open ? now : Date.parse(b.at)) - Date.parse(b.opened_at))}</b></div>
      </div>
      {!b.is_you && <div className="tc-actions"><PlayerLink handle={b.handle}>Profile</PlayerLink></div>}
    </div>
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
