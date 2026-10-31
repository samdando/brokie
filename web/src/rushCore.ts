// Rush mode: pure logic (seeds, daily rules, scoring, storage). No React, no network.
// Rush is scored locally and never touches the season account.
import { MARKETS, type Candle, type Market, type Side } from "./types";

export type RushMarket = Exclude<Market, "prediction">;
export type RushMode = "daily" | "practice" | "challenge";
export interface RushSeed { market: RushMarket; bucket: number; end: number /* epoch minute (exclusive) */; mode: "d" | "p" }

export const RUSH_MARKETS: RushMarket[] = ["nas", "btc", "gold", "eth", "es", "sol", "us30"];
export const FUTURES = new Set<RushMarket>(["gold", "nas", "es", "us30"]);
export const MICROS = 10;
export const CONTEXT_BARS = 40, REVEAL_BARS = 60, FETCH_BARS = CONTEXT_BARS + REVEAL_BARS;
export const BAR_MS = 2000;
const DAY_MIN = 1440, BRISBANE_MS = 10 * 3600_000;

// ---------- seeds
export const encodeSeed = (s: RushSeed) => `${s.market}-${s.bucket}-${s.end.toString(36)}-${s.mode}`;
export function decodeSeed(raw: string | null | undefined, now = Date.now()): RushSeed | null {
  const m = /^(gold|nas|es|us30|btc|eth|sol)-(\d{2,5})-([0-9a-z]{1,9})(?:-([dp]))?$/.exec((raw ?? "").trim().toLowerCase());
  if (!m) return null;
  const bucket = Number(m[2]), end = parseInt(m[3], 36), nowMin = Math.floor(now / 60_000);
  if (bucket % 60 !== 0 || bucket < 60 || bucket > 3600 || !Number.isFinite(end) || end > nowMin + 1 || end < nowMin - 400 * DAY_MIN) return null;
  return { market: m[1] as RushMarket, bucket, end, mode: (m[4] as "d" | "p") ?? "p" };
}
export const seedEndISO = (s: RushSeed) => new Date(s.end * 60_000).toISOString();

/** FNV-1a, then a final avalanche so neighbouring days land far apart. */
export function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return h >>> 0;
}

