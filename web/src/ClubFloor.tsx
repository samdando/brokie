import { useEffect, useState } from "react";
import { Avatar } from "./Avatar";
import { BackendError } from "./api";
import { FillRow } from "./FillRow";
import { game, useGame } from "./game";
import { ChatCard } from "./Social";
import { SquadScreen, SquadStarter } from "./Squad";
import { accountBubbles, groupFills } from "./tradeActivity";
import { type Bubble, type Market } from "./types";
import { Sheet } from "./ui";

export type FloorView = "trades" | "chat" | "board";
const markets: Market[] = ["gold","nas","es","us30","btc","eth","sol"];
type MarketBubble = Bubble & { market: Market };
const cache = new Map<string, MarketBubble[]>();

/** Fetch each authorized market without changing the player's selected market.
 * Each response stays in its account/season/squad scope. A partial outage keeps
 * confirmed fills and the account's own current positions available. */
function useFloorTrades(enabled: boolean) {
  const st = useGame(), me = st.me!;
  const squad = game.squad?.id ?? null;
  const scope = `${me.handle}:${me.season}:${squad ?? ""}`;
  const [loaded, setLoaded] = useState<{ scope: string; rows: MarketBubble[] }>(() => ({ scope, rows: cache.get(scope) ?? [] }));
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let live = true, busy = false;
    setError("");
    const load = async () => {
      if (busy || document.hidden) return;
      busy = true;
      const result = await Promise.allSettled(markets.map(async market => {
        let rows: Bubble[];
        try { rows = await game.api.rpc<Bubble[]>("chart_bubbles", { p_market:market, p_squad:squad, p_from:new Date(0).toISOString() }); }
        catch(e) {
          if (!(e instanceof BackendError) || e.code !== "PGRST202") throw e;
          rows = await game.api.rpc<Bubble[]>("chart_bubbles", { p_market:market, p_squad:squad });
        }
        if (!Array.isArray(rows)) throw new Error("Invalid trade response");
        return rows.map(b => ({ ...b, market }));
      }));
      busy = false;
      if (!live) return;
      const previous = cache.get(scope) ?? [];
      const rows = result.flatMap((r,i) => r.status === "fulfilled" ? r.value : previous.filter(b => b.market === markets[i]));
      cache.set(scope, rows); setLoaded({ scope, rows });
      setError(result.some(r => r.status === "rejected") ? "Some market trades couldn’t refresh. Showing confirmed fills." : "");
    };
    void load();
    const timer = setInterval(load, 10_000);
    return () => { live = false; clearInterval(timer); };
  }, [scope, squad, enabled, refresh]);
  const social = loaded.scope === scope ? loaded.rows : cache.get(scope) ?? [];
  const groups = markets.flatMap(market => {
    const recent = st.bubbleScope === `${market}:${squad ?? ""}` ? st.bubbles : [];
    const merged = new Map([...social.filter(b => b.market === market), ...recent].map(b => [`${b.state}:${b.id}`,b]));
    return groupFills(accountBubbles(me,market,[...merged.values()]),market);
  }).sort((a,b) => Date.parse(b.fills[0].at)-Date.parse(a.fills[0].at));
  return { groups, error, retry: () => setRefresh(v => v+1) };
}

export function ClubFloor({ view, onView, toast }: { view: FloorView; onView: (view: FloorView) => void; toast: (m: string) => void }) {
  const st = useGame(), squad = game.squad;
  const [manage, setManage] = useState(false);
  const { groups, error, retry } = useFloorTrades(view === "trades");
  useEffect(() => { void game.refreshBoard(); }, [st.squadId]);
  return <div className="club-floor" data-testid="club-floor">
    <div className="club-floor-title"><h1 className="club-page-title">Your people.<br/>Their plays.</h1><button type="button" className="club-round-control" aria-label="Squad and voice options" onClick={() => setManage(true)}>⋯</button></div>
    <p className="club-page-sub">{squad ? `${squad.name} · entries, exits, and everything between.` : "Same market. Better company."}</p>
    {squad && <div className="club-squad-row"><div className="club-faces">{st.leaderboard.slice(0,5).map(p => <Avatar key={p.handle} handle={p.handle}/>)}{!st.leaderboard.length && <Avatar handle={st.me!.handle}/>}</div><span>{squad.member_count} squad {squad.member_count === 1 ? "member" : "members"}</span></div>}
    {st.squads.length > 1 && <div className="hscroll club-squad-picker">{st.squads.map(s => <button key={s.id} type="button" aria-pressed={s.id === st.squadId} onClick={() => game.selectSquad(s.id)}>{s.name}</button>)}</div>}
    <div className="club-local-tabs" role="tablist" aria-label="The floor">
      {([ ["trades","Trades"], ["chat","Chat"], ["board","Leaderboard"] ] as const).map(([key,label]) => <button key={key} type="button" role="tab" aria-selected={view === key} onClick={() => onView(key)} data-testid={`floor-${key}`}>{label}{key === "chat" && st.chatUnread > 0 && <i>{st.chatUnread > 9 ? "9+" : st.chatUnread}</i>}</button>)}
    </div>
    {!squad ? <SquadStarter/> : view === "chat" ? <div className="club-chat" data-testid="chat-page"><ChatCard key={squad.id}/></div> : view === "board" ? <div className="club-board"><SquadScreen toast={toast}/></div> : <section className="club-plays" aria-label="Squad entries and exits">
      {error && <button className="trade-load-error" type="button" role="status" onClick={retry}>{error} Tap to retry.</button>}
      {groups.length ? groups.map(group => <FillRow key={group.key} group={group} quote={game.quote(group.market)?.price ?? null}/>) : <div className="club-empty"><b>The floor’s yours.</b><p>New entries and exits appear here when your squad trades.</p></div>}
    </section>}
    <Sheet open={manage} onClose={() => setManage(false)}><div className="club-squad-options"><div className="row between"><h2 className="h2">Squad & voice</h2><button className="text-action" onClick={() => setManage(false)}>Done</button></div><SquadScreen toast={toast}/></div></Sheet>
  </div>;
}
