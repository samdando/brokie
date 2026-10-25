import { useEffect, useState } from "react";
import { game } from "./game";
import { Candle, MARKETS, Trade, direction } from "./types";
import { Button, signedMoney } from "./ui";
interface Review { trade: Trade; candles: Candle[]; bucket_seconds: number; note: string }
export function TradeReview({ trade }: { trade: Trade }) {
  const [review, setReview] = useState<Review | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let live = true; setReview(null); setError("");
    game.api.rpc<Review>("review_trade", { p_trade: trade.id }).then(r => {
      if (!r?.trade || !Array.isArray(r.candles)) throw new Error("Review unavailable.");
      if (live) { setReview(r); setNote(r.note); }
    }).catch(e => { if (live) setError((e as Error).message); });
    return () => { live = false; };
  }, [trade.id, retry]);
  const move = (trade.exit_price - trade.entry_price) * direction(trade.side);
  const minutes = trade.opened_at ? Math.max(0, (Date.parse(trade.closed_at) - Date.parse(trade.opened_at)) / 60000) : null;
  return <section className="trade-review stack" style={{ gap: 12 }} data-testid="trade-review">
    <h3 className="h3">Trade review</h3>
    <p className="review-summary">{trade.pnl > 0 ? "Winning trade." : trade.pnl < 0 ? "Losing trade." : "Finished flat."} {trade.prediction_outcome?.toUpperCase() ?? MARKETS[trade.market].title} moved {Math.abs(move * (trade.market === "prediction" ? 100 : 1)).toLocaleString(undefined, { maximumFractionDigits: 2 })} {trade.market === "prediction" ? "cents" : "points"} {move >= 0 ? "in your favour" : "against your position"}. Your {trade.quantity} {trade.market === "prediction" ? "shares" : "micros"} made {signedMoney(trade.pnl)}.</p>
    <div className="detail"><span>Held for</span><b>{minutes === null ? "Not recorded" : minutes < 1 ? "Under a minute" : `${Math.floor(minutes / 60)}h ${Math.floor(minutes % 60)}m`}</b></div>
    <div className="detail"><span>Exposure per $1 move</span><b>{signedMoney(MARKETS[trade.market].pointValue * trade.quantity)}</b></div>
    <div className="muted" style={{ fontSize: 12 }}>{trade.reason === "market_close" ? "The session ended, so Brokie closed the trade automatically." : trade.reason === "daily_limit" ? "Your daily loss limit closed this trade. Check how position size affected the loss." : trade.reason === "blown" ? "The account drawdown limit closed this trade." : "Review the entry, position size and exit against the setup you intended."}</div>
    {error && <div className="err" role="alert">{error} {!review && <button className="text-action" onClick={() => setRetry(v => v + 1)}>Retry</button>}</div>}
    {!review && !error && <div role="status">Loading trade chart…</div>}
    {review && <><ReviewChart review={review} />
      <label className="stack" style={{ gap: 8 }}>Your setup and takeaway<textarea className="field" style={{ height: 100, padding: 12 }} maxLength={2000} value={note} placeholder="What was the setup? What would you repeat or change?" onChange={e => { setNote(e.target.value); setSaved(false); }} /></label>
      <Button busy={busy} onClick={async () => { setBusy(true); setError(""); try { await game.api.rpc("save_trade_note", { p_trade: trade.id, p_note: note }); setSaved(true); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }}>{saved ? "Saved ✓" : "Save private note"}</Button>
    </>}
    <small className="muted">Review uses recorded fills. Planned risk and stop discipline are only assessable if you recorded them.</small>
  </section>;
}
function ReviewChart({ review: { trade, candles, bucket_seconds } }: { review: Review }) {
  if (!candles.length || !trade.opened_at) return <div className="panel muted" style={{ padding: 14 }}>Chart history is unavailable for this trade. Entry and exit fills are preserved above.</div>;
  const start = Math.min(candles[0].index * bucket_seconds, Date.parse(trade.opened_at) / 1000);
  const end = Math.max(candles[candles.length - 1].index * bucket_seconds, Date.parse(trade.closed_at) / 1000, start + 1);
  const low = Math.min(trade.entry_price, trade.exit_price, ...candles.map(c => c.close));
  const high = Math.max(trade.entry_price, trade.exit_price, ...candles.map(c => c.close));
  const pad = Math.max((high - low) * 0.15, MARKETS[trade.market].tick * 2);
  const x = (time: number) => 24 + (time - start) / (end - start) * 312;
  const y = (price: number) => 154 - (price - low + pad) / (high - low + 2 * pad) * 112;
  return <figure className="review-chart"><svg viewBox="0 0 360 190" role="img" aria-label={`${MARKETS[trade.market].title} recorded prices with entry and exit marked`}>
    <polyline points={candles.map(c => `${x(c.index * bucket_seconds)},${y(c.close)}`).join(" ")} fill="none" stroke="var(--muted)" strokeWidth="2" />
    <line x1={x(Date.parse(trade.opened_at) / 1000)} y1={y(trade.entry_price)} x2={x(Date.parse(trade.closed_at) / 1000)} y2={y(trade.exit_price)} stroke={trade.pnl >= 0 ? "var(--lime)" : "var(--red)"} strokeDasharray="4 4" />
    {[["Entry", Date.parse(trade.opened_at) / 1000, trade.entry_price], ["Exit", Date.parse(trade.closed_at) / 1000, trade.exit_price]].map(([label, time, price]) => <g key={label}>
      <circle cx={x(Number(time))} cy={y(Number(price))} r="5" fill={label === "Entry" ? "var(--gold)" : "var(--lime)"} />
      <text x={Math.max(30, Math.min(330, x(Number(time))))} y={label === "Entry" ? 23 : 181} textAnchor="middle" fill="currentColor" fontSize="12">{label}</text>
    </g>)}
  </svg><figcaption className="muted">{bucket_seconds / 60}-minute closing prices · dots show your actual fills</figcaption></figure>;
}
export function DailyRecap() {
  const [data, setData] = useState<{ day: string; pnl: number; wins: number; losses: number; trades: number } | null>(null);
  useEffect(() => {
    let live = true;
    const load = async () => {
      try {
        const b = await game.api.rpc<{ day: string; rows: { is_you: boolean; pnl: number; wins: number; losses: number; trades: number }[] }>("daily_leaderboard");
        const r = b.rows.find(r => r.is_you); if (live && r) setData({ ...r, day: b.day });
      } catch { /* Receipts remain usable if daily results are offline. */ }
    };
    void load(); const timer = setInterval(load, 15000);
    return () => { live = false; clearInterval(timer); };
  }, []);
  return data ? <section className="panel stack daily-recap" style={{ padding: 18, gap: 10 }}><div className="row between"><b>Today's recap</b><small className="muted">Session {data.day}</small></div><strong className={data.pnl >= 0 ? "lime" : "red"}>{signedMoney(data.pnl)}</strong><span className="muted">{data.wins} wins · {data.losses} losses · {data.trades} closed trades</span></section> : null;
}
