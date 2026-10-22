import { createContext, ReactNode, useContext, useEffect, useState } from "react";
import "./profiles.css";
import { game } from "./game";
import { useGame } from "./game";
import type { Lifetime, Market } from "./types";
import { MARKETS, pnlOf } from "./types";
import { Sheet, money, signedMoney } from "./ui";

const OpenProfile = createContext<(handle: string) => void>(() => {});
export function PlayerLink({ handle, children }: { handle: string; children?: ReactNode }) {
  const open = useContext(OpenProfile);
  return <button className="player-link" onClick={() => open(handle)} aria-label={`View @${handle}'s profile`}>{children ?? `@${handle}`}</button>;
}
export function Profiles({ children }: { children: ReactNode }) {
  const state = useGame();
  const [handle, setHandle] = useState<string | null>(() => new URLSearchParams(location.search).get("player"));
  const [stats, setStats] = useState<Lifetime | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    setStats(null); setError("");
    if (!handle) return;
    let live = true;
    game.api.rpc<Lifetime>("lifetime_stats", { p_handle: handle }).then(data => {
      // Older servers return your own stats for an unknown handle. Never show those as someone else's.
      if (data.handle.toLowerCase() !== handle.toLowerCase()) throw new Error("Player not found.");
      if (live) setStats(data);
    }).catch(e => { if (live) setError((e as Error).message); });
    return () => { live = false; };
  }, [handle, attempt]);
  const close = () => { setHandle(null); const url = new URL(location.href); url.searchParams.delete("player"); history.replaceState(null, "", url); };
  return <OpenProfile.Provider value={setHandle}>{children}
    <Sheet open={!!handle} onClose={close}>
      <div className="stack" data-testid="player-profile">
        <div className="row between"><h3 className="h3">@{handle}</h3><button className="text-action lime" onClick={close}>Done</button></div>
        <div className="muted">Paper trading profile · lifetime stats</div>
        {error ? <div className="err" role="alert">{error}<button className="text-action lime" onClick={() => setAttempt(x => x + 1)}>Try again</button></div>
          : !stats ? <span className="spinner lime" aria-label="Loading profile" /> : <>
          {handle?.toLowerCase() === state.me?.handle.toLowerCase() && <SelfRightNow />}
          <div className="profile-stats">{[["Trades", stats.total_trades], ["Win rate", stats.win_rate == null ? "—" : `${stats.win_rate}%`], ["Best trade", stats.best_trade == null ? "—" : signedMoney(stats.best_trade)]].map(([label, value]) => <div className="panel" key={label}><div className="eyebrow">{label}</div><b>{value}</b></div>)}</div>
          <div className="detail"><span>Seasons played</span><span>{stats.seasons_played}</span></div>
          <div className="detail"><span>Target badges</span><span>{stats.seasons_funded}</span></div>
          <div className="detail"><span>Max drawdown</span><span>{Number(stats.max_drawdown).toFixed(1)}%</span></div>
          <div className="season-results">{stats.seasons.map(s => <div className="detail" key={s.season}><span>Season {s.number}</span><span className={s.return_pct >= 0 ? "lime" : "red"}>{s.return_pct >= 0 ? "+" : ""}{Number(s.return_pct).toFixed(2)}%</span></div>)}</div>
        </>}
      </div>
    </Sheet>
  </OpenProfile.Provider>;
}

function SelfRightNow() {
  const me = useGame().me;
  if (!me) return null;
  const unrealized = me.positions.reduce((total, p) => {
    const quote = game.quote(p.market);
    return total + (quote ? pnlOf(p, quote.price) : 0);
  }, 0);
  const equity = me.cash + unrealized;
  return <section className="profile-now" aria-label="Right now">
    <div className="row between"><h4 className="h2">Right now</h4><span className="chip-status">{me.rules?.funded ? "🏆 FUNDED" : me.rules?.status === "blown" ? "💀 REKT" : me.rules?.status === "locked" ? "🔒 LOCKED" : "IN PLAY"}</span></div>
    <div className="profile-now-grid">
      <div><span>Equity</span><b>{money(equity)}</b></div>
      <div><span>Open P&amp;L</span><b className={unrealized >= 0 ? "lime" : "red"}>{signedMoney(unrealized)}</b></div>
      <div><span>Positions</span><b>{me.positions.length}</b></div>
    </div>
    <div className="profile-exits">
      <div className="eyebrow">Recent exits</div>
      {me.trades.slice(0, 3).map(t => <div className="detail" key={t.id}><span>{MARKETS[t.market as Market].title} · {t.side} · {t.quantity}</span><b className={t.pnl >= 0 ? "lime" : "red"}>{signedMoney(t.pnl)}</b></div>)}
      {me.trades.length === 0 && <div className="muted" style={{ fontSize: 12 }}>No exits yet. The story is still loading.</div>}
    </div>
  </section>;
}
