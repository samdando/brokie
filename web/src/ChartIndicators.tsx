import { useMemo } from "react";
import type { ToXY } from "./Chart";
import type { Candle } from "./types";
import { bollinger, ema, fairValueGaps, IndicatorOptions, structureLevels } from "./indicators";

export function ChartIndicators({ candles, options, seconds, toXY, width, height }: {
  candles: Candle[]; options: IndicatorOptions; seconds: number; toXY: ToXY; width: number; height: number;
}) {
  // The final candle is forming. Every overlay uses closed bars only.
  const data = useMemo(() => {
    const closed = candles.slice(0, -1);
    return {
      fast: options.ema ? ema(closed, 20).filter(p => p.ready).slice(-240) : [],
      slow: options.ema ? ema(closed, 50).filter(p => p.ready).slice(-240) : [],
      bands: options.bands ? bollinger(closed).slice(-240) : [],
      gaps: options.gaps ? fairValueGaps(closed) : [],
      levels: options.structure ? structureLevels(closed) : [],
    };
  }, [candles, options]);
  const point = (index: number, price: number) => toXY(index * seconds, price, true);
  const path = (points: { index: number; value: number }[]) => points.map(p => point(p.index, p.value)).filter((p): p is NonNullable<typeof p> => !!p).map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  return <svg className="indicator-overlay" data-testid="indicator-overlay" width={width} height={height} aria-hidden="true">
    {options.bands && <g data-testid="indicator-bands"><path d={path(data.bands.map(p => ({ index: p.index, value: p.upper })))} className="indicator-band" /><path d={path(data.bands.map(p => ({ index: p.index, value: p.lower })))} className="indicator-band" /><path d={path(data.bands.map(p => ({ index: p.index, value: p.mid })))} className="indicator-band middle" /></g>}
    {options.ema && <g data-testid="indicator-ema"><path d={path(data.fast)} className="indicator-ema fast"/><path d={path(data.slow)} className="indicator-ema slow"/></g>}
    {data.gaps.map(g => {
      const a = point(g.from, g.high), b = point(g.to, g.low); if (!a || !b || b.x < 0 || a.x > width) return null;
      const left = Math.max(0, a.x), right = Math.min(width, b.x + 22), top = Math.max(0, a.y), bottom = Math.min(height, b.y);
      if (bottom <= top || right <= left) return null;
      return <g key={g.from} className={`indicator-gap ${g.side}`} data-testid="indicator-gap"><rect x={left} y={top} width={right - left} height={Math.max(1, bottom - top)} /><text x={right - 4} y={Math.max(10, top - 4)} textAnchor="end">FVG</text></g>;
    })}
    {data.levels.map((level, i) => {
      const a = point(level.from, level.price), b = point(level.to, level.price); if (!a || !b || b.x < 0 || a.x > width || a.y < 14 || a.y > height - 14) return null;
      const left = Math.max(0, a.x), right = Math.min(width - 4, b.x);
      return <g key={i} className={`indicator-level ${level.side} ${level.label === "SWEEP" ? "sweep" : ""}`} data-testid="indicator-structure"><path d={`M${left},${a.y + (level.side === "bull" ? 4 : -4)} V${a.y} H${right}`} /><text x={Math.max(24, Math.min(width - 24, (left + right) / 2))} y={a.y - 5} textAnchor="middle">{level.label}</text></g>;
    })}
  </svg>;
}

export const INDICATOR_ITEMS: { key: keyof IndicatorOptions; name: string; detail: string; color: string }[] = [
  { key: "ema", name: "Moving averages", detail: "EMA 20 + 50 · direction and momentum", color: "#c1a9ff" },
  { key: "structure", name: "Market structure", detail: "BOS, CHoCH + liquidity sweeps", color: "#9dafff" },
  { key: "gaps", name: "Fair value gaps", detail: "Unfilled three-candle price imbalances", color: "#e6949a" },
  { key: "bands", name: "Bollinger bands", detail: "20-bar mean · two standard deviations", color: "#90b9d8" },
  { key: "patterns", name: "Candle patterns", detail: "Engulfing, hammer, shooting star + doji", color: "#ff945c" },
];
