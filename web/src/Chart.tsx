import { PointerEvent as ReactPointerEvent, ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { createChart, ColorType, CrosshairMode, IChartApi, ISeriesApi, LineStyle, UTCTimestamp, IPriceLine, MouseEventParams, Logical } from "lightweight-charts";
import type { Candle, Market, Position } from "./types";
import { MARKETS, direction, pnlOf } from "./types";
import { TradeCard } from "./Bubbles";
import type { Bracket } from "./game";
import { px, signedMoney } from "./ui";

const LIME = "#F0F1F2", RED = "#FF656F", MUTED = "#737783";
export const CHART_SMALL = 304;
const PIN_TOP = 36, PIN_BOTTOM = 40;   // px kept clear for the O/H/L/C legend and the time axis   // chart height in px (includes the time axis)
// One chart on screen at a time, so its height lives here and the overlay pieces read it.
let H = CHART_SMALL;
const VIEW_BARS = 60;     // bars shown when snapped to live
const ANIM_MS = 450;      // forming-candle tween (C4)

/** The Brokie chart: candles or line with a time axis, squad trade markers, and your positions (hedges show both). */
export type ToXY = (unixSeconds: number, price: number, unclipped?: boolean) => { x: number; y: number; clamped: boolean } | null;

type Bar = { time: UTCTimestamp; open: number; high: number; low: number; close: number };
interface Hover { o: number; h: number; l: number; c: number; time: number; price: number | null }

export function BrokieChart({ market, candles, bucketSeconds, quote, positions, style, overlay, sizePctOf, brackets, onBracket, onClearBracket, handle = "?", fullscreen = false, height = CHART_SMALL }:
  { height?: number; fullscreen?: boolean; handle?: string; market: Market; candles: Candle[]; bucketSeconds: number; quote: number | null; positions: Position[]; style: "candles" | "line";
    overlay?: (toXY: ToXY, width: number, height: number) => ReactNode; equity?: number; sizePctOf?: (p: Position) => number | null;
    brackets?: Record<string, Bracket>; onBracket?: (id: string, b: Bracket) => void; onClearBracket?: (id: string, key: keyof Bracket) => void }) {
  H = height;
  const [, setFrame] = useState(0);
  const [plotWidth, setPlotWidth] = useState(0);
  const [hover, setHover] = useState<Hover | null>(null);
  const [awayFromLive, setAway] = useState(false);
  const host = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const series = useRef<{ candle: ISeriesApi<"Candlestick">; area: ISeriesApi<"Area"> } | null>(null);
  const lines = useRef<IPriceLine[]>([]);
  const quoteLine = useRef<IPriceLine | null>(null);
  const lastKey = useRef("");
  const lastCount = useRef(0);
  const shown = useRef<{ key: string; first: number; bars: Bar[] } | null>(null);
  const anim = useRef(0);
  const prevQuote = useRef<number | null>(null);
  const tickColor = useRef(LIME);
  const requestFrame = useRef<() => void>(() => {});
  const plotRef = useRef(0);
  const countRef = useRef(0);
  const lastTap = useRef<{ t: number; x: number; y: number } | null>(null);
  // Touch bookkeeping so a pinch (two fingers lifting) or a drag never counts as a double-tap.
  const touches = useRef(new Map<number, { x: number; y: number; t: number }>());
  const gestureDirty = useRef(false);
  // True once the player pinches, drags or wheels the chart; auto-framing stays off until they go live again.
  const userMoved = useRef(false);
  const mine = positions.filter((p) => p.market === market);
  const m = MARKETS[market];

  const hedged = mine.some((p) => p.side === "long") && mine.some((p) => p.side === "short");

  const bucketRef = useRef(bucketSeconds);
  bucketRef.current = bucketSeconds;
  useEffect(() => {
    if (!host.current) return;
    const c = createChart(host.current, {
      height: H,
      // Keep the compact library attribution inside the chart.
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: MUTED, fontSize: 10, fontFamily: "ui-monospace, Menlo, monospace", attributionLogo: true },
      grid: { vertLines: { visible: false }, horzLines: { color: "rgba(180,185,200,.065)", style: LineStyle.Solid } },
      rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.16, bottom: 0.14 }, entireTextOnly: true },
      timeScale: { borderVisible: false, visible: true, timeVisible: true, secondsVisible: false, rightOffset: 6, minBarSpacing: 2, fixLeftEdge: false,
        // The chart picks the mark type: year/month/day marks get a date, the rest a time.
        tickMarkFormatter: (t: number, type: number) => { const d = new Date(t * 1000); return type < 3 || bucketRef.current >= 86400 ? d.toLocaleDateString([], { day: "numeric", month: "short" }) : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); } },
      // C5: on touch, a long-press enters crosshair tracking; the next tap exits it.
      crosshair: { mode: CrosshairMode.Normal, vertLine: { color: "rgba(255,255,255,.35)", labelVisible: true, labelBackgroundColor: "#2A3850" }, horzLine: { color: "rgba(255,255,255,.25)", labelBackgroundColor: "#2A3850" } },
      // Bar times are UTC seconds; show them in the player's own time zone.
      // Daily candles show just the date.
      localization: { locale: "en-US", timeFormatter: (t: number) => bucketRef.current >= 86400
        ? new Date(t * 1000).toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" })
        : new Date(t * 1000).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) },
      // The embedded chart is a locked preview; fullscreen enables chart navigation.
      handleScale: false,
      handleScroll: false,
      kineticScroll: { touch: false, mouse: false },
    });
    const candle = c.addCandlestickSeries({ upColor: LIME, downColor: RED, wickUpColor: LIME, wickDownColor: RED, borderVisible: false, priceLineVisible: false, lastValueVisible: false });
    const area = c.addAreaSeries({ lineWidth: 2, priceLineVisible: false, lastValueVisible: false });
    chart.current = c;
    series.current = { candle, area };
    let animationFrame = 0;
    const refreshOverlay = () => {
      cancelAnimationFrame(animationFrame);
      animationFrame = requestAnimationFrame(() => {
        // timeScale().width() is 0 while the time axis is hidden, so measure the plot directly:
        // chart width minus the price-axis labels.
        const w = Math.max(0, (host.current?.clientWidth ?? 0) - c.priceScale("right").width());
        plotRef.current = w;
        setPlotWidth(w);
        const r = c.timeScale().getVisibleLogicalRange();
        setAway(userMoved.current || (!!r && countRef.current > 0 && r.to < countRef.current - 1));
        setFrame((f) => f + 1);
      });
    };
    requestFrame.current = refreshOverlay;
    let gestureFrame = 0, settlingUntil = 0;
    const gesture = () => { settlingUntil = performance.now() + 300; if (!gestureFrame) gestureFrame = requestAnimationFrame(function loop() { refreshOverlay(); if (performance.now() < settlingUntil) gestureFrame = requestAnimationFrame(loop); else gestureFrame = 0; }); };
    host.current.addEventListener("pointermove", gesture);
    host.current.addEventListener("wheel", gesture, { passive: true });
    host.current.addEventListener("pointerup", gesture);
    const onCross = (p: MouseEventParams) => {
      const s = series.current;
      if (!s || !p.time || !p.point) { setHover(null); return; }
      const d = (p.seriesData.get(s.candle) ?? p.seriesData.get(s.area)) as (Bar & { value?: number }) | undefined;
      if (!d) { setHover(null); return; }
      const v = d.value;
      setHover({ o: d.open ?? v!, h: d.high ?? v!, l: d.low ?? v!, c: d.close ?? v!, time: Number(p.time), price: s.candle.coordinateToPrice(p.point.y) });
    };
    c.subscribeCrosshairMove(onCross);
    const ro = new ResizeObserver(() => { c.applyOptions({ width: host.current?.clientWidth ?? 300 }); refreshOverlay(); });
    ro.observe(host.current);
    c.timeScale().subscribeVisibleLogicalRangeChange(refreshOverlay);
    refreshOverlay();
    return () => {
      host.current?.removeEventListener("pointermove", gesture);
      host.current?.removeEventListener("wheel", gesture);
      host.current?.removeEventListener("pointerup", gesture);
      cancelAnimationFrame(gestureFrame);
      ro.disconnect();
      c.unsubscribeCrosshairMove(onCross);
      c.timeScale().unsubscribeVisibleLogicalRangeChange(refreshOverlay);
      cancelAnimationFrame(animationFrame);
      cancelAnimationFrame(anim.current);
      requestFrame.current = () => {};
      c.remove(); chart.current = null; series.current = null; quoteLine.current = null; lines.current = [];
      // A recreated chart has empty series (including React's development remount).
      // Never tween only the final bar into an otherwise empty chart.
      shown.current = null; lastKey.current = ""; lastCount.current = 0; countRef.current = 0;
      prevQuote.current = null; userMoved.current = false;
    };
  }, []);

  useEffect(() => { chart.current?.applyOptions({ height }); requestFrame.current(); }, [height]);


  const detach = () => {
    if (!fullscreen) return;
    userMoved.current = true;
    // Freeze the visible price range before a drag so ticks cannot pull it back.
    chart.current?.priceScale("right").applyOptions({ autoScale: false });
    setAway(true);
  };

  /** Snap the view back to the newest bars (double-tap / Live button). */
  const goLive = useCallback(() => {
    const c = chart.current; const n = countRef.current;
    if (!c || !n) return;
    userMoved.current = false;
    setAway(false);
    // An explicit range (not fitContent) so pinch/wheel zoom still works on short histories.
    c.timeScale().setVisibleLogicalRange({ from: Math.max(0, n - VIEW_BARS), to: n - 1 + 6 });
    c.priceScale("right").applyOptions({ autoScale: true });
  }, []);

  useEffect(() => {
    chart.current?.applyOptions({
      handleScale: { pinch: fullscreen, mouseWheel: fullscreen, axisPressedMouseMove: { time: fullscreen, price: fullscreen }, axisDoubleClickReset: { time: fullscreen, price: fullscreen } },
      handleScroll: { horzTouchDrag: fullscreen, vertTouchDrag: fullscreen, pressedMouseMove: fullscreen, mouseWheel: false },
      kineticScroll: { touch: fullscreen, mouse: false },
    });
    touches.current.clear(); lastTap.current = null;
    if (!fullscreen) goLive();
    requestFrame.current();
  }, [fullscreen, goLive]);


  // ---- Candles: full redraw on structural change, tweened forming candle otherwise (C4) ----
  useEffect(() => {
    const s = series.current;
    if (!s) return;
    const color = m.color;
    s.area.applyOptions({ lineColor: color, topColor: color + "38", bottomColor: color + "00", visible: style === "line" });
    s.candle.applyOptions({ visible: style === "candles" });
    const t = (i: number) => (i * bucketSeconds) as UTCTimestamp;
    const bars: Bar[] = candles.map((c) => ({ time: t(c.index), open: c.open, high: c.high, low: c.low, close: c.close }));
    const key = `${market}-${bucketSeconds}`;
    const prev = shown.current;
    countRef.current = bars.length;
    cancelAnimationFrame(anim.current);
    const sameShape = prev && prev.key === key && prev.bars.length === bars.length && bars.length > 0 &&
      prev.bars[0].time === bars[0].time && prev.bars[prev.bars.length - 1].time === bars[bars.length - 1].time &&
      bars.slice(0, -1).every((b, i) => b.close === prev.bars[i].close && b.high === prev.bars[i].high && b.low === prev.bars[i].low);
    const reduce = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (sameShape && !reduce) {
      const from = prev!.bars[prev!.bars.length - 1], to = bars[bars.length - 1];
      const start = performance.now();
      let hi = from.high, lo = from.low;
      const step = (now: number) => {
        const k = Math.min(1, (now - start) / ANIM_MS); const e = 1 - Math.pow(1 - k, 3);
        const close = from.close + (to.close - from.close) * e;
        hi = Math.max(hi, close); lo = Math.min(lo, close);
        const bar = { time: to.time, open: to.open, high: k >= 1 ? to.high : Math.min(to.high, hi), low: k >= 1 ? to.low : Math.max(to.low, lo), close };
        s.candle.update(bar);
        s.area.update({ time: to.time, value: close });
        requestFrame.current();
        if (k < 1) anim.current = requestAnimationFrame(step);

      };
      anim.current = requestAnimationFrame(step);
    } else {
      s.candle.setData(bars);
      s.area.setData(bars.map((b) => ({ time: b.time, value: b.close })));
    }
    shown.current = { key, first: bars[0]?.time ?? 0, bars };
    const viewKey = `${key}-${style}`;
    // Re-frame when the view changes or a batch of history arrives (not on every tick, and never
    // while the player has zoomed or panned away).
    if (viewKey !== lastKey.current) {
      goLive();
      lastKey.current = viewKey;
    } else if (Math.abs(bars.length - lastCount.current) > 2 && !userMoved.current) {
      goLive();
    }
    lastCount.current = bars.length;
    requestFrame.current();
  }, [candles, bucketSeconds, market, style, goLive, m.color]);

  // ---- C3: one current-price tag, coloured by the last tick direction ----
  useEffect(() => {
    const s = series.current;
    if (!s) return;
    if (quote !== null && prevQuote.current !== null && quote !== prevQuote.current) tickColor.current = quote > prevQuote.current ? LIME : RED;
    prevQuote.current = quote;
    const target = style === "candles" ? s.candle : s.area;
    if (quoteLine.current) { try { s.candle.removePriceLine(quoteLine.current); } catch { /* */ } try { s.area.removePriceLine(quoteLine.current); } catch { /* */ } quoteLine.current = null; }
    if (quote) quoteLine.current = target.createPriceLine({ price: quote, color: tickColor.current, lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: true, axisLabelTextColor: "#0C1220", title: "" });
  }, [quote, style, market]);

  // ---- Entry lines for your open positions (both legs when hedged). No axis tags: the right
  // axis keeps a single current-price tag. ----
  useEffect(() => {
    const s = series.current;
    if (!s) return;
    const target = style === "candles" ? s.candle : s.area;
    for (const l of lines.current) { try { s.candle.removePriceLine(l); } catch { /* */ } try { s.area.removePriceLine(l); } catch { /* */ } }
    lines.current = [];
    for (const p of mine) {
      lines.current.push(target.createPriceLine({ price: p.entry_price, color: (p.side === "long" ? "#7DD6B0" : RED) + "88", lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: false, title: "" }));
    }
    requestFrame.current();
  }, [positions, market, style]);

  const series_ = () => { const s = series.current; return s ? (style === "candles" ? s.candle : s.area) : null; };
  const yOf = (price: number) => { const y = series_()?.priceToCoordinate(price); return y == null ? null : y; };

  const priceOf = (y: number) => { const v = series_()?.coordinateToPrice(y); return v == null ? null : Number(v); };
  const plotHeight = Math.max(0, height - (chart.current?.timeScale().height() ?? 26));

  const toXY: ToXY = (secs, price, unclipped = false) => {
    const c = chart.current;
    if (!c || !series_() || !candles.length || !Number.isFinite(secs) || !Number.isFinite(price)) return null;
    const y = yOf(price);
    if (y === null || (!unclipped && (y < 0 || y > plotHeight))) return null;
    const bucket = Math.floor(secs / bucketSeconds);
    let index = candles.findIndex((bar) => bar.index === bucket);
    // Never move an old trade onto the first visible candle or bridge missing
    // history. Its position card remains available outside this chart window.
    if (index < 0) {
      if (!unclipped) return null;
      // Only connectors may extend beyond loaded candles. Keep their true direction
      // and let the SVG clip them; never invent a visible entry at the chart edge.
      const next = candles.findIndex((bar) => bar.index > bucket);
      if (next === 0) index = bucket - candles[0].index;
      else if (next < 0) index = candles.length - 1 + bucket - candles[candles.length - 1].index;
      else index = next - 1 + (bucket - candles[next - 1].index) / (candles[next].index - candles[next - 1].index);
    }
    // Use the chart's native bar coordinate. Estimating it from plot width drifts when
    // the library rounds bar spacing or the price-axis width changes during a gesture.
    const x = c.timeScale().logicalToCoordinate(index as Logical);
    if (x === null || (!unclipped && (x < 0 || x > plotRef.current))) return null;
    return { x, y, clamped: false };
  };

  // Crosshair readout distance from your (first) entry in this market.
  const ref = mine[0];
  const dist = hover?.price != null && ref ? (hover.price - ref.entry_price) * direction(ref.side) : null;

  return (
    <div>
      <div className="chart-host" style={{ position: "relative", width: "100%", height: H, touchAction: fullscreen ? "none" : "pan-y" }}
        onDoubleClick={() => { if (fullscreen) { lastTap.current = null; goLive(); } }}
        onWheel={detach}
        onPointerDown={(e) => {
          if (!fullscreen) return;
          if (e.pointerType !== "touch") { detach(); return; }
          if (touches.current.size === 0) gestureDirty.current = false;
          touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY, t: performance.now() });
          if (touches.current.size > 1) { gestureDirty.current = true; detach(); lastTap.current = null; }
        }}
        onPointerMove={(e) => {
          const s = touches.current.get(e.pointerId);
          if (s && Math.hypot(e.clientX - s.x, e.clientY - s.y) > 10) { gestureDirty.current = true; detach(); }
        }}
        onPointerCancel={(e) => { touches.current.delete(e.pointerId); gestureDirty.current = true; }}
        onPointerUp={(e) => {
          if (!fullscreen) return;
          if (e.pointerType !== "touch") return;
          const s = touches.current.get(e.pointerId);
          touches.current.delete(e.pointerId);
          // Only a clean, quick, single-finger tap counts toward a double-tap.
          if (!s || gestureDirty.current || touches.current.size > 0 || performance.now() - s.t > 250) { lastTap.current = null; return; }
          const now = performance.now(), prev = lastTap.current;
          if (prev && now - prev.t < 300 && Math.hypot(e.clientX - prev.x, e.clientY - prev.y) < 30) { lastTap.current = null; goLive(); }
          else lastTap.current = { t: now, x: e.clientX, y: e.clientY };
        }}>
        <div ref={host} style={{ width: "100%", height: H }} aria-label={`${m.title} price chart`} />
        {plotWidth > 0 && <div className="bubble-layer" style={{ width: plotWidth, right: "auto" }}>
          {overlay?.(toXY, plotWidth, plotHeight)}
          {hedged && <span className="hedge-pill" data-testid="my-hedged">HEDGED</span>}
          {mine.map((p, i) => <MyPosition key={p.id} p={p} slot={i} handle={handle} quote={quote} yOf={yOf} priceOf={priceOf}
            sizePct={sizePctOf?.(p) ?? null} hedged={hedged} b={brackets?.[p.id] ?? {}}
            onSet={onBracket && ((b) => onBracket(p.id, b))} onClear={(k) => onClearBracket?.(p.id, k)} />)}
        </div>}
        {(() => {
          // O/H/L/C readout: only while you're touching the chart (crosshair), so the chart stays clean.
          const bar = hover;
          if (!bar) return null;
          const ch = bar.c - bar.o, up = ch >= 0;
          return (
            <div className="chart-legend" data-testid="crosshair-readout">
              <span>O<b className={up ? "lime" : "red"}>{px(bar.o)}</b> H<b className={up ? "lime" : "red"}>{px(bar.h)}</b> L<b className={up ? "lime" : "red"}>{px(bar.l)}</b> C<b className={up ? "lime" : "red"}>{px(bar.c)}</b> <b className={up ? "lime" : "red"}>{up ? "+" : "−"}{(Math.abs(ch) / bar.o * 100).toFixed(2)}%</b></span>
              {hover && dist !== null && ref && <span><b className={dist >= 0 ? "lime" : "red"}>{signedMoney(dist * m.pointValue * ref.quantity)}</b> vs your entry</span>}
            </div>
          );
        })()}
        {awayFromLive && <button type="button" className="live-btn" onClick={goLive} data-testid="back-to-live">⟲ Live</button>}
      </div>
    </div>
  );
}


