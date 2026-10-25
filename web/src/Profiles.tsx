import { createContext, ReactNode, useContext, useEffect, useState } from "react";
import { game, useGame } from "./game";
import type { Bubble, Lifetime, Market } from "./types";
import { MARKETS, direction } from "./types";
import { Sheet, TickValue, ago, money, px, signedMoney } from "./ui";

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
      <div className="stack player-card" data-testid="player-profile">
        <div className="row between player-card-heading"><div><span className="eyebrow">BROKIE / PLAYER CARD</span><h3 className="h3">@{handle}</h3></div><button className="text-action lime" onClick={close}>Done</button></div>
        {handle && <LiveNow handle={handle} />}
        <div className="eyebrow" style={{ marginTop: 6 }}>Lifetime</div>
        {error ? <div className="err" role="alert">{error}<button className="text-action lime" onClick={() => setAttempt(x => x + 1)}>Try again</button></div>
          : !stats ? <span className="spinner lime" aria-label="Loading profile" /> : <>
          <div className="profile-stats">{[["Trades", stats.total_trades], ["Win rate", stats.win_rate == null ? "—" : `${stats.win_rate}%`], ["Best trade", stats.best_trade == null ? "—" : signedMoney(stats.best_trade)]].map(([label, value]) => <div className="panel" key={label}><div className="eyebrow">{label}</div><b>{value}</b></div>)}</div>
          <div className="detail"><span>Seasons played</span><span>{stats.seasons_played}</span></div>
          <div className="detail"><span>Seasons funded</span><span>{stats.seasons_funded}</span></div>
          <div className="detail"><span>Max drawdown</span><span>{Number(stats.max_drawdown).toFixed(1)}%</span></div>
          <div className="season-results">{stats.seasons.map(s => <div className="detail" key={s.season}><span>Season {s.number}</span><span className={s.return_pct >= 0 ? "lime" : "red"}>{s.return_pct >= 0 ? "+" : ""}{Number(s.return_pct).toFixed(2)}%</span></div>)}</div>
        </>}
      </div>
    </Sheet>
  </OpenProfile.Provider>;
}

/** What a squad mate is doing right now: season equity and return, open positions with live P&L,
 *  and their exits from the last 24 hours. Refreshes every 5 s while the profile is open. */
function LiveNow({ handle }: { handle: string }) {
  const st = useGame();
  const [legs, setLegs] = useState<{ m: Market; b: Bubble }[] | null>(null);
  useEffect(() => {
    let live = true;
    const load = async () => {
      const squad = game.squad?.id ?? null;
      const all = await Promise.all((Object.keys(MARKETS) as Market[]).map((m) =>
        game.api.rpc<Bubble[]>("chart_bubbles", { p_market: m, p_squad: squad }).then((r) => (r ?? []).map((b) => ({ m, b }))).catch(() => [])));
      if (live) setLegs(all.flat().filter((x) => x.b.handle.toLowerCase() === handle.toLowerCase()));
    };
    void load();
    const t = setInterval(() => { if (!document.hidden) void load(); }, 5000);
    return () => { live = false; clearInterval(t); };
  }, [handle]);
  const row = st.leaderboard.find((r) => r.handle.toLowerCase() === handle.toLowerCase());
  // One line per market + side, like your own position cards (spam taps merged).
  const open = new Map<string, { m: Market; side: Bubble["side"]; qty: number; cost: number; b: Bubble; key: string }>();
  for (const { m, b } of legs ?? []) if (b.state === "open") {
    const k = `${m}|${b.side}|${b.prediction_id ?? ""}|${b.prediction_outcome ?? ""}`; const cur = open.get(k) ?? { m, side: b.side, qty: 0, cost: 0, b, key: k };
    cur.qty += b.quantity; cur.cost += b.entry_price * b.quantity; open.set(k, cur);
  }
  const rows = [...open.values()].map((o) => {
    const entry = o.cost / Math.max(1, o.qty); const q = o.m === "prediction" ? o.b.mark_price : game.quote(o.m)?.price;
    return { ...o, entry, pnl: q == null ? null : (q - entry) * MARKETS[o.m].pointValue * o.qty * direction(o.side) };
  });
  const openPnl = rows.reduce((s, r) => s + (r.pnl ?? 0), 0);
  const exits = (legs ?? []).filter((x) => x.b.state === "closed").sort((a, b) => Date.parse(b.b.at) - Date.parse(a.b.at)).slice(0, 5);
  if (!row && legs && legs.length === 0) return <div className="muted" style={{ fontSize: 12 }}>Live positions show for players in your squad.</div>;
  return (
    <div className={`stack player-live ${row?.status === "blown" ? "rekt" : ""}`} style={{ gap: 10 }} data-testid="profile-live">
      <div className="row between"><div className="eyebrow">◉ Right now</div><span className="player-state">{row?.status === "blown" ? "💀 REKT" : row?.status === "locked" ? "🔒 LOCKED" : row?.funded ? "🏆 FUNDED" : row?.target_hit ? "🎯 TARGET HIT" : "IN THE GAME"}</span></div>
      <div className="profile-stats three">
        <div className="panel"><div className="eyebrow">Equity</div><b><TickValue value={row?.equity ?? null}>{row ? money(row.equity, 0) : "—"}</TickValue></b></div>
        <div className="panel"><div className="eyebrow">Season</div><b className={row && row.return_pct < 0 ? "red" : "lime"}>{row ? `${row.return_pct >= 0 ? "+" : ""}${Number(row.return_pct).toFixed(2)}%` : "—"}</b></div>
        <div className="panel"><div className="eyebrow">Open P&amp;L</div><b className={openPnl < 0 ? "red" : "lime"} data-testid="profile-open-pnl"><TickValue value={openPnl}>{rows.length ? signedMoney(openPnl) : "—"}</TickValue></b></div>
      </div>
      {legs === null ? <span className="spinner lime" aria-label="Loading positions" />
        : rows.length === 0 ? <div className="muted" style={{ fontSize: 12 }}>No open positions.</div>
        : rows.map((r) => (
          <div className="detail" key={r.key} data-testid="profile-position">
            <span><b>{r.b.prediction_question ?? MARKETS[r.m].title}</b> <span className={r.side === "long" ? "lime" : "red"}>{r.b.prediction_outcome?.toUpperCase() ?? (r.side === "long" ? "LONG ↗" : "SHORT ↘")}</span> <span className="muted mono" style={{ fontSize: 11 }}>{r.qty} {r.m === "prediction" ? "shares" : "micros"} · {px(r.entry)}</span></span>
            <b className={`mono ${(r.pnl ?? 0) < 0 ? "red" : "lime"}`}>{r.pnl == null ? "—" : signedMoney(r.pnl)}</b>
          </div>
        ))}
      {exits.length > 0 && <>
        <div className="eyebrow" style={{ marginTop: 4 }}>Recent exits</div>
        {exits.map(({ m, b }) => (
          <div className="detail" key={b.id} data-testid="profile-exit">
            <span>{b.reason === "blown" ? "💀 Blown out of" : "Closed"} {b.prediction_outcome?.toUpperCase() ?? b.side} {b.quantity} {b.prediction_question ?? MARKETS[m].title} <span className="muted mono" style={{ fontSize: 11 }}>@ {px(b.exit_price ?? b.entry_price)} · {ago(b.at)}</span></span>
            <b className={`mono ${(b.pnl ?? 0) < 0 ? "red" : "lime"}`}>{signedMoney(b.pnl ?? 0)}</b>
          </div>
        ))}
      </>}
    </div>
  );
}
