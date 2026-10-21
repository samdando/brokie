import { createContext, ReactNode, useContext, useEffect, useState } from "react";
import { game } from "./game";
import type { Lifetime } from "./types";
import { Sheet, signedMoney } from "./ui";

const OpenProfile = createContext<(handle: string) => void>(() => {});
export function PlayerLink({ handle, children }: { handle: string; children?: ReactNode }) {
  const open = useContext(OpenProfile);
  return <button className="player-link" onClick={() => open(handle)} aria-label={`View @${handle}'s profile`}>{children ?? `@${handle}`}</button>;
}
export function Profiles({ children }: { children: ReactNode }) {
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
