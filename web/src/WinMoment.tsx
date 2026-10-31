import { useEffect, useRef, useState } from "react";
import { MARKETS, type Market, type Side, type Trade } from "./types";
import { money, signedMoney } from "./ui";

/** A closed trade as the focus floor tells it: how much, on what, and in units of the risk you set. */
export interface TradeResult {
  id: number; pnl: number; market: Market; side: Side; qty: number;
  /** P&L ÷ the dollars you stood to lose at your stop, when a stop was set. */
  r: number | null;
  /** Beats every other trade closed in the last seven days. */
  best: boolean;
  how: "cash" | "close" | "tp" | "sl";
}

const WIN_MS = 1800, LOSS_MS = 1300;

/** R multiple as a signed one-decimal figure: +1.6R, −1.0R. */
export const formatR = (r: number) => `${r >= 0 ? "+" : "−"}${Math.abs(r).toFixed(1)}R`;

/** A winning close beats the week when it's bigger than every other trade closed in the last 7 days (needs one to beat). */
export function bestThisWeek(pnl: number, before: Trade[], now: number) {
  const since = now - 7 * 86400_000;
  const week = before.filter(t => Number.isFinite(Date.parse(t.closed_at)) && Date.parse(t.closed_at) >= since);
  return pnl > 0 && week.length > 0 && week.every(t => pnl > t.pnl);
}

/** The result splash after a close on the focus floor. It never takes touches: any touch anywhere
 *  dismisses it and still reaches the chart, so the next hold works straight away. */
export function ResultSplash({ result, onDone }: { result: TradeResult | null; onDone: () => void }) {
  const [leaving, setLeaving] = useState(false);
  const done = useRef(onDone); done.current = onDone;
  useEffect(() => {
    if (!result) return;
    setLeaving(false);
    let out: ReturnType<typeof setTimeout> | undefined;
    const dismiss = () => { if (out) return; setLeaving(true); out = setTimeout(() => done.current(), 180); };
    const life = setTimeout(dismiss, result.pnl > 0 ? WIN_MS : LOSS_MS);
    // Listen from the next frame, so the release that closed the trade doesn't count as a dismissing tap.
    const arm = requestAnimationFrame(() => { addEventListener("pointerdown", dismiss, true); addEventListener("keydown", dismiss, true); });
    return () => { clearTimeout(life); if (out) clearTimeout(out); cancelAnimationFrame(arm); removeEventListener("pointerdown", dismiss, true); removeEventListener("keydown", dismiss, true); };
  }, [result]);
  if (!result) return null;
  const win = result.pnl > 0, tone = win ? "win" : result.pnl < 0 ? "loss" : "flat";
  const kicker = result.how === "tp" ? "Target hit" : result.how === "sl" ? "Stopped out" : win ? "Cashed out" : "Closed";
  // Calm, factual loss copy. No "win it back".
  const note = !win && result.r != null && result.r >= -1.05 && result.r < 0 ? "Loss kept to your stop" : null;
  return (
    <div className={`result-splash ${tone} ${result.best ? "best" : ""} ${leaving ? "leaving" : ""}`} data-testid="result-splash" data-tone={tone} role="status" aria-live="polite">
      {win && <div className="rs-burst" aria-hidden="true">{Array.from({ length: 14 }, (_, i) => <i key={i} style={{ ["--a" as string]: `${i * (360 / 14) + (i % 2) * 9}deg`, ["--d" as string]: `${70 + (i % 3) * 26}px` }} />)}</div>}
      <div className="rs-card" key={result.id}>
        {result.best && <span className="rs-badge" data-testid="best-week">★ Best this week</span>}
        <small className="rs-kicker">{kicker}</small>
        <b className="rs-amount" data-testid="result-amount" style={{ ["--n" as string]: signedMoney(result.pnl).length }}>{signedMoney(result.pnl)}</b>
        <span className="rs-meta" data-testid="result-meta">{MARKETS[result.market].title} · {result.side === "long" ? "Long" : "Short"} {result.qty}
          {result.r != null && <em data-testid="result-r">{formatR(result.r)}</em>}</span>
        {note && <small className="rs-note">{note}</small>}
      </div>
    </div>
  );
}

/** Once per season: the moment the account reaches its profit target, and again when it's funded. */
export function GoalCelebration({ kind, gain, qualifyDays, tradingDays, onDone }: { kind: "target" | "funded" | null; gain: number; qualifyDays: number; tradingDays: number; onDone: () => void }) {
  const done = useRef(onDone); done.current = onDone;
  useEffect(() => {
    if (!kind) return;
    const t = setTimeout(() => done.current(), 6000);
    return () => clearTimeout(t);
  }, [kind]);
  if (!kind) return null;
  const funded = kind === "funded";
  const left = Math.max(0, qualifyDays - tradingDays);
  return (
    <div className={`goal-celebration ${kind}`} data-testid="goal-celebration" data-kind={kind} role="dialog" aria-modal="true" aria-label={funded ? "Funded" : "Target hit"} onClick={() => done.current()}>
      <div className="gc-rays" aria-hidden="true" />
      <div className="gc-confetti" aria-hidden="true">{Array.from({ length: 28 }, (_, i) => <i key={i} style={{ ["--x" as string]: `${(i * 37) % 100}%`, ["--t" as string]: `${(i % 7) * .12}s`, ["--c" as string]: ["#7FE0B8", "#D6FE59", "#F2CA73", "#B5A0FE", "#F2F3F5"][i % 5] }} />)}</div>
      <div className="gc-card">
        <span className="gc-icon" aria-hidden="true">{funded ? "🏆" : "🎯"}</span>
        <small className="gc-kicker">{funded ? "Season goal complete" : "Profit target reached"}</small>
        <b className="gc-title">{funded ? "FUNDED" : "TARGET HIT"}</b>
        <span className="gc-amount">+{money(Math.max(0, gain), 0)} this season</span>
        <p className="gc-copy">{funded ? "Target plus your qualifying days. You're on the funded board this season."
          : left > 0 ? `Stay at +10% through ${left} more trading day${left === 1 ? "" : "s"} to get funded.` : "Stay at +10% to lock in funded."}</p>
        <small className="gc-fine">Game badge · no real money</small>
        <button type="button" className="gc-go" onClick={e => { e.stopPropagation(); done.current(); }} data-testid="goal-continue">Keep trading</button>
      </div>
    </div>
  );
}