/** Days since epoch on the Brisbane calendar (UTC+10, no daylight saving). */
export const brisbaneDay = (now = Date.now()) => Math.floor((now + BRISBANE_MS) / 86_400_000);
/** Monday-based week number, for the one-freeze-a-week rule. */
export const weekOf = (day: number) => Math.floor((day + 3) / 7);
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const dayLabel = (day: number) => { const d = new Date(day * 86_400_000); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`; };

/** End minute for a window: futures land in the busy US morning on a weekday (continuous bars,
 *  clear of the 5pm ET break and weekends in both daylight regimes); crypto can be any minute. */
function windowEnd(market: RushMarket, utcDay: number, roll: number): number {
  let day = utcDay;
  if (FUTURES.has(market)) {
    const weekday = (((day + 4) % 7) + 7) % 7;             // 0 = Sunday
    if (weekday === 0) day -= 2; else if (weekday === 6) day -= 1;
    return day * DAY_MIN + 15 * 60 + (roll % 271);           // 15:00–19:30 UTC
  }
  return day * DAY_MIN + (roll % DAY_MIN);
}

/** Today's Daily Rush: identical for every player on the same Brisbane date. `attempt` > 0 only when
 *  the first window has no usable bars (a holiday); every player hits the same data, so the retry agrees too. */
/** First full UTC day of stored 1-minute bars (futures backfilled from 19 Oct 2026, crypto from 26 Oct).
 *  Windows are only drawn from days that exist, and the range grows on its own up to ~38 days back. */
const FIRST_BAR_DAY = { futures: Date.UTC(2026, 9, 20) / 86_400_000, crypto: Date.UTC(2026, 9, 27) / 86_400_000 };
const daysBack = (market: RushMarket, day: number, maxBack: number) =>
  Math.max(1, Math.min(maxBack, day - (FUTURES.has(market) ? FIRST_BAR_DAY.futures : FIRST_BAR_DAY.crypto)));

export function dailySeed(day = brisbaneDay(), attempt = 0): RushSeed {
  const market = attempt < 4 ? RUSH_MARKETS[((day % 7) + 7) % 7] : attempt === 4 ? "btc" : "eth";
  const h = hash(`brokie-rush:${day}:${attempt}`), h2 = hash(`brokie-rush-minute:${day}:${attempt}`);
  const span = Math.max(1, daysBack(market, day, 39) - 1);
  return { market, bucket: 60, end: windowEnd(market, day - (2 + (h % span)), h2), mode: "d" };
}
export const DAILY_ATTEMPTS = 6;
export const isTodaysDaily = (seed: RushSeed, day = brisbaneDay()) =>
  seed.mode === "d" && Array.from({ length: DAILY_ATTEMPTS }, (_, i) => encodeSeed(dailySeed(day, i))).includes(encodeSeed(seed));

export function practiceSeed(rand: () => number = Math.random, now = Date.now()): RushSeed {
  const market = RUSH_MARKETS[Math.floor(rand() * RUSH_MARKETS.length)];
  const today = Math.floor(now / 86_400_000);
  return { market, bucket: 60, end: windowEnd(market, today - 1 - Math.floor(rand() * daysBack(market, today - 1, 39)), Math.floor(rand() * 1e9)), mode: "p" };
}

/** A window is playable when it is full, continuous enough and actually moves. */
export function playable(bars: Candle[], seed: RushSeed): boolean {
  if (bars.length < FETCH_BARS) return false;
  const first = bars[0].index, last = bars[bars.length - 1].index, per = seed.bucket / 60;
  const range = Math.max(...bars.map(b => b.high)) - Math.min(...bars.map(b => b.low));
  return last - first <= (FETCH_BARS + 30) / per && last >= Math.floor(seed.end / per) - 5 && range >= MARKETS[seed.market].tick * 8;
}

export function cleanBars(raw: unknown): Candle[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((b: Record<string, unknown>) => ({ index: Number(b.index), open: Number(b.open), high: Number(b.high), low: Number(b.low), close: Number(b.close) }))
    .filter(b => [b.index, b.open, b.high, b.low, b.close].every(Number.isFinite))
    .map(b => ({ ...b, high: Math.max(b.high, b.open, b.close), low: Math.min(b.low, b.open, b.close) }))
    .sort((a, b) => a.index - b.index);
}

// ---------- price path: open → first extreme → second extreme → close, time split by distance
export function barPath(b: Candle): number[] {
  return b.close >= b.open ? [b.open, b.low, b.high, b.close] : [b.open, b.high, b.low, b.close];
}
/** Price at fraction f (0..1) through the bar, plus the high/low printed so far. */
export function priceAt(b: Candle, f: number): { price: number; high: number; low: number } {
  const p = barPath(b), legs = [0, 1, 2].map(i => Math.abs(p[i + 1] - p[i]) + (b.high - b.low) * 0.08 + 1e-9);
  const total = legs[0] + legs[1] + legs[2];
  let t = Math.max(0, Math.min(1, f)) * total, i = 0;
  while (i < 2 && t > legs[i]) { t -= legs[i]; i++; }
  const k = Math.min(1, t / legs[i]), eased = k < .5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
  const price = p[i] + (p[i + 1] - p[i]) * eased;
  const seen = [...p.slice(0, i + 1), price];
  return { price, high: Math.max(...seen), low: Math.min(...seen) };
}

export const roundTick = (m: RushMarket, price: number) => { const t = MARKETS[m].tick; return Math.round(Math.round(price / t) * t * 1e6) / 1e6; };
export const ridePnl = (m: RushMarket, side: Side, entry: number, exit: number) =>
  Math.round((exit - entry) * (side === "long" ? 1 : -1) * MARKETS[m].pointValue * MICROS * 100) / 100;

// ---------- scoring
export interface Ride { side: Side; entry: number; exit: number; pnl: number; mfe: number /* best favourable move, points */; bars: number /* bars held */; at: number; until: number }
export interface RushResult { total: number; rides: Ride[]; wins: number; losses: number; reads: number; timing: number; best: Ride | null; type: PlayerType }
export interface PlayerType { name: string; line: string }

export function playerType(rides: Ride[], total: number, timing: number): PlayerType {
  const n = rides.length, wins = rides.filter(r => r.pnl > 0).length, losses = rides.filter(r => r.pnl < 0).length;
  const avgBars = n ? rides.reduce((s, r) => s + r.bars, 0) / n : 0, rate = n ? wins / n : 0;
  if (!n) return { name: "Spectator", line: "You watched the whole tape. Next round, hold a half and ride it." };
  if (n <= 3 && rate >= .66) return { name: "Sniper", line: "Few shots, clean hits. Waiting is a skill." };
  if (losses >= 4 && rate < .4) return { name: "Chaser", line: "You went after every wiggle. The tape will still be there next round." };
  if (n >= 8 && avgBars < 4) return { name: "Scalper", line: "In, out, again. Quick hands." };
  if (avgBars >= 10) return { name: "Diamond Hands", line: "You let rides breathe. Patience on display." };
  if (total > 0 && timing >= .5) return { name: "Trend Rider", line: "You caught the move and kept most of it." };
  return { name: "Explorer", line: "A bit of everything. Every round sharpens the read." };
}

export function score(rides: Ride[]): RushResult {
  const total = Math.round(rides.reduce((s, r) => s + r.pnl, 0) * 100) / 100;
  const timing = rides.length ? rides.reduce((s, r) => s + (r.mfe > 0 ? Math.max(0, Math.min(1, ((r.exit - r.entry) * (r.side === "long" ? 1 : -1)) / r.mfe)) : 0), 0) / rides.length : 0;
  const best = rides.length ? rides.reduce((a, b) => (b.pnl > a.pnl ? b : a)) : null;
  return { total, rides, wins: rides.filter(r => r.pnl > 0).length, losses: rides.filter(r => r.pnl <= 0).length,
    reads: rides.filter(r => r.mfe > 0).length, timing, best, type: playerType(rides, total, timing) };
}

// ---------- local storage: personal bests and the daily run / streak
const read = <T,>(key: string, fallback: T): T => { try { const v = localStorage.getItem(key); return v ? { ...fallback, ...JSON.parse(v) } as T : fallback; } catch { return fallback; } };
const write = (key: string, value: unknown) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode: this visit only */ } };

export const BEST_KEY = "brokie.rush.best", DAILY_KEY = "brokie.rush.daily";
export type BestKey = "daily" | "practice";
export const readBest = (): Partial<Record<BestKey, number>> => read(BEST_KEY, {});
/** Saves the score; returns true when it beats the previous best for that mode. */
export function recordBest(mode: BestKey, total: number, rides: number): boolean {
  const best = readBest(), prev = best[mode];
  const isBest = rides > 0 && (prev === undefined ? total > 0 : total > prev);
  if (rides > 0 && (prev === undefined || total > prev)) write(BEST_KEY, { ...best, [mode]: total });
  return isBest;
}

export interface DailyRun { day: number; seed: string; total: number; marks: string /* "WLW" */ }
export interface DailyStore { last?: number; streak: number; freezeWeek?: number; runs: DailyRun[] }
export const readDaily = (): DailyStore => read<DailyStore>(DAILY_KEY, { streak: 0, runs: [] });
export const todaysRun = (day = brisbaneDay()) => readDaily().runs.find(r => r.day === day) ?? null;
export const freezeAvailable = (s: DailyStore, day: number) => s.freezeWeek !== weekOf(day);

/** The streak as it stands today: alive if you played today or yesterday, or the day before with this week's freeze unused. */
export function streakNow(day = brisbaneDay(), s = readDaily()): number {
  if (s.last === undefined) return 0;
  if (s.last === day || s.last === day - 1) return s.streak;
  if (s.last === day - 2 && freezeAvailable(s, day - 1)) return s.streak;
  return 0;
}

/** One scored run per Brisbane day. A single missed day is covered by that week's free freeze. */
export function recordDaily(day: number, seed: string, result: RushResult): DailyStore {
  const s = readDaily();
  if (s.runs.some(r => r.day === day)) return s;
  const gap = s.last === undefined ? Infinity : day - s.last;
  let streak = 1, freezeWeek = s.freezeWeek;
  if (gap === 1) streak = s.streak + 1;
  else if (gap === 2 && freezeAvailable(s, day - 1)) { streak = s.streak + 1; freezeWeek = weekOf(day - 1); }
  const run: DailyRun = { day, seed, total: result.total, marks: result.rides.map(r => (r.pnl > 0 ? "W" : "L")).join("") };
  const next: DailyStore = { last: day, streak, freezeWeek, runs: [...s.runs.filter(r => r.day > day - 30), run] };
  write(DAILY_KEY, next);
  return next;
}

// ---------- sharing
export const fmtMoney = (n: number) => (n >= 0 ? "+" : "−") + "$" + Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: Math.abs(n) >= 100 ? 0 : 2, minimumFractionDigits: Math.abs(n) >= 100 ? 0 : 2 });
export const squares = (marks: string, max = 12) => {
  const s = [...marks].slice(0, max).map(m => (m === "W" ? "🟩" : "🟥")).join("");
  return marks.length > max ? s + "…" : s || "⬜";
};
export function rushLink(seed: string, base = location.origin + location.pathname) {
  const url = new URL(base); url.search = ""; url.hash = ""; url.searchParams.set("rush", seed); return url.href;
}
export function shareText(o: { mode: RushMode; seed: RushSeed; day: number; total: number; marks: string; streak: number }) {
  const head = o.mode === "daily" ? `Brokie Daily Rush · ${dayLabel(o.day)}` : `Brokie Rush · ${MARKETS[o.seed.market].title}`;
  return [head, fmtMoney(o.total), squares(o.marks), o.mode === "daily" && o.streak > 0 ? `🔥${o.streak}` : "Beat that?"].join(" · ");
}
