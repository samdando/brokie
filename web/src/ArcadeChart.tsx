import { ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ToXY } from "./Chart";
import type { Candle, Market, Position, Side } from "./types";
import { MARKETS, digits, pnlOf } from "./types";
import type { Bracket } from "./game";
import { px, signedMoney } from "./ui";
import { swipeGuard } from "./pageSwipe";

/** Brokie's own chart: a full-bleed canvas fed by Brokie's candles (OANDA prices via the server).
 *  Hold anywhere to trade (top half = BUY, bottom half = SELL), slide to set TP/SL, lift to lock.
 *  Drag an existing TP/SL line to move it. Drag sideways to scroll back through history (at the live
 *  edge a leftward drag is left to the page swipe). Pinch to zoom, double-tap to reset. */

const UP = "#F2F3F5", DOWN = "#FF5C67", GRID = "rgba(255,255,255,.045)", AXIS = "rgba(255,255,255,.42)";
const LONG = "#7FE0B8", SHORT = "#FF6F79", TP = "#7FE0B8", SL = "#FF6F79";
const AXIS_W = 62, TIME_H = 22;
// Price room above/below the candles. The focus floor keeps its HUD outside the chart, so it only needs a little air.
const DEFAULT_TOP_PAD = 84, DEFAULT_BOTTOM_PAD = 74;
export const HOLD_MS = 340;
const DEFAULT_SPAN = 64, MIN_SPAN = 16, MAX_SPAN = 240;

export interface HoldPreview { side: Side; entry: number; tp: number | null; sl: number | null; /** Holding against your position takes micros off it instead of hedging. */ closing?: boolean }
export interface ArcadeTradeHandlers {
  /** Why a hold can't trade right now (closed market, locked account…), or null when it can. */
  blocked: string | null;
  onArm: (side: Side) => void;
  onSlide: (price: number | null) => void;
  onRelease: () => void;
  onBlocked: (reason: string) => void;
}

