import { useEffect, useRef, useState } from "react";
import { Avatar } from "./Avatar";
import { game, useGame } from "./game";
import { haptic } from "./effects";
import { MARKETS, type Market } from "./types";
import { Sheet, ago, signedMoney } from "./ui";

/** Activity is evidence of trading, not an invented online-presence count. */
export function FloorPresence({ market, showMarkers, onMarkers, onSquad, toast }: {
  market: Market; showMarkers: boolean; onMarkers: () => void; onSquad: () => void; toast: (text: string) => void;
}) {
  const st = useGame(), squad = game.squad;
  const [open, setOpen] = useState(false), [reactions, setReactions] = useState(false);
  const [busy, setBusy] = useState(false), [sent, setSent] = useState<string | null>(null);
  const revision = useRef(0);
  useEffect(() => { revision.current++; setOpen(false); setReactions(false); setSent(null); setBusy(false); return ()=>{revision.current++;}; }, [st.squadId]);
  useEffect(() => { if (!sent) return; const timer = setTimeout(() => setSent(null), 1800); return () => clearTimeout(timer); }, [sent]);
  const scoped = st.bubbleScope === `${market}:${squad?.id ?? ""}`;
  const holding = new Set(scoped ? st.bubbles.filter(b => b.state === "open" && !b.is_you).map(b => b.handle) : []);
  const mates = [...new Set([...holding, ...st.leaderboard.filter(p => !p.is_you).map(p => p.handle)])];
  const activity = [...st.feed].sort((a,b) => Date.parse(b.at)-Date.parse(a.at)).slice(0,12);
  const last = activity[0];
  async function react(symbol: string) {
    if (busy || !squad) return;
    const request = revision.current; setBusy(true);
    const error = await game.sendMessage(symbol,"emoji");
    if (request !== revision.current) return;
    setBusy(false);
    if (error) { toast(error); return; }
    haptic(8); setSent(symbol); setReactions(false);
  }
  if (!squad) return <button type="button" className="floor-invite" onClick={onSquad} data-testid="floor-invite"><span className="floor-invite-symbol" aria-hidden="true">＋</span><span><b>Better with your mates</b><small>Create a squad or join theirs</small></span><span aria-hidden="true">↗</span></button>;
  return <>
    <div className="floor-presence" data-testid="floor-presence">
      <button type="button" className="floor-mates" onClick={() => setOpen(true)} aria-label={`Open ${squad.name} activity`} data-testid="floor-activity-open">
        <span className="floor-faces" aria-hidden="true">{mates.slice(0,3).map(handle => <span key={handle} className={holding.has(handle) ? "holding" : ""}><Avatar handle={handle}/></span>)}{!mates.length && <Avatar handle={st.me!.handle}/>}</span>
        <span className="floor-presence-copy"><b>{squad.name}</b><small>{sent ? `Sent ${sent}` : holding.size ? `${holding.size} ${holding.size === 1 ? "mate trading" : "mates trading"} ${MARKETS[market].title}` : last ? `@${last.handle} ${last.kind === "opened" ? `went ${last.side}` : last.kind === "closed" ? "closed a trade" : "has a new update"}` : "Your next setup, together"}</small></span>
        <span className="floor-more" aria-hidden="true">⌄</span>
      </button>
      <button type="button" className="floor-marker-toggle" aria-label={showMarkers ? "Hide squad trades on the chart" : "Show squad trades on the chart"} aria-pressed={showMarkers} onClick={onMarkers} data-testid="crowd-toggle"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><circle cx="9" cy="8" r="3"/><path d="M3 20v-2a6 6 0 0 1 12 0v2M17 5a3 3 0 0 1 0 6m1 3a5 5 0 0 1 3 4v2"/></svg></button>
      <button type="button" className="floor-react" aria-label="Quick squad reaction" aria-expanded={reactions} onClick={() => setReactions(v=>!v)} data-testid="floor-react"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M8 14a4.5 4.5 0 0 0 8 0M8 9h1m6 0h1"/></svg></button>
      {reactions && <div className="floor-reaction-picker" role="group" aria-label="Quick reactions">{["👀","🔥","🫡"].map(symbol=><button type="button" key={symbol} aria-label={`React ${symbol} to squad`} disabled={busy} onClick={()=>void react(symbol)}>{symbol}</button>)}</div>}
      {sent && <span className="sr-only" role="status">Reaction {sent} sent to your squad</span>}
    </div>
    <Sheet open={open} onClose={()=>setOpen(false)}><div className="floor-activity stack" data-testid="floor-activity">
      <div className="row between"><div><span className="eyebrow">Trading together</span><h2 className="h2">{squad.name}</h2></div><button type="button" className="text-action" onClick={()=>setOpen(false)}>Done</button></div>
      <p className="muted floor-activity-intro">The latest from your mates. Your chart stays right here.</p>
      {activity.length ? <div className="floor-activity-list">{activity.map(item=><div key={`${item.kind}:${item.id}`} className="floor-activity-item"><Avatar handle={item.handle}/><div><b>{item.is_you ? "You" : `@${item.handle}`}</b><span>{item.kind === "opened" ? <>Opened <em className={item.side === "long" ? "lime" : "red"}>{item.side === "long" ? "↑ Long" : "↓ Short"}</em> · {item.quantity} {MARKETS[item.market].title}</> : item.kind === "closed" ? <>Closed {MARKETS[item.market].title}{item.pnl !== null && <em className={item.pnl >= 0 ? "lime" : "red"}> · {signedMoney(item.pnl)}</em>}</> : item.kind === "funded" ? "Reached funded status" : "Account drawdown limit reached"}</span></div><small>{ago(item.at,game.now())}</small></div>)}</div> : <div className="floor-empty"><span aria-hidden="true">↗</span><b>Someone has to make the first move.</b><p>New entries and closes will show up here when your squad trades.</p></div>}
      {!!st.chat.length && <div className="floor-last-message"><Avatar handle={st.chat[st.chat.length-1].handle}/><span><b>@{st.chat[st.chat.length-1].handle}</b><small>{st.chat[st.chat.length-1].body}</small></span></div>}
      <div className="floor-sheet-reactions" role="group" aria-label="React to your squad">{["👀","🔥","🫡"].map(symbol=><button type="button" key={symbol} disabled={busy} onClick={()=>void react(symbol)} aria-label={`React ${symbol} in activity`}>{symbol}</button>)}<small>{sent ? `${sent} Sent to squad` : "A quick nod to the squad"}</small></div>
      <button type="button" className="text-action" onClick={()=>{setOpen(false);onSquad();}}>Open squad ↗</button>
    </div></Sheet>
  </>;
}
