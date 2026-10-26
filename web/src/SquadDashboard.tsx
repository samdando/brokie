import { useEffect, useState } from "react";
import { game } from "./game";
import { Avatar } from "./Avatar";
import { PlayerLink } from "./Profiles";
import { MARKETS, Market, Side, direction } from "./types";
import { signedMoney } from "./ui";
interface Dashboard {
  day: string; ends_at: string;
  players: { handle: string; trades: number; wins: number; losses: number; pnl: number }[];
  open: { handle: string; market: Market; side: Side; quantity: number; entry_price: number; opened_at: string }[];
}
export function useSquadDashboard(id: string | undefined) {
  const [data, setData] = useState<Dashboard | null>(null), [error, setError] = useState("");
  useEffect(() => {
    let live = true; setData(null); setError("");
    if (!id) return;
    const load = async () => {
      try { const d = await game.api.rpc<Dashboard>("squad_dashboard", { p_squad: id }); if (live) { setData(d); setError(""); } }
      catch { if (live) setError("Squad stats couldn't refresh. Reconnecting…"); }
    };
    void load(); const t = setInterval(() => { if (!document.hidden) void load(); }, 5000);
    return () => { live = false; clearInterval(t); };
  }, [id]);
  return { data, error };
}
export function ActiveSquadTrades({ data, error }: { data: Dashboard | null; error: string }) {
  return <section className="stack squad-active" style={{ gap: 12 }} data-testid="squad-active">
    <div className="row between"><h2 className="h2">Active trades</h2><span className="eyebrow">{data ? `${data.open.length} stacks live` : "Connecting"}</span></div>
    {error && <div className="err" role="status">{error}</div>}
    {!data ? <div className="panel muted">Loading squad trades…</div> : !data.open.length ? <div className="panel muted">Squad’s flat. The next move is yours.</div> : data.open.map(p => {
      const q = game.quote(p.market)?.price, pnl = q == null ? null : (q - p.entry_price) * p.quantity * MARKETS[p.market].pointValue * direction(p.side);
      return <div className="panel squad-live-row" key={`${p.handle}:${p.market}:${p.side}`}><Avatar handle={p.handle} /><div><b><PlayerLink handle={p.handle} /></b><small><span className={p.side === "long" ? "lime" : "red"}>{p.side.toUpperCase()}</span> · {p.quantity} {MARKETS[p.market].title}</small></div><b className={`mono ${(pnl ?? 0) < 0 ? "red" : "lime"}`}>{pnl == null ? "—" : signedMoney(pnl)}</b></div>;
    })}
  </section>;
}
export function SquadDailyStats({ data }: { data: Dashboard | null }) {
  const players = data?.players ?? [], total = players.reduce((s, p) => s + Number(p.pnl), 0), trades = players.reduce((s, p) => s + Number(p.trades), 0), wins = players.reduce((s, p) => s + Number(p.wins), 0);
  return <section className="stack" style={{ gap: 12 }} data-testid="squad-daily">
    <div className="row between"><h2 className="h2">Squad today</h2><span className="eyebrow">{data?.day ?? "Loading"}</span></div>
    <div className="daily-squad-grid"><div className="panel"><span>Closed P&amp;L</span><b className={total < 0 ? "red" : "lime"}>{data ? signedMoney(total) : "—"}</b></div><div className="panel"><span>Trades</span><b>{data ? trades : "—"}</b></div><div className="panel"><span>Win rate</span><b>{trades ? `${Math.round(wins / trades * 100)}%` : "—"}</b></div></div>
    <div className="panel squad-day-list">{players.map(p => <div className="squad-day-row" key={p.handle}><Avatar handle={p.handle} /><div><PlayerLink handle={p.handle} /><small>{p.trades} closed · {p.wins}W / {p.losses}L</small></div><b className={`mono ${p.pnl < 0 ? "red" : "lime"}`}>{signedMoney(p.pnl)}</b></div>)}</div>
    {data && <small className="muted">Trading day resets at {new Date(data.ends_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} · 5pm New York</small>}
  </section>;
}
