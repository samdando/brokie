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
export const sessionMarkets = (at: number): Market[] => weekendMode(at) ? ["btc", "eth", "sol"] : ["gold", "nas", "es", "us30"];
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
