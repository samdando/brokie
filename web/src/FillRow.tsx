import { useState } from "react";
import { Avatar } from "./Avatar";
import { PlayerLink } from "./Profiles";
import type { FillGroup } from "./tradeActivity";
import { MARKETS, digits, marketTitle } from "./types";
import { px, signedMoney } from "./ui";

const valid = (at: string) => Number.isFinite(Date.parse(at));
const day = (at: string) => valid(at) ? new Date(at).toLocaleDateString([], { month:"short", day:"numeric" }) : "Time unavailable";
const clock = (at: string) => valid(at) ? new Date(at).toLocaleTimeString([], { hour:"numeric", minute:"2-digit" }) : "—";
export function FillRow({ group, quote, onReview, testId="tape-trade", showMarket=false }: {
  group: FillGroup; quote: number|null; onReview?: (id:string)=>void; testId?:string; showMarket?:boolean;
}) {
  const [expanded,setExpanded]=useState(false);
  const b=group.fills[0], closed=b.state === "closed", d=digits(group.market), end=closed?b.exit_price:quote;
  const result=closed ? group.fills.every(f=>f.pnl!==null)?group.fills.reduce((n,f)=>n+f.pnl!,0):null : end==null?null:(end-b.entry_price)*group.quantity*MARKETS[group.market].pointValue*(b.side === "long"?1:-1);
  const tone=result==null?"muted":result>=0?"lime":"red", up=end!=null && end>=b.entry_price;
  const title=b.prediction_question??marketTitle(group.market), side=b.prediction_outcome?.toUpperCase()??b.side;
  const details=()=>{if(onReview&&group.fills.length===1)onReview(b.id);else setExpanded(v=>!v);};
  return <article className={`fill-row ${showMarket?"club-receipt":"club-play"} ${expanded?"expanded":""}`} data-testid={testId} data-trade-id={b.id} data-fill-count={group.fills.length}>
    <div className="fill-heading">
      {!showMarket && <Avatar handle={b.handle}/>}
      <div className="fill-identity"><b>{showMarket?title:b.is_you?"You":<PlayerLink handle={b.handle}>{b.handle}</PlayerLink>}</b><span>{!showMarket&&`${title} · `}{side} ×{group.quantity}</span></div>
      <span className="club-fill-state">{showMarket?day(b.at):closed?"CLOSED":"OPEN"}</span>
    </div>
    <div className="club-fill-ticket">
      <div className="club-fill-result"><strong className={tone}>{result==null?"—":signedMoney(result)}</strong>{!showMarket&&<small>{closed?"Final result":"Unrealised"}</small>}</div>
      <div className="fill-prices"><span><small>{showMarket?`IN · ${clock(b.opened_at)}`:"Entry"}</small><b>{px(b.entry_price,d)}</b></span>
        <svg viewBox="0 0 100 33" role="img" aria-label={`Entry connected to ${closed?"exit":"current price"}`} className={tone}><line x1="5" y1={up?26:7} x2="95" y2={up?7:26} stroke="currentColor" strokeWidth="2" strokeDasharray={closed?undefined:"4 4"}/><circle cx="5" cy={up?26:7} r="3.5" fill="currentColor"/><circle cx="95" cy={up?7:26} r="3.5" fill="currentColor"/></svg>
        <span><small>{showMarket?`OUT · ${clock(b.at)}`:closed?"Exit":"Price now"}</small><b>{end==null?"—":px(end,d)}</b></span>
      </div>
    </div>
    <div className="fill-footer"><span>{showMarket ? group.fills.length>1?`${group.fills.length} fills · closed together`:b.reason?.replace(/_/g," ")??"Closed" : `${day(b.opened_at)} · ${clock(b.opened_at)} → ${closed?clock(b.at):"now"}`}</span><button type="button" onClick={details} aria-expanded={onReview&&group.fills.length===1?undefined:expanded} aria-label={onReview&&group.fills.length===1?`Review ${title} trade`:`${expanded?"Hide":"Show"} ${group.fills.length} fill${group.fills.length===1?"":"s"}`}>{expanded?"Hide":showMarket?"View receipt":group.fills.length>1?`${group.fills.length} fills`:"Details"} <span aria-hidden="true">↗</span></button></div>
    {expanded&&<div className="fill-breakdown" data-testid="fill-breakdown">{group.fills.map(f=><div key={f.id} data-trade-id={f.id}><span>×{f.quantity} · {px(f.entry_price,d)} → {f.exit_price==null?"Open":px(f.exit_price,d)}<time>{day(f.opened_at)} · {clock(f.opened_at)}{f.state === "closed"?` → ${clock(f.at)}`:""}</time></span><b className={f.pnl==null?"muted":f.pnl>=0?"lime":"red"}>{f.pnl==null?"Open":signedMoney(f.pnl)}</b>{onReview&&<button type="button" onClick={()=>onReview(f.id)}>Review ↗</button>}</div>)}<small>{b.reason?.replace(/_/g," ")}</small></div>}
  </article>;
}
