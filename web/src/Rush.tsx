// Rush: short replay rounds on real historical candles. Hold the top half to ride long, the bottom
// half to ride short, let go to cash out. Scored locally — never touches the season account.
import { useEffect, useReducer, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { game } from "./game";
import { BackendError } from "./api";
import { haptic } from "./effects";
import { px } from "./ui";
import { MARKETS, digits, type Candle, type Side } from "./types";
import {
  BAR_MS, CONTEXT_BARS, DAILY_ATTEMPTS, FETCH_BARS, MICROS, REVEAL_BARS, brisbaneDay, cleanBars, dailySeed, dayLabel, decodeSeed,
  encodeSeed, fmtMoney, freezeAvailable, isTodaysDaily, playable, practiceSeed, priceAt, readBest, readDaily, recordBest, recordDaily,
  ridePnl, roundTick, rushLink, score, seedEndISO, shareText, squares, streakNow, todaysRun,
  type Ride, type RushMode, type RushResult, type RushSeed,
} from "./rushCore";
import "./rush.css";

// ---------- open/close store (so any screen can launch Rush)
export interface RushOptions { mode?: "daily" | "practice"; seed?: string }
type Store = { open: (RushOptions & { n: number }) | null; version: number };
let store: Store = { open: null, version: 0 };
const listeners = new Set<() => void>();
const emit = (next: Partial<Store>) => { store = { ...store, ...next }; listeners.forEach(l => l()); };
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
/** Opens Rush as a full-screen overlay. With no options: today's Daily Rush if it's still to play, else practice. */
export function openRush(opts: RushOptions = {}) { emit({ open: { ...opts, n: (store.open?.n ?? 0) + 1 } }); }
export function closeRush() { emit({ open: null }); }
export const useRushStore = () => useSyncExternalStore(subscribe, () => store);

/** Mount once inside the app: renders the overlay above tabs, toasts and sheets while open. */
export function RushHost() {
  const { open } = useRushStore();
  if (!open) return null;
  return createPortal(<RushOverlay key={open.n} start={open.seed ? { kind: "seed", seed: open.seed } : { kind: open.mode ?? "auto" }} onClose={closeRush} />, document.body);
}

/** `?rush=<seed>` — a challenge link. Works without an account: candles come through the public (anon) API. */
export function RushPage({ seed }: { seed: string }) {
  const home = () => { location.href = location.pathname; };
  return <RushOverlay start={{ kind: "seed", seed }} guest onClose={home} />;
}

// ---------- data
type Caller = (name: string, params: Record<string, unknown>) => Promise<unknown>;
const callerFor = (guest: boolean): Caller => guest
  ? (name, params) => (game.api.publicRPC as unknown as Caller).call(game.api, name, params)
  : (name, params) => game.api.rpc(name, params);

interface Loaded { seed: RushSeed; bars: Candle[]; fallback: boolean }
async function fetchBars(call: Caller, seed: RushSeed): Promise<Loaded> {
  try {
    const raw = await call("rush_candles", { p_market: seed.market, p_bucket_seconds: seed.bucket, p_end: seedEndISO(seed), p_limit: FETCH_BARS });
    return { seed, bars: cleanBars(raw), fallback: false };
  } catch (e) {
    if (e instanceof BackendError && (e.code === "network" || e.code === "timeout")) throw e;
    // rush_candles not deployed yet: play the latest bars so Rush still works (not reproducible).
    const raw = await call("candles", { p_market: seed.market, p_bucket_seconds: seed.bucket, p_limit: FETCH_BARS });
    return { seed, bars: cleanBars(raw), fallback: true };
  }
}
async function pickRound(call: Caller, kind: "daily" | "practice", day: number): Promise<Loaded> {
  let spare: Loaded | null = null;
  for (let i = 0; i < DAILY_ATTEMPTS; i++) {
    const seed = kind === "daily" ? dailySeed(day, i) : practiceSeed();
    const r = await fetchBars(call, seed);
    if (r.fallback || playable(r.bars, seed)) return r;
    if (!spare && r.bars.length >= 30) spare = r;
  }
  if (spare) return spare;
  throw new Error("No candles for that window right now. Try again in a moment.");
}

function speed(): number {
  const w = (window as { __rushSpeed?: number }).__rushSpeed;
  const q = Number(new URLSearchParams(location.search).get("rushspeed"));
  const s = Number.isFinite(w) && w ? w : Number.isFinite(q) && q > 0 ? q : 1;
  return Math.max(import.meta.env.DEV ? .25 : 1, Math.min(60, s));   // test speed-up; never slower than real in production
}

// ---------- overlay
type Start = { kind: "auto" | "daily" | "practice" } | { kind: "seed"; seed: string };
type Phase = "loading" | "error" | "ready" | "live" | "done";
interface Round extends Loaded { mode: RushMode; context: number; reveal: number; text: string; day: number; avgRange: number }
interface LiveRide { side: Side; entry: number; mfe: number; at: number; from: number; pointer: number }
interface Engine { t: number; countdown: number; last: number; price: number; ride: LiveRide | null; rides: Ride[]; lo: number; hi: number; pop: { pnl: number; key: number } | null }
interface Finished { result: RushResult; newBest: boolean; streak: number; freeze: boolean; text: string }
const COUNTDOWN_MS = 3000;
const newEngine = (): Engine => ({ t: 0, countdown: COUNTDOWN_MS, last: 0, price: 0, ride: null, rides: [], lo: 0, hi: 0, pop: null });

export function RushOverlay({ start, guest = false, onClose }: { start: Start; guest?: boolean; onClose: () => void }) {
  const [request, setRequest] = useState<{ start: Start; n: number }>({ start, n: 0 });
  const [round, setRound] = useState<Round | null>(null);
  const [phase, setPhaseState] = useState<Phase>("loading");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [done, setDone] = useState<Finished | null>(null);
  const [shareNote, setShareNote] = useState("");
  const [, render] = useReducer((x: number) => x + 1, 0);
  const phaseRef = useRef<Phase>("loading"), roundRef = useRef<Round | null>(null), eng = useRef<Engine>(newEngine());
  const play = useRef<HTMLDivElement>(null), canvas = useRef<HTMLCanvasElement>(null), root = useRef<HTMLDivElement>(null);
  const hudKey = useRef("");
  const setPhase = (p: Phase) => { phaseRef.current = p; setPhaseState(p); };
  const call = callerFor(guest);

  // Load a round whenever a new one is requested.
  useEffect(() => {
    let live = true;
    setPhase("loading"); setError(""); setDone(null); setShareNote("");
    (async () => {
      const day = brisbaneDay(), s = request.start;
      let mode: RushMode, loaded: Loaded, note = "";
      if (s.kind === "seed") {
        const seed = decodeSeed(s.seed);
        if (!seed) throw new Error("That Rush link isn't valid any more.");
        loaded = await fetchBars(call, seed);
        mode = isTodaysDaily(seed, day) && !todaysRun(day) ? "daily" : "challenge";
        if (mode === "daily") note = "Same chart as today's Daily Rush · this is your scored run";
      } else {
        const wantDaily = s.kind === "daily" || (s.kind === "auto" && !todaysRun(day));
        mode = wantDaily && !todaysRun(day) ? "daily" : "practice";
        if (wantDaily && mode === "practice") note = "Today's Daily Rush is in · practice is unlimited";
        loaded = await pickRound(call, mode === "daily" ? "daily" : "practice", day);
      }
      if (loaded.bars.length < 30) throw new Error("Not enough candles for that window. Try another round.");
      if (loaded.fallback) note = "Replaying the latest candles";
      const reveal = Math.min(REVEAL_BARS, Math.max(10, loaded.bars.length - 20)), context = loaded.bars.length - reveal;
      const ranges = loaded.bars.map(b => b.high - b.low), avgRange = Math.max(MARKETS[loaded.seed.market].tick, ranges.reduce((a, b) => a + b, 0) / ranges.length);
      return { round: { ...loaded, mode, context, reveal, text: encodeSeed(loaded.seed), day, avgRange } as Round, note };
    })().then(({ round, note }) => {
      if (!live) return;
      eng.current = newEngine(); eng.current.price = round.bars[round.context - 1].close;
      roundRef.current = round; setRound(round); setNotice(note); setPhase("ready");
    }).catch(e => { if (live) { setError((e as Error).message || "Couldn't load that round."); setPhase("error"); } });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request]);

  const barNow = () => { const r = roundRef.current!; return Math.min(r.reveal - 1e-6, eng.current.t / BAR_MS); };
  const startRide = (side: Side, pointer: number) => {
    const r = roundRef.current; if (!r) return;
    const e = eng.current, b = barNow();
    e.ride = { side, entry: roundTick(r.seed.market, e.price), mfe: 0, at: r.context + Math.floor(b), from: b, pointer };
    haptic(10); render();
  };
  const endRide = () => {
    const r = roundRef.current, e = eng.current, ride = e.ride; if (!r || !ride) return;
    const exit = roundTick(r.seed.market, e.price), fav = (exit - ride.entry) * (ride.side === "long" ? 1 : -1);
    const b = barNow(), pnl = ridePnl(r.seed.market, ride.side, ride.entry, exit);
    e.rides.push({ side: ride.side, entry: ride.entry, exit, pnl, mfe: Math.max(ride.mfe, fav), bars: b - ride.from, at: ride.at, until: r.context + Math.floor(b) });
    e.ride = null; e.pop = { pnl, key: e.rides.length };
    haptic(pnl > 0 ? [8, 40, 8] : 14); render();
  };
  const finish = () => {
    const r = roundRef.current; if (!r || phaseRef.current !== "live") return;
    if (eng.current.ride) endRide();
    const result = score(eng.current.rides);
    let streak = 0, freeze = false;
    if (r.mode === "daily") {
      const before = readDaily(), after = recordDaily(r.day, r.text, result);
      streak = after.streak; freeze = after.freezeWeek !== before.freezeWeek;
    }
    const newBest = recordBest(r.mode === "daily" ? "daily" : "practice", result.total, result.rides.length);
    const text = shareText({ mode: r.mode === "daily" ? "daily" : "practice", seed: r.seed, day: r.day, total: result.total, marks: result.rides.map(x => (x.pnl > 0 ? "W" : "L")).join(""), streak });
    setDone({ result, newBest, streak, freeze, text }); setPhase("done"); emit({ version: store.version + 1 });
    haptic(result.total > 0 ? [10, 60, 10, 60, 20] : 12);
  };
  const finishRef = useRef(finish); finishRef.current = finish;
  const endRideRef = useRef(endRide); endRideRef.current = endRide;

  // Frame loop: advance the replay, track the ride, draw.
  useEffect(() => {
    if (!round) return;
    let frame = 0, size = { w: 0, h: 0, dpr: 1 };
    const el = play.current!, cv = canvas.current!;
    const fit = () => { const r = el.getBoundingClientRect(), dpr = Math.min(3, devicePixelRatio || 1); size = { w: r.width, h: r.height, dpr }; cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr); };
    fit(); const ro = new ResizeObserver(fit); ro.observe(el);
    const k = speed();
    const tick = (now: number) => {
      const e = eng.current, ph = phaseRef.current, dt = e.last ? Math.min(100, now - e.last) * k : 0; e.last = now;
      if (ph === "ready") { e.countdown -= dt; if (e.countdown <= 0) { setPhase("live"); haptic(6); } }
      else if (ph === "live") {
        e.t += dt;
        const total = round.reveal * BAR_MS, b = Math.min(round.reveal - 1e-6, e.t / BAR_MS), bar = round.bars[round.context + Math.floor(b)];
        e.price = e.t >= total ? round.bars[round.bars.length - 1].close : priceAt(bar, b - Math.floor(b)).price;
        if (e.ride) e.ride.mfe = Math.max(e.ride.mfe, (roundTick(round.seed.market, e.price) - e.ride.entry) * (e.ride.side === "long" ? 1 : -1));
        if (e.t >= total) finishRef.current();
      }
      const view = viewOf(round, e, phaseRef.current, size.w);
      el.dataset.revealed = String(view.revealed); el.dataset.price = String(roundTick(round.seed.market, e.price)); el.dataset.phase = phaseRef.current;
      const g = cv.getContext("2d"); if (g && size.w > 0) drawChart(g, size, round, e, view);
      const left = Math.max(0, round.reveal * BAR_MS - e.t), live = e.ride ? ridePnl(round.seed.market, e.ride.side, e.ride.entry, roundTick(round.seed.market, e.price)) : 0;
      const key = `${phaseRef.current}|${Math.ceil(left / 1000)}|${Math.ceil(e.countdown / 1000)}|${live}|${e.rides.length}`;
      if (key !== hudKey.current) { hudKey.current = key; render(); }
      if (import.meta.env.DEV) (window as { __rush?: unknown }).__rush = { phase: phaseRef.current, seed: round.text, mode: round.mode, price: roundTick(round.seed.market, e.price), ride: e.ride && { ...e.ride }, rides: e.rides.map(x => ({ ...x })), bars: round.bars, context: round.context };
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(frame); ro.disconnect(); };
  }, [round]);

  // A ride can't outlive the finger: lose focus or hide the app and it cashes out.
  useEffect(() => {
    const out = () => { if (eng.current.ride) endRideRef.current(); };
    const vis = () => { if (document.hidden) out(); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("blur", out); document.addEventListener("visibilitychange", vis); window.addEventListener("keydown", key);
    const html = document.documentElement, overflow = html.style.overflow; html.style.overflow = "hidden";
    root.current?.focus();
    return () => { window.removeEventListener("blur", out); document.removeEventListener("visibilitychange", vis); window.removeEventListener("keydown", key); html.style.overflow = overflow; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Leaving mid-Daily ends that run as it stands (no peeking at the chart and retrying). */
  const close = () => { if (phaseRef.current === "live" && roundRef.current?.mode === "daily") finishRef.current(); onClose(); };
  const again = () => setRequest(r => ({ start: { kind: "practice" }, n: r.n + 1 }));
  const challenge = async () => {
    const r = roundRef.current; if (!r || !done) return;
    const link = rushLink(r.text);
    if (navigator.share) {
      try { await navigator.share({ title: "Brokie Rush", text: done.text, url: link }); setShareNote("Challenge sent"); return; }
      catch (e) { if ((e as Error).name === "AbortError") return; }
    }
    try { await navigator.clipboard.writeText(`${done.text} ${link}`); setShareNote("Link copied · same candles for whoever opens it"); }
    catch { setShareNote(link); }
  };

  const down = (ev: React.PointerEvent<HTMLDivElement>) => {
    ev.stopPropagation();
    if (phaseRef.current !== "live" || eng.current.ride || !ev.isPrimary || (ev.pointerType === "mouse" && ev.button !== 0)) return;
    const r = ev.currentTarget.getBoundingClientRect();
    try { ev.currentTarget.setPointerCapture(ev.pointerId); } catch { /* synthetic pointer */ }
    startRide(ev.clientY < r.top + r.height / 2 ? "long" : "short", ev.pointerId);
  };
  const up = (ev: React.PointerEvent<HTMLDivElement>) => { ev.stopPropagation(); if (eng.current.ride?.pointer === ev.pointerId) endRide(); };

  const e = eng.current, r = round, m = r?.seed.market ?? "nas";
  const ridePnlNow = r && e.ride ? ridePnl(m, e.ride.side, e.ride.entry, roundTick(m, e.price)) : 0;
  const total = Math.round(e.rides.reduce((s, x) => s + x.pnl, 0) * 100) / 100;
  const left = r ? Math.max(0, r.reveal * BAR_MS - e.t) : REVEAL_BARS * BAR_MS;
  const fav = r && e.ride ? (roundTick(m, e.price) - e.ride.entry) * (e.ride.side === "long" ? 1 : -1) : 0;
  const tint = r && e.ride ? Math.min(1, Math.abs(fav) / (r.avgRange * 2.5)) : 0;
  const modeLabel = r?.mode === "daily" ? "Daily Rush" : r?.mode === "challenge" ? "Challenge" : "Practice";
  const best = readBest()[r?.mode === "daily" ? "daily" : "practice"];

  return (
    <div ref={root} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Brokie Rush" data-testid="rush-overlay"
      className={`rush ${e.ride ? (fav >= 0 ? "riding up" : "riding down") : ""} ${phase}`}
      style={{ ["--tint" as string]: (0.05 + tint * 0.22).toFixed(3) }}
      onPointerDown={ev => ev.stopPropagation()} onTouchStart={ev => ev.stopPropagation()} onTouchMove={ev => ev.stopPropagation()}>
      <header className="rush-top">
        <button className="rush-x" onClick={close} aria-label="Close Rush" data-testid="rush-close">✕</button>
        <span className={`rush-tag ${r?.mode ?? ""}`} data-testid="rush-mode">{modeLabel}</span>
        {r && <span className="rush-market" style={{ ["--c" as string]: MARKETS[m].color }}><i />{MARKETS[m].title}<small>{MARKETS[m].symbol} ×{MICROS}</small></span>}
        <b className={`rush-timer ${left < 10_000 && phase === "live" ? "hot" : ""}`} data-testid="rush-timer">{clock(left)}</b>
      </header>
      <div className="rush-progress" aria-hidden="true"><i style={{ transform: `scaleX(${r ? 1 - left / (r.reveal * BAR_MS) : 0})` }} /></div>
      <section className="rush-hud" aria-live="off">
        <div className={`rush-ride ${e.ride ? (ridePnlNow >= 0 ? "up" : "down") : "flat"}`}>
          <small>{e.ride ? `${e.ride.side === "long" ? "Riding long" : "Riding short"} · ${px(e.ride.entry, digits(m))}` : "Ride"}</small>
          <b data-testid="rush-ride-pnl">{e.ride ? fmtMoney(ridePnlNow) : phase === "live" ? "Hold to ride" : "—"}</b>
        </div>
        <div className={`rush-total ${total > 0 ? "up" : total < 0 ? "down" : ""}`}>
          <small>Round</small><b data-testid="rush-total">{fmtMoney(total)}</b>
        </div>
      </section>
      <div ref={play} className="rush-play" data-testid="rush-chart" onPointerDown={down} onPointerUp={up} onPointerCancel={up} onLostPointerCapture={up} onContextMenu={ev => ev.preventDefault()}>
        <canvas ref={canvas} />
        {(phase === "ready" || (phase === "live" && !e.rides.length && !e.ride)) && <div className={`rush-zones ${phase}`} aria-hidden="true">
          <span className="long">Hold top · ride <b>long</b> ↑</span>
          <span className="short">Hold bottom · ride <b>short</b> ↓</span>
        </div>}
        {phase === "ready" && <div className="rush-count" data-testid="rush-countdown" aria-live="polite"><b key={Math.ceil(e.countdown / 1000)}>{Math.max(1, Math.ceil(e.countdown / 1000))}</b><span>{r ? `${r.context} bars of context · ${r.reveal} to play` : ""}</span></div>}
        {e.pop && phase === "live" && <div key={e.pop.key} className={`rush-pop ${e.pop.pnl > 0 ? "up" : "down"}`} aria-hidden="true">{fmtMoney(e.pop.pnl)}</div>}
        {phase === "loading" && <div className="rush-center"><span className="spinner" /><span>Pulling real candles…</span></div>}
        {phase === "error" && <div className="rush-center" role="alert"><b>Couldn't start the round.</b><span>{error}</span><button className="rush-btn primary" onClick={() => setRequest(x => ({ start: x.start.kind === "seed" ? x.start : { kind: "practice" }, n: x.n + 1 }))}>Try again</button></div>}
      </div>
      <footer className="rush-foot">
        <div className="rush-marks" data-testid="rush-marks" aria-label={`${e.rides.filter(x => x.pnl > 0).length} rides won, ${e.rides.filter(x => x.pnl <= 0).length} lost`}>
          {e.rides.slice(-14).map((x, i) => <i key={i} className={x.pnl > 0 ? "w" : "l"} />)}
          {!e.rides.length && <span>{r ? `${MICROS} micros · $${(MARKETS[m].pointValue * MICROS).toLocaleString("en-US")}/pt` : ""}</span>}
        </div>
        <span className="rush-note" data-testid="rush-note">{notice || (r?.mode === "daily" ? "One scored run today" : r?.mode === "challenge" ? "Same candles as your friend" : "Practice · just for you")}</span>
      </footer>
      {phase === "done" && done && r && <ResultCard r={r} done={done} best={best} guest={guest} shareNote={shareNote} onAgain={again} onChallenge={challenge} onDone={onClose} />}
    </div>
  );
}

function ResultCard({ r, done, best, guest, shareNote, onAgain, onChallenge, onDone }: { r: Round; done: Finished; best?: number; guest: boolean; shareNote: string; onAgain: () => void; onChallenge: () => void; onDone: () => void }) {
  const { result } = done, n = result.rides.length, hasSession = (() => { try { return !!localStorage.getItem("brokie.session.v1"); } catch { return false; } })();
  const tone = result.total > 0 ? "up" : result.total < 0 ? "down" : "flat";
  const copy = !n ? "No rides this time. The next tape is a fresh one."
    : result.total > 0 ? (result.wins / n >= .6 ? "Clean reads. That's the game." : "Up on the round. Nice work.")
    : result.total === 0 ? "Flat round. Tidy exits."
    : r.mode === "daily" ? "Choppy tape today. Fresh chart tomorrow." : "Choppy tape. That's what practice rounds are for.";
  const head = r.mode === "daily" ? `Daily Rush · ${dayLabel(r.day)}` : r.mode === "challenge" ? `Challenge · ${MARKETS[r.seed.market].title}` : `Practice · ${MARKETS[r.seed.market].title}`;
  return (
    <div className="rush-result-wrap">
      <section className={`rush-result ${tone}`} data-testid="rush-result" aria-label="Round result">
        <div className="rush-result-top"><span className={`rush-tag ${r.mode}`}>{head}</span>{done.newBest && <span className="rush-best" data-testid="rush-new-best">New best</span>}</div>
        <b className="rush-result-total" data-testid="rush-result-total">{fmtMoney(result.total)}</b>
        <div className="rush-squares" data-testid="rush-squares" aria-label={`${result.wins} won, ${result.losses} lost`}>
          {result.rides.map((x, i) => <i key={i} className={x.pnl > 0 ? "w" : "l"} title={fmtMoney(x.pnl)} />)}
          {!n && <span>No rides</span>}
          <small>{result.wins}W · {result.losses}L</small>
        </div>
        <p className="rush-copy">{copy}</p>
        <dl className="rush-stats">
          <div data-testid="rush-stat-reads"><dt>Reads</dt><dd>{result.reads}/{n}</dd><small>moved your way</small></div>
          <div data-testid="rush-stat-timing"><dt>Timing</dt><dd>{n ? Math.round(result.timing * 100) : 0}%</dd><small>of the move kept</small></div>
          <div data-testid="rush-stat-best"><dt>Best ride</dt><dd className={result.best && result.best.pnl > 0 ? "up" : ""}>{result.best ? fmtMoney(result.best.pnl) : "—"}</dd><small>{result.best ? `${result.best.side} · ${Math.max(1, Math.round(result.best.bars))} bars` : "none yet"}</small></div>
        </dl>
        <div className="rush-type" data-testid="rush-type"><small>You played like a</small><b>{result.type.name}</b><span>{result.type.line}</span></div>
        {r.mode === "daily" && <div className="rush-streak" data-testid="rush-result-streak">🔥 {done.streak} day{done.streak === 1 ? "" : "s"} streak{done.freeze ? " · freeze used for yesterday ❄" : ""}</div>}
        {!done.newBest && best !== undefined && n > 0 && <div className="rush-pb">Best {r.mode === "daily" ? "daily" : "practice"}: {fmtMoney(best)}</div>}
        {r.fallback && <div className="rush-pb">Live candles this time, so a challenge may differ.</div>}
        <div className="rush-actions">
          <button className="rush-btn" onClick={onAgain} data-testid="rush-again">Again</button>
          <button className="rush-btn primary" onClick={onChallenge} data-testid="rush-challenge">Challenge ↗</button>
          <button className="rush-btn" onClick={onDone} data-testid="rush-done">Done</button>
        </div>
        {shareNote && <div className="rush-share-note" role="status" data-testid="rush-share-note">{shareNote}</div>}
        {guest && <a className="rush-signup" href={location.pathname} data-testid="rush-signup">{hasSession ? "Back to Brokie →" : <>Play the real season → <b>Pick a handle</b></>}</a>}
      </section>
    </div>
  );
}

const clock = (ms: number) => { const s = Math.ceil(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };

// ---------- chart (own small canvas renderer; Setup Rush look: charcoal, white/red candles, orange accent)
const UP = "#F2F3F5", DOWN = "#FF5C67", LONG = "#7FE0B8", SHORT = "#FF6F79", ACCENT = "#ff8750", GRID = "rgba(255,255,255,.05)", AXIS = "rgba(255,255,255,.42)";
const MONO = "ui-monospace, SFMono-Regular, Menlo, monospace";
interface View { bars: Candle[]; first: number; slots: number; revealed: number; last: number }

function viewOf(r: Round, e: Engine, ph: Phase, w: number): View {
  const started = ph === "live" || ph === "done";
  const b = started ? Math.min(r.reveal - 1e-6, e.t / BAR_MS) : -1, k = Math.floor(b);
  const last = started ? r.context + k : r.context - 1;
  const bars = r.bars.slice(0, last + 1);
  if (started && ph === "live" && e.t < r.reveal * BAR_MS) {
    const src = r.bars[last], p = priceAt(src, b - k);
    bars[last] = { index: src.index, open: src.open, high: p.high, low: p.low, close: p.price };
  }
  const vis = w < 360 ? 34 : 44;
  return { bars, first: Math.max(0, last - vis + 1), slots: vis + 5, revealed: started ? Math.min(r.reveal, k + 1) : 0, last };
}

function drawChart(g: CanvasRenderingContext2D, s: { w: number; h: number; dpr: number }, r: Round, e: Engine, v: View) {
  const { w, h, dpr } = s, m = r.seed.market, d = digits(m);
  g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
  g.font = `800 10px ${MONO}`;
  const AX = Math.max(52, Math.ceil(g.measureText(px(Math.max(Math.abs(e.hi), Math.abs(e.lo), r.bars[0].high), d)).width) + 16), plotW = w - AX, top = 14, bottom = 12, plotH = h - top - bottom, slot = plotW / v.slots;
  const shown = v.bars.slice(v.first);
  let lo = Math.min(...shown.map(b => b.low)), hi = Math.max(...shown.map(b => b.high));
  if (e.ride) { lo = Math.min(lo, e.ride.entry); hi = Math.max(hi, e.ride.entry); }
  const pad = Math.max((hi - lo) * .12, MARKETS[m].tick * 4); lo -= pad; hi += pad;
  // Expand at once, relax slowly: the scale never jumps under the finger.
  if (!e.hi || lo < e.lo) e.lo = lo; else e.lo += (lo - e.lo) * .06;
  if (!e.hi || hi > e.hi) e.hi = hi; else e.hi += (hi - e.hi) * .06;
  const y = (p: number) => top + (e.hi - p) / (e.hi - e.lo) * plotH, x = (i: number) => (i - v.first + .5) * slot;

  // Hold zones: a faint split down the middle.
  g.fillStyle = "rgba(127,224,184,.025)"; g.fillRect(0, 0, plotW, h / 2);
  g.fillStyle = "rgba(255,111,121,.025)"; g.fillRect(0, h / 2, plotW, h / 2);
  g.setLineDash([2, 6]); g.strokeStyle = "rgba(255,255,255,.08)"; g.lineWidth = 1; g.beginPath(); g.moveTo(0, h / 2); g.lineTo(plotW, h / 2); g.stroke(); g.setLineDash([]);

  g.font = `600 9.5px ${MONO}`; g.textBaseline = "middle"; g.textAlign = "right";
  for (const t of ticks(e.lo, e.hi, Math.max(3, Math.round(plotH / 70)))) {
    const yy = y(t); if (yy < 8 || yy > h - 8) continue;
    g.setLineDash([1, 4]); g.strokeStyle = GRID; g.beginPath(); g.moveTo(0, yy); g.lineTo(plotW, yy); g.stroke(); g.setLineDash([]);
    g.fillStyle = AXIS; g.fillText(px(t, d), w - 6, yy);
  }

  // Where the replay starts: everything right of this line was unseen.
  const startX = x(r.context) - slot / 2;
  if (startX > 0 && startX < plotW) {
    g.setLineDash([3, 4]); g.strokeStyle = "rgba(255,135,80,.45)"; g.beginPath(); g.moveTo(startX, top); g.lineTo(startX, h - bottom); g.stroke(); g.setLineDash([]);
    g.fillStyle = ACCENT; g.font = `800 8px ${MONO}`; g.textAlign = "left"; g.fillText("REPLAY ▶", startX + 5, top + 4);
  }

  // Live ride: shaded between entry and price.
  if (e.ride) {
    const ye = y(e.ride.entry), yp = y(e.price), good = (e.price - e.ride.entry) * (e.ride.side === "long" ? 1 : -1) >= 0;
    g.fillStyle = good ? "rgba(127,224,184,.13)" : "rgba(255,111,121,.13)";
    const xe = Math.max(0, x(e.ride.at) - slot / 2); g.fillRect(xe, Math.min(ye, yp), plotW - xe, Math.abs(yp - ye));
  }

  // Candles.
  const body = Math.max(1, Math.min(9, slot * .64));
  shown.forEach((b, j) => {
    const i = v.first + j, cx = Math.round(x(i)) + .5, up = b.close >= b.open, col = up ? UP : DOWN;
    g.strokeStyle = g.fillStyle = i < r.context ? (up ? "rgba(242,243,245,.55)" : "rgba(255,92,103,.55)") : col; g.lineWidth = 1;
    g.beginPath(); g.moveTo(cx, y(b.high)); g.lineTo(cx, y(b.low)); g.stroke();
    const y1 = y(Math.max(b.open, b.close)), y2 = y(Math.min(b.open, b.close));
    g.fillRect(cx - body / 2, y1, body, Math.max(1, y2 - y1));
  });

  // Finished rides: entry → exit.
  for (const ride of e.rides) {
    if (ride.until < v.first) continue;
    const col = ride.pnl > 0 ? LONG : SHORT, x1 = x(ride.at), x2 = x(ride.until), y1 = y(ride.entry), y2 = y(ride.exit);
    g.strokeStyle = col; g.lineWidth = 1.5; g.setLineDash([3, 3]); g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke(); g.setLineDash([]);
    g.fillStyle = col; g.beginPath(); g.arc(x1, y1, 3, 0, Math.PI * 2); g.fill();
    g.fillStyle = "#0b0c10"; g.strokeStyle = col; g.lineWidth = 1.5; g.beginPath(); g.arc(x2, y2, 3.5, 0, Math.PI * 2); g.fill(); g.stroke();
  }

  // Entry line and tag.
  if (e.ride) {
    const ye = y(e.ride.entry), col = e.ride.side === "long" ? LONG : SHORT;
    g.strokeStyle = col; g.lineWidth = 1; g.setLineDash([4, 3]); g.beginPath(); g.moveTo(0, ye); g.lineTo(plotW, ye); g.stroke(); g.setLineDash([]);
    g.font = `800 9px ${MONO}`; g.textAlign = "left";
    const label = `${e.ride.side === "long" ? "LONG" : "SHORT"} ${px(e.ride.entry, d)}`, lw = g.measureText(label).width + 14;
    g.fillStyle = col; notched(g, 6, ye - 9, lw, 18); g.fill(); g.fillStyle = "#0b0c10"; g.fillText(label, 13, ye + .5);
  }

  // Live price line and axis tag.
  const yp = y(e.price);
  g.setLineDash([1, 3]); g.strokeStyle = "rgba(255,255,255,.55)"; g.lineWidth = 1; g.beginPath(); g.moveTo(0, yp); g.lineTo(plotW, yp); g.stroke(); g.setLineDash([]);
  const live = v.last >= 0 ? x(v.last) : 0;
  g.fillStyle = "#fff"; g.beginPath(); g.arc(live, yp, 2.5, 0, Math.PI * 2); g.fill();
  g.fillStyle = e.ride ? ((e.price - e.ride.entry) * (e.ride.side === "long" ? 1 : -1) >= 0 ? LONG : SHORT) : UP;
  notched(g, plotW + 2, yp - 10, AX - 4, 20); g.fill();
  g.fillStyle = "#0b0c10"; g.font = `800 10px ${MONO}`; g.textAlign = "right"; g.fillText(px(roundTick(m, e.price), d), w - 6, yp + .5);
}

function notched(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, n = 4) {
  g.beginPath(); g.moveTo(x + n, y); g.lineTo(x + w, y); g.lineTo(x + w, y + h - n); g.lineTo(x + w - n, y + h); g.lineTo(x, y + h); g.lineTo(x, y + n); g.closePath();
}
function ticks(lo: number, hi: number, count: number): number[] {
  const span = hi - lo; if (!(span > 0)) return [];
  const raw = span / count, mag = 10 ** Math.floor(Math.log10(raw)), step = [1, 2, 2.5, 5, 10].map(x => x * mag).find(x => x >= raw) ?? mag * 10;
  const out: number[] = []; for (let t = Math.ceil(lo / step) * step; t <= hi && out.length < 20; t += step) out.push(t);
  return out;
}

// ---------- Learn entry card
export function DailyRushCard() {
  useRushStore();
  const day = brisbaneDay(), run = todaysRun(day), streak = streakNow(day), s = readDaily(), market = MARKETS[run ? decodeSeed(run.seed)?.market ?? dailySeed(day).market : dailySeed(day).market];
  const freeze = freezeAvailable(s, day);
  return (
    <section className="rush-card" data-testid="rush-card" aria-label="Daily Rush">
      <div className="rush-card-top">
        <span className="rush-tag daily">Daily Rush</span>
        <span className="rush-card-day">{dayLabel(day)} · {market.title}</span>
        <span className="rush-card-streak" data-testid="rush-streak" aria-label={`${streak} day streak`}>🔥 {streak}</span>
      </div>
      {run ? <div className="rush-card-done" data-testid="rush-card-done">
        <b className={run.total > 0 ? "up" : run.total < 0 ? "down" : ""}>{fmtMoney(run.total)}</b>
        <span aria-label={`${[...run.marks].filter(x => x === "W").length} won, ${[...run.marks].filter(x => x === "L").length} lost`}>{squares(run.marks, 10)}</span>
        <small>Today's run is in. Come back tomorrow for a new chart.</small>
      </div> : <p>{REVEAL_BARS} real candles, two minutes, the same chart for everyone today. Hold the top to ride long, the bottom to ride short, let go to cash out.</p>}
      <div className="rush-card-actions">
        {run ? <button className="rush-btn" disabled data-testid="rush-daily-play">Played ✓</button>
          : <button className="rush-btn primary" onClick={() => openRush({ mode: "daily" })} data-testid="rush-daily-play">Play today's run</button>}
        <button className={`rush-btn ${run ? "primary" : ""}`} onClick={() => openRush({ mode: "practice" })} data-testid="rush-practice">Practice</button>
      </div>
      <small className="rush-card-foot">{freeze ? "❄ One streak freeze ready this week" : "❄ Freeze used this week"} · scored here, not on your season</small>
    </section>
  );
}

// Re-exported so tests and integrators can reach the pure helpers.
export { CONTEXT_BARS, REVEAL_BARS };
