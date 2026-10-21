import { ReactNode, useEffect, useRef, useState } from "react";
import { createChart, ColorType, CrosshairMode, IChartApi, ISeriesApi, LineStyle, UTCTimestamp, IPriceLine, Logical } from "lightweight-charts";
import type { Candle, Market, Position } from "./types";
import { MARKETS } from "./types";

const LIME = "#D6FE59", RED = "#FF7D8B", LINE = "#2C3028", MUTED = "#969D8D";

/** The Brokie chart: candles or line, a quiet 20-bar average, your entry lines. */
export type ToXY = (unixSeconds: number, price: number) => { x: number; y: number; clamped: boolean } | null;

export function BrokieChart({ market, candles, bucketSeconds, quote, positions, style, overlay }:
  { market: Market; candles: Candle[]; bucketSeconds: number; quote: number | null; positions: Position[]; style: "candles" | "line";
    overlay?: (toXY: ToXY, width: number) => ReactNode }) {
  const [, setFrame] = useState(0);
  const [plotWidth, setPlotWidth] = useState(0);
  const host = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const series = useRef<{ candle: ISeriesApi<"Candlestick">; area: ISeriesApi<"Area">; ema: ISeriesApi<"Line"> } | null>(null);
  const lines = useRef<IPriceLine[]>([]);
  const lastKey = useRef("");
  const lastCount = useRef(0);
  const requestFrame = useRef<() => void>(() => {});
  const plotRef = useRef(0);

  useEffect(() => {
    if (!host.current) return;
    const c = createChart(host.current, {
      height: 236,
      // A linked TradingView attribution remains in the visible chart footer.
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: MUTED, fontSize: 9, fontFamily: "ui-monospace, Menlo, monospace", attributionLogo: false },
      grid: { vertLines: { visible: false }, horzLines: { color: LINE, style: LineStyle.Dashed } },
      rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.12, bottom: 0.08 } },
      timeScale: { borderVisible: false, visible: false, rightOffset: 6, fixLeftEdge: false },
      crosshair: { mode: CrosshairMode.Magnet, vertLine: { color: "rgba(255,255,255,.35)", labelVisible: false }, horzLine: { color: "rgba(255,255,255,.2)" } },
      localization: { locale: "en-US" },
      handleScale: false,
      handleScroll: false,
    });
    const candle = c.addCandlestickSeries({ upColor: LIME, downColor: RED, wickUpColor: LIME, wickDownColor: RED, borderVisible: false, priceLineVisible: false, lastValueVisible: false });
    const area = c.addAreaSeries({ lineWidth: 2, priceLineVisible: false, lastValueVisible: false });
    const ema = c.addLineSeries({ color: "rgba(255,255,255,.28)", lineWidth: 1, lineStyle: LineStyle.Dashed, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
    chart.current = c;
    series.current = { candle, area, ema };
    let animationFrame = 0;
    const refreshOverlay = () => {
      cancelAnimationFrame(animationFrame);
      animationFrame = requestAnimationFrame(() => {
        // timeScale().width() is 0 while the time axis is hidden, so measure the plot directly:
        // chart width minus the price-axis labels.
        const w = Math.max(0, (host.current?.clientWidth ?? 0) - c.priceScale("right").width());
        plotRef.current = w;
        setPlotWidth(w);
        setFrame((f) => f + 1);
      });
    };
    requestFrame.current = refreshOverlay;
    const ro = new ResizeObserver(() => { c.applyOptions({ width: host.current?.clientWidth ?? 300 }); refreshOverlay(); });
    ro.observe(host.current);
    c.timeScale().subscribeVisibleLogicalRangeChange(refreshOverlay);
    refreshOverlay();
    return () => {
      ro.disconnect();
      c.timeScale().unsubscribeVisibleLogicalRangeChange(refreshOverlay);
      cancelAnimationFrame(animationFrame);
      requestFrame.current = () => {};
      c.remove(); chart.current = null; series.current = null;
    };
  }, []);

  useEffect(() => {
    const s = series.current;
    if (!s) return;
    const color = MARKETS[market].color;
    s.area.applyOptions({ lineColor: color, topColor: color + "38", bottomColor: color + "00", visible: style === "line" });
    s.candle.applyOptions({ visible: style === "candles" });
    const t = (i: number) => (i * bucketSeconds) as UTCTimestamp;
    s.candle.setData(candles.map((c) => ({ time: t(c.index), open: c.open, high: c.high, low: c.low, close: c.close })));
    s.area.setData(candles.map((c) => ({ time: t(c.index), value: c.close })));
    let e = candles[0]?.close ?? 0; const k = 2 / 21;
    s.ema.setData(candles.map((c) => { e = c.close * k + e * (1 - k); return { time: t(c.index), value: e }; }));
    const key = `${market}-${bucketSeconds}-${style}`;
    // Re-fit when the view changes or a batch of history arrives (not on every tick).
    if (key !== lastKey.current || Math.abs(candles.length - lastCount.current) > 2) {
      chart.current?.timeScale().fitContent();
      lastKey.current = key;
    }
    lastCount.current = candles.length;

    const target = style === "candles" ? s.candle : s.area;
    for (const l of lines.current) { try { s.candle.removePriceLine(l); } catch { /* */ } try { s.area.removePriceLine(l); } catch { /* */ } }
    lines.current = [];
    if (quote) {
      lines.current.push(target.createPriceLine({ price: quote, color, lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: true, title: "" }));
    }
    for (const p of positions.filter((p) => p.market === market)) {
      lines.current.push(target.createPriceLine({
        price: p.entry_price, color: p.side === "long" ? LIME : RED, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: false,
        title: `${p.side.toUpperCase()} ${p.quantity}`,
      }));
    }
    requestFrame.current();
  }, [candles, bucketSeconds, quote, positions, market, style]);

  const toXY: ToXY = (secs, price) => {
    const c = chart.current, s = series.current;
    if (!c || !s || !candles.length || !Number.isFinite(secs) || !Number.isFinite(price)) return null;
    const target = style === "candles" ? s.candle : s.area;
    const y = target.priceToCoordinate(price);
    if (y === null || y < 0 || y > 236) return null;
    const bucket = Math.floor(secs / bucketSeconds);
    const index = candles.findIndex((bar) => bar.index === bucket);
    // Never move an old trade onto the first visible candle or bridge missing
    // history. Its position card remains available outside this chart window.
    if (index < 0) return null;
    const fraction = (secs - bucket * bucketSeconds) / bucketSeconds;
    const x = c.timeScale().logicalToCoordinate((index + fraction) as Logical);
    if (x === null || x < 0 || x > plotRef.current) return null;
    return { x, y, clamped: false };
  };

  return (
    <div style={{ position: "relative", width: "100%", height: 236 }}>
      <div ref={host} style={{ width: "100%", height: 236 }} aria-label={`${MARKETS[market].title} price chart`} />
      {overlay && plotWidth > 0 && <div className="bubble-layer" style={{ width: plotWidth, right: "auto" }}>{overlay(toXY, plotWidth)}</div>}
    </div>
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