export function ArcadeChart({ market, candles, bucketSeconds, quote, positions, brackets, preview, trade, onMoveLevel, overlay, height, topPad = DEFAULT_TOP_PAD, bottomPad = DEFAULT_BOTTOM_PAD }: {
  market: Market; candles: Candle[]; bucketSeconds: number; quote: number | null; positions: Position[];
  brackets: Record<string, Bracket>; preview: HoldPreview | null; trade: ArcadeTradeHandlers;
  onMoveLevel: (positionId: string, kind: "sl" | "tp", price: number) => void;
  overlay?: (toXY: ToXY, width: number, height: number) => ReactNode; height: number; topPad?: number; bottomPad?: number;
}) {
  const TOP_PAD = topPad, BOTTOM_PAD = bottomPad;
  const host = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(360);
  const [span, setSpan] = useState(DEFAULT_SPAN);
  /** How many candles back from the newest the view is scrolled (0 = live edge). */
  const [offset, setOffset] = useState(0);
  const maxOffset = Math.max(0, candles.length - Math.min(span, candles.length));
  const off = Math.min(offset, maxOffset);
  // While scrolled back, keep the same candles in view as new ones arrive.
  const seenLast = useRef<number | null>(null);
  const newest = candles.length ? candles[candles.length - 1].index : null;
  useEffect(() => {
    const prev = seenLast.current; seenLast.current = newest;
    if (prev != null && newest != null && newest > prev) setOffset(o => o > 0 ? o + (newest - prev) : 0);
  }, [newest]);
  useEffect(() => { setOffset(0); }, [market, bucketSeconds]);
  const [finger, setFinger] = useState<{ x: number; y: number; armed: boolean; side: Side | null } | null>(null);
  const [dragLine, setDragLine] = useState<{ id: string; kind: "sl" | "tp"; price: number } | null>(null);

  useLayoutEffect(() => {
    const el = host.current; if (!el) return;
    const fit = () => setWidth(Math.max(200, Math.floor(el.clientWidth)));
    fit(); const ro = new ResizeObserver(fit); ro.observe(el); return () => ro.disconnect();
  }, []);

  const plotW = Math.max(60, width - AXIS_W), plotH = Math.max(60, height - TIME_H);
  const step = digits(market) === 0 ? MARKETS[market].tick : MARKETS[market].tick;
  // Leave a little room on the right of the newest candle for the live price tag.
  const slots = span + 4;
  const end = candles.length - off;
  const visible = candles.slice(Math.max(0, end - span), end);
  const lastIndex = visible.length ? visible[visible.length - 1].index : 0;
  const firstSlotIndex = lastIndex - span + 1;
  const xOfIndex = (i: number) => ((i - firstSlotIndex) + .5) / slots * plotW;
  const candleW = Math.max(1, Math.min(14, plotW / slots * .64));

  // Price range: what's visible, plus the live price and nearby trade levels.
  const liveRange = useMemo(() => {
    let lo = Infinity, hi = -Infinity;
    for (const c of visible) { lo = Math.min(lo, c.low); hi = Math.max(hi, c.high); }
    if (quote != null && off === 0) { lo = Math.min(lo, quote); hi = Math.max(hi, quote); }
    if (!Number.isFinite(lo)) return null;
    const base = Math.max(hi - lo, step * 8);
    const extra: number[] = [];
    for (const p of positions) { extra.push(p.entry_price); const b = brackets[p.id]; if (b?.sl != null) extra.push(b.sl); if (b?.tp != null) extra.push(b.tp); }
    if (preview) { extra.push(preview.entry); if (preview.tp != null) extra.push(preview.tp); if (preview.sl != null) extra.push(preview.sl); }
    for (const v of extra) if (Number.isFinite(v) && v > lo - base * 1.2 && v < hi + base * 1.2) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    const pad = Math.max(hi - lo, step * 8) * .08;
    return { lo: lo - pad, hi: hi + pad };
  }, [visible, quote, positions, brackets, preview, step, off]);
  // While a TP/SL line is being dragged the scale stays put, so the line never chases the finger.
  const frozen = useRef<typeof liveRange>(null);
  if (dragLine) { if (!frozen.current) frozen.current = liveRange; } else frozen.current = null;
  const range = frozen.current ?? liveRange;

  const usable = Math.max(40, plotH - TOP_PAD - BOTTOM_PAD);
  const yOf = (p: number) => range ? TOP_PAD + (range.hi - p) / (range.hi - range.lo) * usable : 0;
  const priceAt = (y: number) => range ? range.hi - (y - TOP_PAD) / usable * (range.hi - range.lo) : null;
  const snap = (p: number) => Math.round(p / step) * step;

  const toXY: ToXY = (secs, price, unclipped = false) => {
    if (!range || !Number.isFinite(secs) || !Number.isFinite(price) || !candles.length) return null;
    const x = xOfIndex(Math.floor(secs / bucketSeconds)), y = yOf(price);
    const clamped = x < 0 || x > plotW || y < 0 || y > plotH;
    if (clamped && !unclipped) return null;
    return { x, y, clamped };
  };

  // ---------- drawing ----------
  useEffect(() => {
    const c = canvas.current; if (!c) return;
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    c.width = Math.round(width * dpr); c.height = Math.round(height * dpr);
    c.style.width = `${width}px`; c.style.height = `${height}px`;
    const g = c.getContext("2d"); if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, width, height);
    if (!range) return;
    const font = "500 10px ui-monospace, SFMono-Regular, Menlo, monospace";
    g.font = font; g.textBaseline = "middle";
    // grid + price axis
    const ticks = niceTicks(range.lo - (range.hi - range.lo) * BOTTOM_PAD / usable, range.hi + (range.hi - range.lo) * TOP_PAD / usable, Math.max(3, Math.floor(plotH / 64)));
    // Axis labels step aside for price tags (entry, target, stop, live price).
    const busy: number[] = [quote, preview?.entry, preview?.tp, preview?.sl, ...positions.flatMap(p => [p.entry_price, brackets[p.id]?.tp, brackets[p.id]?.sl])]
      .filter((v): v is number => v != null).map(yOf);
    for (const t of ticks) {
      const y = Math.round(yOf(t)) + .5; if (y < 6 || y > plotH - 4) continue;
      if (busy.some(b => Math.abs(b - y) < 17)) {
        g.setLineDash([1, 4]); g.strokeStyle = GRID; g.lineWidth = 1; g.beginPath(); g.moveTo(0, y); g.lineTo(plotW, y); g.stroke(); g.setLineDash([]);
        continue;
      }
      g.setLineDash([1, 4]); g.strokeStyle = GRID; g.lineWidth = 1; g.beginPath(); g.moveTo(0, y); g.lineTo(plotW, y); g.stroke(); g.setLineDash([]);
      g.fillStyle = AXIS; g.textAlign = "right"; g.fillText(px(t, digits(market)), width - 6, y);
    }
    // time labels
    g.textAlign = "center"; g.fillStyle = AXIS;
    const every = Math.max(1, Math.round(span / 4));
    for (const k of visible) {
      if (k.index % every) continue;
      const x = xOfIndex(k.index); if (x < 24 || x > plotW - 24) continue;
      g.fillText(timeLabel(k.index * bucketSeconds, bucketSeconds), x, height - TIME_H / 2);
    }
    // candles
    for (const k of visible) {
      const x = Math.round(xOfIndex(k.index)) + .5;
      const up = k.close >= k.open;
      g.strokeStyle = g.fillStyle = up ? UP : DOWN;
      g.lineWidth = 1;
      g.beginPath(); g.moveTo(x, yOf(k.high)); g.lineTo(x, yOf(k.low)); g.stroke();
      const top = yOf(Math.max(k.open, k.close)), bot = yOf(Math.min(k.open, k.close));
      g.fillRect(x - candleW / 2, top, candleW, Math.max(1, bot - top));
    }
    // Positions: the entry as a dashed line with a notched tag, target and stop as shaded zones
    // (Setup Cards style), each level priced on the axis.
    type Level = { price: number; color: string; label: string; strong?: boolean; axis?: boolean };
    const levels: Level[] = [];
    const zone = (entry: number, level: number | null | undefined, color: string, kind: "tp" | "sl", other: number | null | undefined, fromX: number, textPnl: number | null) => {
      if (level == null) return;
      const y0 = yOf(entry), y1 = yOf(level);
      const top = Math.max(0, Math.min(y0, y1)), bot = Math.min(plotH, Math.max(y0, y1));
      g.fillStyle = color === TP ? "rgba(127,224,184,.10)" : "rgba(255,111,121,.10)";
      g.fillRect(fromX, top, plotW - fromX, bot - top);
      const yl = Math.round(y1) + .5;
      if (yl >= 0 && yl <= plotH) { g.strokeStyle = color; g.lineWidth = 1; g.beginPath(); g.moveTo(fromX, yl); g.lineTo(plotW, yl); g.stroke(); }
      const r = other != null && Math.abs(other - entry) > 0 ? Math.abs(level - entry) / Math.abs(other - entry) : null;
      const label = `${kind === "tp" ? "TARGET" : "STOP"}${r != null ? ` ${(kind === "tp" ? r : 1).toFixed(1)}R` : textPnl != null ? ` ${signedMoney(textPnl)}` : ""}`;
      g.font = "700 9px ui-monospace, SFMono-Regular, Menlo, monospace"; g.textAlign = "left"; g.fillStyle = color;
      g.fillText(label, Math.min(fromX, plotW - 90) + 6, kind === "tp" ? yl - 8 : yl + 9);
      levels.push({ price: level, color, label: "", axis: true });
    };
    const entryX = (opened?: string) => { if (!opened) return 0; const at = toXY(Date.parse(opened) / 1000, 0, true); return at ? Math.max(0, Math.min(plotW, at.x)) : 0; };
    for (const p of positions) {
      const pnl = quote != null ? pnlOf(p, quote) : null;
      const b = brackets[p.id] ?? {};
      const tp = dragLine && dragLine.id === p.id && dragLine.kind === "tp" ? dragLine.price : b.tp;
      const sl = dragLine && dragLine.id === p.id && dragLine.kind === "sl" ? dragLine.price : b.sl;
      const x0 = entryX(p.opened_at);
      zone(p.entry_price, tp, TP, "tp", sl, x0, tp != null ? pnlOf(p, tp) : null);
      zone(p.entry_price, sl, SL, "sl", tp, x0, sl != null ? pnlOf(p, sl) : null);
      levels.push({ price: p.entry_price, color: p.side === "long" ? LONG : SHORT, label: `${p.side === "long" ? "LONG" : "SHORT"} ${p.quantity}${pnl != null ? `  ${signedMoney(pnl)}` : ""}`, strong: true, axis: true });
    }
    if (preview) {
      const fake = { ...positions[0], market, side: preview.side, quantity: 1, entry_price: preview.entry } as Position;
      zone(preview.entry, preview.tp, TP, "tp", preview.sl, 0, preview.tp != null ? pnlOf(fake, preview.tp) : null);
      zone(preview.entry, preview.sl, SL, "sl", preview.tp, 0, preview.sl != null ? pnlOf(fake, preview.sl) : null);
      levels.push({ price: preview.entry, color: preview.side === "long" ? LONG : SHORT, label: preview.closing ? "CLOSING" : preview.side === "long" ? "BUYING" : "SELLING", strong: true, axis: true });
    }
    for (const l of levels) {
      const y = Math.round(yOf(l.price)) + .5; if (y < 0 || y > plotH) continue;
      if (l.strong) {
        g.setLineDash([3, 3]); g.strokeStyle = "rgba(255,255,255,.7)"; g.lineWidth = 1; g.beginPath(); g.moveTo(0, y); g.lineTo(plotW, y); g.stroke(); g.setLineDash([]);
        g.font = "700 10px ui-monospace, SFMono-Regular, Menlo, monospace"; g.textAlign = "left";
        const w = g.measureText(l.label).width + 14;
        g.fillStyle = l.color; notched(g, 8, y - 10, w, 20); g.fill();
        g.fillStyle = "#0c0e11"; g.fillText(l.label, 15, y + .5);
      }
      if (l.axis) {
        g.font = "700 10px ui-monospace, SFMono-Regular, Menlo, monospace"; g.textAlign = "right";
        g.fillStyle = l.color; notched(g, plotW + 2, y - 9, AXIS_W - 4, 18); g.fill();
        g.fillStyle = "#0c0e11"; g.fillText(px(l.price, digits(market)), width - 6, y + .5);
      }
      g.font = font;
    }
    // live price
    if (quote != null) {
      const y = Math.round(yOf(quote)) + .5;
      g.setLineDash([1, 3]); g.strokeStyle = "rgba(255,255,255,.55)"; g.beginPath(); g.moveTo(0, y); g.lineTo(plotW, y); g.stroke(); g.setLineDash([]);
      g.fillStyle = "#F2F3F5"; roundRect(g, plotW + 2, y - 10, AXIS_W - 4, 20, 4); g.fill();
      g.fillStyle = "#0c0e11"; g.font = "700 10px ui-monospace, SFMono-Regular, Menlo, monospace"; g.textAlign = "right";
      g.fillText(px(quote, digits(market)), width - 6, y + .5);
    }
  }, [width, height, range, candles, span, off, quote, positions, brackets, preview, dragLine, market, bucketSeconds]);

  // ---------- gestures ----------
  const g = useRef<{
    id: number; x: number; y: number; timer: ReturnType<typeof setTimeout> | null; armed: boolean; side: Side | null; armY: number;
    line: { id: string; kind: "sl" | "tp" } | null; lastTap: number;
    pan?: { from: number; slotW: number };
  } | null>(null);
  const pinch = useRef<{ pts: Map<number, { x: number; y: number }>; start: number; span: number } | null>(null);
  const lastTap = useRef(0);
  const live = useRef({ trade, onMoveLevel, priceAt, plotH, positions, brackets, yOf, off, maxOffset, plotW, slots });
  live.current = { trade, onMoveLevel, priceAt, plotH, positions, brackets, yOf, off, maxOffset, plotW, slots };

  const release = () => { swipeGuard.owned = false; };
  useEffect(() => () => { release(); if (g.current?.timer) clearTimeout(g.current.timer); }, []);

  const local = (e: React.PointerEvent) => { const r = host.current!.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  function down(e: React.PointerEvent) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const p = local(e);
    // Second finger: pinch zoom, and forget any hold.
    if (g.current && g.current.id !== e.pointerId && e.pointerType === "touch") {
      cancelHold();
      pinch.current = { pts: new Map([[g.current.id, { x: g.current.x, y: g.current.y }], [e.pointerId, p]]), start: 0, span };
      const [a, b] = [...pinch.current.pts.values()]; pinch.current.start = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      return;
    }
    // Grab a saved TP/SL line within reach.
    const L = live.current;
    for (const pos of L.positions) for (const kind of ["tp", "sl"] as const) {
      const v = L.brackets[pos.id]?.[kind]; if (v == null) continue;
      if (Math.abs(L.yOf(v) - p.y) < 16 && p.x < plotW) {
        g.current = { id: e.pointerId, x: p.x, y: p.y, timer: null, armed: false, side: null, armY: p.y, line: { id: pos.id, kind }, lastTap: 0 };
        swipeGuard.owned = true; host.current?.setPointerCapture(e.pointerId);
        setDragLine({ id: pos.id, kind, price: v }); return;
      }
    }
    const now = performance.now();
    if (now - lastTap.current < 300) { setSpan(DEFAULT_SPAN); setOffset(0); lastTap.current = 0; return; }
    lastTap.current = now;
    const state = { id: e.pointerId, x: p.x, y: p.y, timer: null as ReturnType<typeof setTimeout> | null, armed: false, side: null as Side | null, armY: p.y, line: null, lastTap: now };
    g.current = state;
    setFinger({ x: p.x, y: p.y, armed: false, side: null });
    state.timer = setTimeout(() => {
      if (g.current !== state) return;
      state.timer = null;
      const blocked = live.current.trade.blocked;
      if (blocked) { live.current.trade.onBlocked(blocked); g.current = null; setFinger(null); return; }
      state.armed = true; state.side = state.y < live.current.plotH / 2 ? "long" : "short"; state.armY = state.y;
      swipeGuard.owned = true;
      try { host.current?.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
      setFinger({ x: state.x, y: state.y, armed: true, side: state.side });
      live.current.trade.onArm(state.side);
    }, HOLD_MS);
  }
  function cancelHold() {
    const s = g.current; if (!s) return;
    if (s.timer) clearTimeout(s.timer);
    g.current = null; setFinger(null);
  }
  function move(e: React.PointerEvent) {
    const P = pinch.current;
    if (P && P.pts.has(e.pointerId)) {
      P.pts.set(e.pointerId, local(e));
      const [a, b] = [...P.pts.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      setSpan(Math.round(Math.max(MIN_SPAN, Math.min(MAX_SPAN, P.span * P.start / d))));
      return;
    }
    const s = g.current; if (!s || s.id !== e.pointerId) return;
    const p = local(e);
    if (s.line) {
      const y = Math.max(TOP_PAD * .4, Math.min(live.current.plotH - BOTTOM_PAD * .4, p.y));
      const price = live.current.priceAt(y); if (price != null) setDragLine({ id: s.line.id, kind: s.line.kind, price: snap(price) });
      return;
    }
    if (s.pan) {
      const back = Math.round((p.x - s.x) / s.pan.slotW);
      setOffset(Math.max(0, Math.min(live.current.maxOffset, s.pan.from + back)));
      return;
    }
    if (!s.armed) {
      const dx = p.x - s.x, dy = p.y - s.y;
      if (Math.hypot(dx, dy) <= 8) return;
      // Sideways drag scrolls history: rightward always, leftward only once scrolled back.
      // At the live edge a leftward drag stays a page swipe (Trade is the first page, so rightward has no page to go to).
      if (Math.abs(dx) > Math.abs(dy) && (dx > 0 || live.current.off > 0)) {
        if (s.timer) clearTimeout(s.timer);
        s.timer = null; s.x = p.x; s.pan = { from: live.current.off, slotW: Math.max(1, live.current.plotW / live.current.slots) };
        swipeGuard.owned = true; setFinger(null);
        try { host.current?.setPointerCapture(e.pointerId); } catch { /* */ }
        return;
      }
      cancelHold();   // a page swipe or scroll, not a hold
      return;
    }
    setFinger({ x: p.x, y: p.y, armed: true, side: s.side });
    const price = live.current.priceAt(p.y);
    live.current.trade.onSlide(Math.abs(p.y - s.armY) < 14 || price == null ? null : snap(price));
  }
  function up(e: React.PointerEvent) {
    const P = pinch.current;
    if (P && P.pts.has(e.pointerId)) { P.pts.delete(e.pointerId); if (P.pts.size < 2) pinch.current = null; g.current = null; setFinger(null); return; }
    const s = g.current; if (!s || s.id !== e.pointerId) return;
    g.current = null;
    if (s.timer) clearTimeout(s.timer);
    if (s.pan) { release(); return; }
    if (s.line) {
      setDragLine(d => { if (d) live.current.onMoveLevel(d.id, d.kind, d.price); return null; });
      release(); return;
    }
    setFinger(null);
    if (s.armed) { live.current.trade.onRelease(); release(); }
  }
  function cancel(e: React.PointerEvent) {
    if (pinch.current?.pts.has(e.pointerId)) { pinch.current = null; return; }
    const s = g.current; if (!s || s.id !== e.pointerId) return;
    if (s.armed) { live.current.trade.onRelease(); }
    if (s.line) setDragLine(null);
    if (s.pan) { g.current = null; release(); return; }
    cancelHold(); release();
  }

  const half = plotH / 2;
  return (
    <div ref={host} className="arcade-chart" data-testid="arcade-chart" data-offset={off} data-range={range ? `${range.lo.toFixed(2)}:${range.hi.toFixed(2)}` : ""} style={{ height }}
      onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={cancel} onContextMenu={e => e.preventDefault()}>
      <canvas ref={canvas} aria-label={`${MARKETS[market].title} price chart`} role="img" />
      {overlay && <div className="arcade-overlay" style={{ width: plotW, height: plotH }}>{overlay(toXY, plotW, plotH)}</div>}
      {finger && <div className={`hold-ring ${finger.armed ? "armed" : ""} ${finger.side ?? (finger.y < half ? "long" : "short")}`} style={{ left: finger.x, top: finger.y }} aria-hidden="true"><i /></div>}
      {finger?.armed && finger.side && <div className={`hold-label ${finger.side}`} style={{ top: Math.max(10, Math.min(plotH - 60, finger.y - 70)) }} data-testid="hold-label">
        <b>{preview?.closing ? "CLOSING" : finger.side === "long" ? "BUYING" : "SELLING"}</b>
        <span>{preview?.closing ? "Taking it off · no hedge" : preview?.tp != null ? `TP ${px(preview.tp, digits(market))} · SL ${px(preview.sl!, digits(market))}` : "Slide ↑↓ for TP/SL · lift to lock"}</span>
      </div>}
      {off > 0 && <button type="button" className="chart-live" data-testid="chart-live" onPointerDown={e => e.stopPropagation()} onClick={() => setOffset(0)} style={{ right: AXIS_W + 10 }}>Live ›</button>}
      {!candles.length && <div className="chart-empty" role="status"><span aria-hidden="true">⌁</span><b>Waiting for the market</b><small>Fresh prices and candles will appear here.</small></div>}
    </div>
  );
}

/** A tag with two clipped corners, like a ticket stub. */
function notched(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, n = 4) {
  g.beginPath(); g.moveTo(x + n, y); g.lineTo(x + w, y); g.lineTo(x + w, y + h - n); g.lineTo(x + w - n, y + h); g.lineTo(x, y + h); g.lineTo(x, y + n); g.closePath();
}
function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}