/** One of your position stacks: a pill on the entry line with size and live P&L.
 *  BubbleLayer draws individual fill markers. The pill is the SL/TP handle: drag it
 *  up or down. For a long, up is TP and down is SL; a short is the reverse. Set lines show
 *  "SL −$305"; tap one for its price and ✕, or drag it again. */
function MyPosition({ p, slot, handle, quote, yOf, priceOf, sizePct, hedged, b, onSet, onClear }:
  { p: Position; slot: number; handle: string; quote: number | null; yOf: (price: number) => number | null; priceOf: (y: number) => number | null;
    sizePct: number | null; hedged: boolean; b: Bracket; onSet?: (b: Bracket) => void; onClear: (k: keyof Bracket) => void }) {
  const [details, setDetails] = useState(false);
  const [drag, setDrag] = useState<{ price: number; key: keyof Bracket } | null>(null);
  const [open, setOpen] = useState<keyof Bracket | null>(null);
  const entryY = yOf(p.entry_price);
  const inView = (v: number | null): v is number => v !== null && v >= 0 && v <= H;
  // Zoomed in, your entry line can sit off the chart. The pill then pins to the top or bottom edge
  // (clear of the O/H/L/C legend and the time axis) so size and P&L are always on screen.
  const pinTop = PIN_TOP + slot * 22, pinBottom = H - PIN_BOTTOM - slot * 22;
  const rawY = entryY === null ? null : entryY + slot * 22;
  const pinned = rawY === null ? null : rawY < pinTop ? "above" : rawY > pinBottom ? "below" : null;
  const pillY = rawY === null ? null : Math.max(pinTop, Math.min(pinBottom, rawY));
  const pnl = quote != null ? pnlOf(p, quote) : 0;
  // Stop or target is decided against the LIVE price, not your entry, so a stop can trail past your
  // entry into profit (a short's stop dragged below entry is still a stop while it's above price).
  const ref = quote ?? p.entry_price;
  const keyFor = (price: number): keyof Bracket => ((price > ref) === (p.side === "long") ? "tp" : "sl");
  // Never let a level sit on the wrong side of the live price: it would fire on the next check.
  const clampFor = (key: keyof Bracket, price: number) => {
    const t = tickOf(ref), above = (key === "tp") === (p.side === "long");
    return above ? Math.max(price, snap(ref) + t) : Math.min(price, snap(ref) - t);
  };

  const start = (e: ReactPointerEvent, fixed?: keyof Bracket) => {
    if (!onSet) return;
    e.stopPropagation(); e.preventDefault();
    const layer = (e.currentTarget as HTMLElement).closest(".bubble-layer") as HTMLElement | null;
    if (!layer) return;
    const top = layer.getBoundingClientRect().top;
    const y0 = e.clientY; let moved = false;
    let latestDrag: { price: number; key: keyof Bracket } | null = null;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      if (!moved && Math.abs(ev.clientY - y0) < 4) return;
      moved = true;
      const raw = priceOf(Math.max(0, Math.min(H, ev.clientY - top)));
      if (raw == null) return;
      const key = fixed ?? keyFor(snap(raw));
      latestDrag = { price: clampFor(key, snap(raw)), key };
      setDrag(latestDrag);   // a set line stops one tick short of the price
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); window.removeEventListener("pointercancel", up);
      if (!moved) {
        if (ev.type !== "pointerup") return;
        if (fixed) setOpen((o) => (o === fixed ? null : fixed));
        else setDetails(true);   // a tap (not a drag) on your pill shows the trade
        return;
      }
      // Submit once from the pointer event, never from a React state updater.
      if (latestDrag && ev.type === "pointerup") { onSet({ [latestDrag.key]: clampFor(latestDrag.key, latestDrag.price) }); buzz(10); setOpen(null); }
      setDrag(null);
    };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up); window.addEventListener("pointercancel", up);
  };

  const line = (key: keyof Bracket, price: number, live: boolean) => {
    const y = yOf(price); if (!inView(y)) return null;
    const lp = pnlOf(p, price);
    const full = live || open === key;
    return (
      <div key={key + (live ? "-live" : "")} className={`bracket ${key} ${live ? "live" : ""}`} style={{ top: y }} data-testid={`bracket-${key}`}>
        <span className="bracket-tag" onPointerDown={live ? undefined : (e) => start(e, key)} style={{ touchAction: "none" }}
          aria-label={`${key.toUpperCase()} at ${px(price)}, ${signedMoney(lp)}`}>
          {key.toUpperCase()} {full ? <>{px(price)} · <b>{signedMoney(lp)}</b></> : <b>{shortMoney(lp)}</b>}
          {!live && open === key && <button type="button" className="bracket-x" aria-label={`Remove ${key.toUpperCase()}`} onPointerDown={(e) => e.stopPropagation()} onClick={() => { onClear(key); setOpen(null); buzz(8); }}>✕</button>}
        </span>
      </div>
    );
  };

  return (
    <>
      {details && <TradeCard b={{ ...p, state: "open", handle, is_you: true, exit_price: null, pnl: null, reason: null, at: p.opened_at, size_pct: sizePct, dd_floor: null, equity: null }} quote={quote} market={p.market} now={Date.now()} onClose={() => setDetails(false)} />}
      {(["sl", "tp"] as const).map((k) => b[k] != null && !(drag && drag.key === k) ? line(k, b[k]!, false) : null)}
      {drag && line(drag.key, drag.price, true)}
      {pillY !== null && (
        <button type="button" className={`pos-pill ${p.side} ${pnl >= 0 ? "up" : "down"} ${pinned ? "pinned" : ""}`} style={{ top: pillY, left: 4, touchAction: "none" }}
          onPointerDown={(e) => start(e)} data-testid="bracket-grip" data-pinned={pinned ?? undefined}
          aria-label={`Your ${p.side} ${p.quantity} micros at ${px(p.entry_price)}, ${signedMoney(pnl)}${pinned ? `. Entry is ${pinned} the visible chart` : ""}. Tap for details, or drag up or down to set ${p.side === "long" ? "take profit (up) or stop loss (down)" : "stop loss (up) or take profit (down)"}`}>
          <span className="pos-side">{p.side === "long" ? "▲ LONG" : "▼ SHORT"} ×{p.quantity}</span>
          {!drag && quote != null && <b data-testid="pnl-tag">{signedMoney(pnl)}</b>}
          {hedged && <span className="pos-h">H</span>}
          <span aria-hidden="true" className="pos-grip">{pinned === "above" ? "↑" : pinned === "below" ? "↓" : "⇕"}</span>
        </button>
      )}
    </>
  );
}

