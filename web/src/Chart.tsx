import { PointerEvent as ReactPointerEvent, ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { createChart, ColorType, CrosshairMode, IChartApi, ISeriesApi, LineStyle, UTCTimestamp, IPriceLine, MouseEventParams } from "lightweight-charts";
import type { Candle, Market, Position } from "./types";
import { MARKETS, direction, pnlOf } from "./types";
import { TradeMarker, useFreshIds } from "./Bubbles";
import type { Bracket } from "./game";
import { px, signedMoney } from "./ui";

const LIME = "#D6FE59", RED = "#FF7D8B", MUTED = "#969D8D";
const H = 256;            // chart height in px (includes the time axis)
const VIEW_BARS = 60;     // bars shown when snapped to live
const ANIM_MS = 450;      // forming-candle tween (C4)

/** The Brokie chart: candles or line with a time axis, squad trade markers, and your positions (hedges show both). */
export type ToXY = (unixSeconds: number, price: number) => { x: number; y: number; clamped: boolean } | null;

type Bar = { time: UTCTimestamp; open: number; high: number; low: number; close: number };
interface Hover { o: number; h: number; l: number; c: number; time: number; price: number | null }

export function BrokieChart({ market, candles, bucketSeconds, quote, positions, style, overlay, sizePctOf, brackets, onBracket, onClearBracket, handle = "?" }:
  { handle?: string; market: Market; candles: Candle[]; bucketSeconds: number; quote: number | null; positions: Position[]; style: "candles" | "line";
    overlay?: (toXY: ToXY, width: number) => ReactNode; equity?: number; sizePctOf?: (p: Position) => number | null;
    brackets?: Record<string, Bracket>; onBracket?: (id: string, b: Bracket) => void; onClearBracket?: (id: string, key: keyof Bracket) => void }) {
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

  // Your own fills that arrived after the first load get the coin-flip entry.
  const fresh = useFreshIds(positions.map((p) => p.id));
  const hedged = mine.some((p) => p.side === "long") && mine.some((p) => p.side === "short");

  useEffect(() => {
    if (!host.current) return;
    const c = createChart(host.current, {
      height: H,
      // TradingView attribution lives in the chart card footer (Trade.tsx), not over the candles.
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: MUTED, fontSize: 9, fontFamily: "ui-monospace, Menlo, monospace", attributionLogo: false },
      grid: { vertLines: { visible: false }, horzLines: { color: "rgba(255,255,255,.045)", style: LineStyle.Solid } },
      rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.12, bottom: 0.08 } },
      timeScale: { borderVisible: false, visible: true, timeVisible: true, secondsVisible: false, rightOffset: 6, minBarSpacing: 2, fixLeftEdge: false,
        tickMarkFormatter: (t: number) => { const d = new Date(t * 1000); return d.getHours() === 0 && d.getMinutes() === 0 ? d.toLocaleDateString([], { day: "numeric", month: "short" }) : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); } },
      // C5: on touch, a long-press enters crosshair tracking; the next tap exits it.
      crosshair: { mode: CrosshairMode.Normal, vertLine: { color: "rgba(255,255,255,.35)", labelVisible: true, labelBackgroundColor: "#2C3028" }, horzLine: { color: "rgba(255,255,255,.25)", labelBackgroundColor: "#2C3028" } },
      // Bar times are UTC seconds; show them in the player's own time zone.
      localization: { locale: "en-US", timeFormatter: (t: number) => new Date(t * 1000).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) },
      // C5: pinch / wheel zoom and horizontal drag to pan. Vertical swipes still scroll the page.
      handleScale: { pinch: true, mouseWheel: true, axisPressedMouseMove: false, axisDoubleClickReset: false },
      handleScroll: { horzTouchDrag: true, pressedMouseMove: true, mouseWheel: false, vertTouchDrag: false },
      kineticScroll: { touch: true, mouse: false },
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
        setAway(!!r && countRef.current > 0 && r.to < countRef.current - 1);
        setFrame((f) => f + 1);
      });
    };
    requestFrame.current = refreshOverlay;
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
      ro.disconnect();
      c.unsubscribeCrosshairMove(onCross);
      c.timeScale().unsubscribeVisibleLogicalRangeChange(refreshOverlay);
      cancelAnimationFrame(animationFrame);
      cancelAnimationFrame(anim.current);
      requestFrame.current = () => {};
      c.remove(); chart.current = null; series.current = null; quoteLine.current = null; lines.current = [];
    };
  }, []);

  /** Snap the view back to the newest bars (double-tap / Live button). */
  const goLive = useCallback(() => {
    const c = chart.current; const n = countRef.current;
    if (!c || !n) return;
    userMoved.current = false;
    // An explicit range (not fitContent) so pinch/wheel zoom still works on short histories.
    c.timeScale().setVisibleLogicalRange({ from: Math.max(0, n - VIEW_BARS), to: n - 1 + 6 });
    c.priceScale("right").applyOptions({ autoScale: true });
  }, []);

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
    if (quote) quoteLine.current = target.createPriceLine({ price: quote, color: tickColor.current, lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: true, axisLabelTextColor: "#0C0E0B", title: "" });
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
      lines.current.push(target.createPriceLine({ price: p.entry_price, color: (p.side === "long" ? LIME : RED) + "88", lineWidth: 1, lineStyle: LineStyle.Solid, axisLabelVisible: false, title: "" }));
    }
    requestFrame.current();
  }, [positions, market, style]);

  const series_ = () => { const s = series.current; return s ? (style === "candles" ? s.candle : s.area) : null; };
  const yOf = (price: number) => { const y = series_()?.priceToCoordinate(price); return y == null ? null : y; };

  const priceOf = (y: number) => { const v = series_()?.coordinateToPrice(y); return v == null ? null : Number(v); };

  const toXY: ToXY = (secs, price) => {
    const c = chart.current;
    if (!c || !series_() || !candles.length || !Number.isFinite(secs) || !Number.isFinite(price)) return null;
    const y = yOf(price);
    if (y === null || y < 0 || y > H) return null;
    const bucket = Math.floor(secs / bucketSeconds);
    const index = candles.findIndex((bar) => bar.index === bucket);
    // Never move an old trade onto the first visible candle or bridge missing
    // history. Its position card remains available outside this chart window.
    if (index < 0) return null;
    const fraction = (secs - bucket * bucketSeconds) / bucketSeconds;
    // logicalToCoordinate() returns 0 while the time axis is hidden (same reason the plot width is
    // measured by hand), which pinned every bubble to the left edge. Map the visible logical range
    // onto the measured plot width instead.
    const r = c.timeScale().getVisibleLogicalRange();
    if (!r || r.to <= r.from) return null;
    const barW = plotRef.current / (r.to - r.from);
    const x = (index + fraction - r.from) * barW - barW / 2;
    if (x === null || x < 0 || x > plotRef.current) return null;
    return { x, y, clamped: false };
  };

  // Crosshair readout distance from your (first) entry in this market.
  const ref = mine[0];
  const dist = hover?.price != null && ref ? (hover.price - ref.entry_price) * direction(ref.side) : null;

  return (
    <div>
      <div className="chart-host" style={{ position: "relative", width: "100%", height: H, touchAction: "pan-y" }}
        onDoubleClick={() => { lastTap.current = null; goLive(); }}
        onWheel={() => { userMoved.current = true; }}
        onPointerDown={(e) => {
          if (e.pointerType !== "touch") { userMoved.current = true; return; }
          if (touches.current.size === 0) gestureDirty.current = false;
          touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY, t: performance.now() });
          if (touches.current.size > 1) { gestureDirty.current = true; userMoved.current = true; lastTap.current = null; }
        }}
        onPointerMove={(e) => {
          const s = touches.current.get(e.pointerId);
          if (s && Math.hypot(e.clientX - s.x, e.clientY - s.y) > 10) { gestureDirty.current = true; userMoved.current = true; }
        }}
        onPointerCancel={(e) => { touches.current.delete(e.pointerId); gestureDirty.current = true; }}
        onPointerUp={(e) => {
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
          {overlay?.(toXY, plotWidth)}
          {hedged && <span className="hedge-pill" data-testid="my-hedged">HEDGED</span>}
          {mine.map((p, i) => <MyPosition key={p.id} p={p} slot={i} handle={handle} quote={quote} toXY={toXY} yOf={yOf} priceOf={priceOf} width={plotWidth}
            sizePct={sizePctOf?.(p) ?? null} fresh={fresh.has(p.id)} hedged={hedged} b={brackets?.[p.id] ?? {}}
            onSet={onBracket && ((b) => onBracket(p.id, b))} onClear={(k) => onClearBracket?.(p.id, k)} />)}
        </div>}
        {(() => {
          // pump.fun-style legend: O/H/L/C of the hovered bar (or the live one) and its change.
          const last = candles[candles.length - 1];
          const bar = hover ?? (last ? { o: last.open, h: last.high, l: last.low, c: last.close, time: 0, price: null } : null);
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


/** One of your positions: your marker at the fill (like everyone else's), and a pill on the entry
 *  line at the right edge with size and live P&L. The pill is the SL/TP handle (ticket 14): drag it
 *  up or down. For a long, up is TP and down is SL; a short is the reverse. Set lines show
 *  "SL −$305"; tap one for its price and ✕, or drag it again. */
function MyPosition({ p, slot, handle, quote, toXY, yOf, priceOf, width, sizePct, fresh, hedged, b, onSet, onClear }:
  { p: Position; slot: number; handle: string; quote: number | null; toXY: ToXY; yOf: (price: number) => number | null; priceOf: (y: number) => number | null;
    width: number; sizePct: number | null; fresh: boolean; hedged: boolean; b: Bracket; onSet?: (b: Bracket) => void; onClear: (k: keyof Bracket) => void }) {
  const [drag, setDrag] = useState<{ price: number; key: keyof Bracket } | null>(null);
  const [open, setOpen] = useState<keyof Bracket | null>(null);
  const entryY = yOf(p.entry_price);
  const at = toXY(Date.parse(p.opened_at) / 1000, p.entry_price);
  const inView = (v: number | null): v is number => v !== null && v >= 0 && v <= H;
  const pnl = quote != null ? pnlOf(p, quote) : 0;
  const keyFor = (price: number): keyof Bracket => ((price > p.entry_price) === (p.side === "long") ? "tp" : "sl");

  const start = (e: ReactPointerEvent, fixed?: keyof Bracket) => {
    if (!onSet) return;
    e.stopPropagation(); e.preventDefault();
    const layer = (e.currentTarget as HTMLElement).closest(".bubble-layer") as HTMLElement | null;
    if (!layer) return;
    const top = layer.getBoundingClientRect().top;
    const y0 = e.clientY; let moved = false;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      if (!moved && Math.abs(ev.clientY - y0) < 4) return;
      moved = true;
      const raw = priceOf(Math.max(0, Math.min(H, ev.clientY - top)));
      if (raw == null) return;
      const price = snap(raw);
      if (fixed && keyFor(price) !== fixed) return; // a set line can't cross the entry
      setDrag({ price, key: fixed ?? keyFor(price) });
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); window.removeEventListener("pointercancel", up);
      if (!moved) { if (fixed && ev.type === "pointerup") setOpen((o) => (o === fixed ? null : fixed)); return; }
      setDrag((dr) => {
        if (dr && Math.abs(dr.price - p.entry_price) >= tickOf(p.entry_price) && ev.type === "pointerup") { onSet({ [dr.key]: dr.price }); buzz(10); setOpen(null); }
        return null;
      });
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
      {at && inView(at.y) && <TradeMarker handle={handle} long={p.side === "long"} me fresh={fresh} style={{ left: at.x, top: at.y, pointerEvents: "none" }}
        testId="my-bubble" label={`Your ${p.side} ${p.quantity} micros at ${px(p.entry_price)}`} />}
      {(["sl", "tp"] as const).map((k) => b[k] != null && !(drag && drag.key === k) ? line(k, b[k]!, false) : null)}
      {drag && line(drag.key, drag.price, true)}
      {inView(entryY) && (
        <button type="button" className={`pos-pill ${p.side} ${pnl >= 0 ? "up" : "down"}`} style={{ top: entryY, left: 4, marginTop: slot * 22, touchAction: "none" }}
          onPointerDown={(e) => start(e)} data-testid="bracket-grip"
          aria-label={`Your ${p.side} ${p.quantity} micros at ${px(p.entry_price)}, ${signedMoney(pnl)}. Drag up or down to set ${p.side === "long" ? "take profit (up) or stop loss (down)" : "stop loss (up) or take profit (down)"}`}>
          <span className="pos-side">{p.side === "long" ? "L" : "S"}{p.quantity}</span>
          {!drag && quote != null && <b data-testid="pnl-tag">{signedMoney(pnl)}</b>}
          {hedged && <span className="pos-h">H</span>}
          <span aria-hidden="true" className="pos-grip">⇕</span>
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
