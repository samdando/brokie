import type { Candle } from "./types";

export interface IndicatorOptions { ema: boolean; bands: boolean; structure: boolean; gaps: boolean; patterns: boolean }
export const DEFAULT_INDICATORS: IndicatorOptions = { ema: true, bands: false, structure: true, gaps: true, patterns: true };
export const INDICATOR_KEY = "brokie.indicators.v1";
export function readIndicators(): IndicatorOptions {
  try {
    const value = JSON.parse(localStorage.getItem(INDICATOR_KEY) ?? "{}");
    return Object.fromEntries(Object.entries(DEFAULT_INDICATORS).map(([key, fallback]) => [key, typeof value?.[key] === "boolean" ? value[key] : fallback])) as unknown as IndicatorOptions;
  } catch { return { ...DEFAULT_INDICATORS }; }
}
export function saveIndicators(options: IndicatorOptions) { try { localStorage.setItem(INDICATOR_KEY, JSON.stringify(options)); } catch { /* Preferences stay active for this visit. */ } }
export function ema(candles: Candle[], period: number) {
  let average = candles[0]?.close ?? 0;
  return candles.map((c, i) => { average += (c.close - average) * 2 / (period + 1); return { index: c.index, value: average, ready: i >= period - 1 }; });
}
export function bollinger(candles: Candle[], period = 20) {
  return candles.flatMap((c, i) => {
    if (i < period - 1) return [];
    const window = candles.slice(i - period + 1, i + 1), mid = window.reduce((sum, bar) => sum + bar.close, 0) / period;
    const deviation = Math.sqrt(window.reduce((sum, bar) => sum + (bar.close - mid) ** 2, 0) / period);
    return [{ index: c.index, mid, upper: mid + deviation * 2, lower: mid - deviation * 2 }];
  });
}
export interface StructureLevel { from: number; to: number; price: number; side: "bull" | "bear"; label: "BOS" | "CHoCH" | "SWEEP" }
export interface Gap { from: number; to: number; high: number; low: number; side: "bull" | "bear" }
export function structureLevels(closed: Candle[]): StructureLevel[] {
  const levels: StructureLevel[] = [];
  let swingHigh: Candle | undefined, swingLow: Candle | undefined, bias = 0;
  for (let i = 4; i < closed.length; i++) {
    // A pivot is only available after two later candles have closed.
    const pivot = closed[i - 2], neighbours = [closed[i - 4], closed[i - 3], closed[i - 1], closed[i]];
    if (neighbours.every(c => pivot.high > c.high)) swingHigh = pivot;
    if (neighbours.every(c => pivot.low < c.low)) swingLow = pivot;
    const bar = closed[i];
    if (swingHigh && bar.close > swingHigh.high) {
      levels.push({ from: swingHigh.index, to: bar.index, price: swingHigh.high, side: "bull", label: bias < 0 ? "CHoCH" : "BOS" });
      swingHigh = undefined; bias = 1;
    } else if (swingHigh && bar.high > swingHigh.high && bar.close < swingHigh.high) {
      levels.push({ from: swingHigh.index, to: bar.index, price: swingHigh.high, side: "bear", label: "SWEEP" }); swingHigh = undefined;
    }
    if (swingLow && bar.close < swingLow.low) {
      levels.push({ from: swingLow.index, to: bar.index, price: swingLow.low, side: "bear", label: bias > 0 ? "CHoCH" : "BOS" });
      swingLow = undefined; bias = -1;
    } else if (swingLow && bar.low < swingLow.low && bar.close > swingLow.low) {
      levels.push({ from: swingLow.index, to: bar.index, price: swingLow.low, side: "bull", label: "SWEEP" }); swingLow = undefined;
    }
  }
  return levels.slice(-12);
}
export function fairValueGaps(closed: Candle[]): Gap[] {
  const gaps: Gap[] = [];
  for (let i = Math.max(2, closed.length - 90); i < closed.length; i++) {
    const a = closed[i - 2], c = closed[i];
    // Avoid declaring gaps across missing buckets or session boundaries.
    if (closed[i - 1].index !== a.index + 1 || c.index !== a.index + 2) continue;
    const bull = c.low > a.high, bear = c.high < a.low;
    if (!bull && !bear) continue;
    const low = bull ? a.high : c.high, high = bull ? c.low : a.low;
    const later = closed.slice(i + 1);
    if (later.some(bar => bull ? bar.low <= low : bar.high >= high)) continue;
    gaps.push({ from: a.index, to: closed[closed.length - 1].index, high, low, side: bull ? "bull" : "bear" });
  }
  return gaps.slice(-4);
}
export interface CandleRead { name: string; side: "bull" | "bear" | "neutral"; description: string; index: number }
export function candleRead(closed: Candle[]): CandleRead | null {
  const c = closed[closed.length - 1], p = closed[closed.length - 2];
  if (!c || !p || c.index !== p.index + 1) return null;
  const range = c.high - c.low, body = Math.abs(c.close - c.open);
  if (range <= 0) return null;
  const lower = Math.min(c.open, c.close) - c.low, upper = c.high - Math.max(c.open, c.close);
  const result = (name: string, side: CandleRead["side"], description: string) => ({ name, side, description, index: c.index });
  if (c.close > c.open && p.close < p.open && c.open <= p.close && c.close >= p.open && body > Math.abs(p.open - p.close))
    return result("Bullish engulfing", "bull", "The last closed bullish body engulfs the prior bearish body.");
  if (c.close < c.open && p.close > p.open && c.open >= p.close && c.close <= p.open && body > Math.abs(p.open - p.close))
    return result("Bearish engulfing", "bear", "The last closed bearish body engulfs the prior bullish body.");
  const prior = closed.slice(-6, -1), trend = prior.length >= 4 ? p.close - prior[0].open : 0;
  if (body > range * .05 && body < range * .35 && lower >= body * 2 && upper <= range * .15 && trend < 0)
    return result("Hammer", "bull", "A small body and long lower wick after a decline. Confirmation still matters.");
  if (body > range * .05 && body < range * .35 && upper >= body * 2 && lower <= range * .15 && trend > 0)
    return result("Shooting star", "bear", "A small body and long upper wick after a climb. Confirmation still matters.");
  if (body <= range * .08) return result("Doji", "neutral", "Open and close are close together: indecision on the last closed candle.");
  return null;
}