export function niceTicks(lo: number, hi: number, count: number): number[] {
  const span = hi - lo; if (!(span > 0)) return [];
  const raw = span / count, mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const stepSize = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= raw) ?? 10 * mag;
  const out: number[] = [];
  for (let v = Math.ceil(lo / stepSize) * stepSize; v <= hi; v += stepSize) out.push(Number(v.toFixed(8)));
  return out;
}

function timeLabel(secs: number, bucket: number) {
  const d = new Date(secs * 1000);
  if (bucket >= 86400) return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
  if (d.getHours() === 0 && d.getMinutes() === 0) return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/** TP/SL from one slide: the side you drag to sets that level, the other mirrors it 1:1 from the entry. */
export function levelsFromSlide(side: Side, entry: number, price: number | null, tick: number): { tp: number | null; sl: number | null } {
  if (price == null || !Number.isFinite(price) || !Number.isFinite(entry)) return { tp: null, sl: null };
  const d = Math.abs(price - entry);
  if (d < tick) return { tp: null, sl: null };
  const snapTo = (v: number) => Math.round(v / tick) * tick;
  const profitUp = side === "long";
  const towardProfit = profitUp ? price > entry : price < entry;
  const tp = towardProfit ? price : profitUp ? entry + d : entry - d;
  const sl = towardProfit ? (profitUp ? entry - d : entry + d) : price;
  return { tp: snapTo(tp), sl: snapTo(sl) };
}
