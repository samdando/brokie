import type { Market } from "./types";
const ny = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" });
function localParts(at: number) {
  const parts = Object.fromEntries(ny.formatToParts(at).map(p => [p.type, p.value]));
  const date = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)));
  return { date, day: date.getUTCDay(), hour: Number(parts.hour) };
}
export function weekendMode(at: number) {
  const { day, hour } = localParts(at);
  return day === 6 || (day === 5 && hour >= 17) || (day === 0 && hour < 18);
}
export const isCrypto = (m: Market) => ["btc", "eth", "sol"].includes(m);
export function marketSessionOpen(m: Market, at: number) {
  const { hour } = localParts(at);
  return isCrypto(m) ? weekendMode(at) : !weekendMode(at) && (hour < 17 || hour >= 18);
}
export const FUTURES: Market[] = ["gold", "nas", "es", "us30"];
export const CRYPTOS: Market[] = ["btc", "eth", "sol"];
export const sessionMarkets = (at: number): Market[] => [...(weekendMode(at) ? CRYPTOS : FUTURES)];
export function tradingDay(at: number) {
  const { date, hour } = localParts(at);
  if (hour >= 17) date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}
export function shiftDay(day: string, offset: number) {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

export interface SessionEvent { id: string; label: string; at: number; kind: "open" | "close"; zone: string }
const formatters = new Map<string, Intl.DateTimeFormat>();
function zoned(at: number, zone: string) {
  let fmt = formatters.get(zone);
  if (!fmt) { fmt = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }); formatters.set(zone, fmt); }
  const p = Object.fromEntries(fmt.formatToParts(at).map(p => [p.type, p.value]));
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour, min: +p.minute, sec: +p.second };
}
/** Resolve the date in its own zone; offsets are recalculated across DST, never hardcoded. */
export function nextZonedEvent(now: number, zone: string, hour: number, minute: number, days: number[]): number {
  const p = zoned(now, zone);
  for (let offset = 0; offset < 9; offset++) {
    const date = new Date(Date.UTC(p.y, p.m - 1, p.d + offset));
    if (!days.includes(date.getUTCDay())) continue;
    const target = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), hour, minute);
    let candidate = target;
    for (let i = 0; i < 3; i++) { const q = zoned(candidate, zone); candidate += target - Date.UTC(q.y, q.m - 1, q.d, q.h, q.min, q.sec); }
    if (candidate > now) return candidate;
  }
  return now + 7 * 86400000;
}
const weekdays = [1, 2, 3, 4, 5];
/** Reference liquidity-session opens, not exchange holiday calendars or an execution guarantee. */
export function sessionEvents(now: number, market: Market): SessionEvent[] {
  const sessions: [string, string, number][] = [["Sydney", "Australia/Sydney", 8], ["Tokyo", "Asia/Tokyo", 9], ["London", "Europe/London", 8], ["New York", "America/New_York", 8]];
  const events: SessionEvent[] = sessions.map(([label, zone, hour]) => ({ id: label, label: `${label} opens`, zone, kind: "open", at: nextZonedEvent(now, zone, hour, 0, weekdays) }));
  events.unshift({ id: "close", label: isCrypto(market) ? "Crypto weekend ends" : "Market close", kind: "close", zone: "America/New_York", at: nextZonedEvent(now, "America/New_York", isCrypto(market) ? 18 : 17, 0, isCrypto(market) ? [0] : weekdays) });
  events.push({ id: "resume", label: "Charts reopen", kind: "open", zone: "America/New_York", at: nextZonedEvent(now, "America/New_York", 18, 0, [0, 1, 2, 3, 4]) });
  return events;
}
export function sessionCountdown(ms: number) {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(seconds / 3600), m = Math.floor(seconds / 60) % 60, s = seconds % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