export function vibeOf(candles: Candle[]): { label: string; color: string } {
  if (candles.length < 6) return { label: "CHOP", color: MUTED };
  let e = candles[0].close; const k = 2 / 21; const emas: number[] = [];
  for (const c of candles) { e = c.close * k + e * (1 - k); emas.push(e); }
  const close = candles[candles.length - 1].close, avg = emas[emas.length - 1], slope = avg - emas[emas.length - 6];
  const closes = candles.map((c) => c.close); const spread = (Math.max(...closes) - Math.min(...closes)) * 0.06;
  if (close > avg + spread && slope > 0) return { label: "PUMPING", color: LIME };
  if (close < avg - spread && slope < 0) return { label: "DUMPING", color: RED };
  return { label: "CHOP", color: MUTED };
}

const tickOf = (price: number) => (price >= 1000 ? 0.25 : price >= 10 ? 0.01 : 0.0001);
const snap = (price: number) => { const t = tickOf(price); return Math.round(price / t) * t; };
const buzz = (ms: number | number[]) => { try { navigator.vibrate?.(ms); } catch { /* */ } };
const shortMoney = (n: number) => `${n >= 0 ? "+" : "−"}$${Math.abs(n) >= 1000 ? (Math.abs(n) / 1000).toFixed(1) + "k" : Math.abs(n).toFixed(0)}`;
