import { useCallback, useEffect, useRef, useState } from "react";
import { game } from "./game";
import { Button, Sheet } from "./ui";
interface Prediction { id: string; title: string; rules: string; close_at: string; status: string; yes_bid: number; yes_ask: number; no_bid: number; no_ask: number; payout_yes: number | null; quoted_at: string }
interface TokenPosition { id: string; prediction_id: string; prediction_outcome: "yes" | "no"; prediction_question: string; quantity: number; entry_price: number; cost: number; mark_price: number }
interface TokenTrade extends TokenPosition { payout: number; pnl: number; closed_at: string; reason: string }
interface Board { markets: Prediction[]; positions: TokenPosition[]; trades: TokenTrade[]; balance: number; earned_today: boolean; next_reward_at: string }
const tokens = (n: number) => `${n.toLocaleString(undefined, { maximumFractionDigits: 6 })} ${n === 1 ? "token" : "tokens"}`;
const signedTokens = (n: number) => `${n > 0 ? "+" : ""}${tokens(n)}`;
export function PredictionMarkets({ toast }: { toast: (s: string) => void }) {
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<{ id: string; outcome: "yes" | "no" } | null>(null);
  const [stake, setStake] = useState(1);
  const [busy, setBusy] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const requestId = useRef(0);
  const load = useCallback(async () => {
    const id = ++requestId.current;
    try {
      const r = await game.api.rpc<Board>("prediction_board");
      if (!Array.isArray(r?.markets) || !Array.isArray(r.positions) || typeof r.balance !== "number") throw new Error("Token predictions are unavailable. Please try again shortly.");
      if (id === requestId.current) { setBoard(r); setError(""); }
    } catch(e) { if (id === requestId.current) setError((e as Error).message); }
  }, []);
  useEffect(() => { void load(); const timer = setInterval(() => { if (!document.hidden) void load(); }, 10000); return () => clearInterval(timer); }, [load]);
  const markets = board?.markets ?? [];
  const balance = board?.balance ?? 0;
  const fresh = (m: Prediction) => m.status === "active" && Date.parse(m.close_at) > game.now() && game.now() - Date.parse(m.quoted_at) < 90000 && Date.parse(m.quoted_at) <= game.now() + 5000 && m.payout_yes === null;
  const chosen = markets.find(m => m.id === selected?.id);
  const ask = chosen && selected ? selected.outcome === "yes" ? chosen.yes_ask : chosen.no_ask : 0;
  const validStake = Number.isInteger(stake) && stake >= 1 && stake <= 1000 && stake <= balance;
  const shares = ask > 0 && validStake ? Math.floor(stake / ask * 1e6) / 1e6 : 0;
  return <section className="stack predictions" data-testid="predictions">
    <div className="row between"><h2 className="h2">Prediction markets</h2><span className="eyebrow">Tokens only</span></div>
    <div className="panel prediction-card" data-testid="prediction-wallet">
      <div className="row between"><span className="muted">Your balance</span><b className="lime">{board ? tokens(balance) : "—"}</b></div>
      <p className="muted" style={{ fontSize: 12, margin: 0 }}>Earn 1 token on your first trade each trading day. Pick Yes or No with tokens. Prediction results never affect your competition balance or rank.</p>
      {board && <small className="muted">{board.earned_today ? "Today’s token earned ✓" : "Open or manually close a trade to earn today’s token."} New trading day at {new Date(board.next_reward_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} (5pm New York).</small>}
    </div>
    <p className="muted" style={{ fontSize: 12, margin: 0 }}>A winning share pays 1 token; a losing share pays 0. Prices from Kalshi. Tokens have no cash value.</p>
    {!!board?.positions.length && <div className="stack"><h3 className="h3">Your predictions</h3>{board.positions.map(p => {
      const m = markets.find(m => m.id === p.prediction_id);
      const pnl = Math.trunc(p.mark_price * p.quantity * 1e6) / 1e6 - p.cost;
      return <div className="panel prediction-card" key={p.id}><b>{p.prediction_question}</b>
        <div className="row between"><span className="muted">{p.prediction_outcome.toUpperCase()} · {p.quantity.toLocaleString(undefined, { maximumFractionDigits: 4 })} shares</span><b className={pnl >= 0 ? "lime" : "red"}>{signedTokens(pnl)}</b></div>
        <div className="muted" style={{ fontSize: 11 }}>Entry {tokens(p.entry_price)} / share · stake {tokens(p.cost)}</div>
        <Button variant="ghost" disabled={busy || !m || (!fresh(m) && m.payout_yes === null) || (m.payout_yes === null && p.mark_price <= 0)} onClick={async () => { setBusy(true); try { const t = await game.api.rpc<TokenTrade>("close_prediction", { p_id: p.id }); await load(); toast(`Prediction closed · ${signedTokens(t.pnl)}`); } catch(e) { toast((e as Error).message); } finally { setBusy(false); } }}>{m && (m.status !== "active" || Date.parse(m.close_at) <= game.now()) && m.payout_yes === null ? "Awaiting official result" : "Close prediction"}</Button>
      </div>;
    })}</div>}
    {error && <div className="err" role="alert">{error} <button className="text-action" onClick={() => void load()}>Retry</button></div>}
    {!board && !error && <div role="status">Loading token predictions…</div>}
    {board && !markets.length && !error && <div className="panel muted" style={{ padding: 18 }}>No fresh prediction markets right now. Check back shortly.</div>}
    {markets.slice(0, showAll ? 60 : 6).map(m => <article className="panel prediction-card" key={m.id}>
      <h3 className="h3">{m.title}</h3><small className="muted">Trading ends {new Date(m.close_at).toLocaleString()}</small>
      <div className="prediction-outcomes">{(["yes", "no"] as const).map(side => { const value = side === "yes" ? m.yes_ask : m.no_ask; return <button key={side} className={side} disabled={busy || !!error || !fresh(m) || value <= 0 || value >= 1 || balance < 1} onClick={() => { setSelected({ id: m.id, outcome: side }); setStake(1); }}><span>{side.toUpperCase()}</span><b>{value > 0 && value < 1 ? tokens(value) : "—"}</b></button>; })}</div>
      {!fresh(m) && <small className="muted">{m.status === "active" && Date.parse(m.close_at) > game.now() ? "Waiting for fresh prices" : "Closed · awaiting settlement"}</small>}
      <details><summary className="muted">Resolution rules</summary><p>{m.rules || "Rules unavailable; trading is paused."}</p><small className="muted">Kalshi market: {m.id}</small></details>
    </article>)}
    {markets.length > 6 && <button className="text-action" onClick={() => setShowAll(!showAll)}>{showAll ? "Show fewer" : "More predictions"}</button>}
    {!!board?.trades.length && <div className="stack"><h3 className="h3">Prediction history</h3>{board.trades.map(t => <div className="panel prediction-card" key={t.id}><b>{t.prediction_question}</b><div className="row between"><span className="muted">{t.prediction_outcome.toUpperCase()} · {t.reason === "prediction_settled" ? "Settled" : "Closed"}</span><b className={t.pnl >= 0 ? "lime" : "red"}>{signedTokens(t.pnl)}</b></div><small className="muted">Returned {tokens(t.payout)} · {new Date(t.closed_at).toLocaleString()}</small></div>)}</div>}
    <Sheet open={!!selected} onClose={() => { if (!busy) setSelected(null); }}><div className="stack">
      <div className="row between"><h3 className="h3">Buy {selected?.outcome.toUpperCase()}</h3><button className="text-action" disabled={busy} onClick={() => setSelected(null)}>Cancel</button></div>
      <b>{chosen?.title}</b>
      <div className="detail"><label htmlFor="prediction-stake">Token stake</label><input id="prediction-stake" aria-label="Token stake" type="number" min={1} max={Math.min(1000, Math.floor(balance))} step={1} value={Number.isFinite(stake) ? stake : ""} disabled={busy} onChange={e => setStake(e.target.valueAsNumber)} style={{ width: 100 }} /></div>
      <div className="chips">{[1,2,5,10].map(value => <button key={value} disabled={busy || value > balance} className={`chip ${value === stake ? "on" : ""}`} onClick={() => setStake(value)}>{tokens(value)}</button>)}</div>
      <div className="detail"><span>Available</span><b>{tokens(balance)}</b></div>
      <div className="detail"><span>Entry / share</span><b>{tokens(ask)}</b></div>
      <div className="detail"><span>Maximum loss</span><b>{validStake ? tokens(stake) : "—"}</b></div>
      <div className="detail"><span>Payout if this outcome wins</span><b>{tokens(shares)}</b></div>
      <small className="muted">Fills use the latest ask; closing early uses the latest bid. Fractional shares and payouts round down to 6 decimals. Your competition balance stays separate.</small>
      <Button busy={busy} disabled={!!error || !chosen || !fresh(chosen) || !validStake || shares <= 0} onClick={async () => { if (!selected) return; setBusy(true); try { await game.api.rpc("open_prediction", { p_market: selected.id, p_outcome: selected.outcome, p_stake: stake }); await load(); setSelected(null); toast("Token prediction opened."); } catch(e) { toast((e as Error).message); } finally { setBusy(false); } }}>Buy {selected?.outcome.toUpperCase()} · {validStake ? tokens(stake) : "choose token stake"}</Button>
    </div></Sheet>
  </section>;
}
