import { useState } from "react";
import { Avatar } from "./Avatar";
import { PlayerLink } from "./Profiles";
import { type FillGroup } from "./tradeActivity";
import { MARKETS, digits } from "./types";
import { px, signedMoney } from "./ui";

const stamp = (at: string) => Number.isFinite(Date.parse(at))
  ? new Date(at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "Time unavailable";
const clock = (at: string) => Number.isFinite(Date.parse(at))
  ? new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "—";

export function FillRow({ group, quote, onReview, testId = "tape-trade", showMarket = false }: {
  group: FillGroup; quote: number | null; onReview?: (id: string) => void; testId?: string; showMarket?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const b = group.fills[0], closed = b.state === "closed", d = digits(group.market);
  const end = closed ? b.exit_price : quote;
  const result = closed
    ? group.fills.every(f => f.pnl !== null) ? group.fills.reduce((n,f) => n + f.pnl!, 0) : null
    : end == null ? null : (end - b.entry_price) * MARKETS[group.market].pointValue * group.quantity * (b.side === "long" ? 1 : -1);
  const tone = result == null ? "muted" : result >= 0 ? "lime" : "red";
  const action = () => { if (onReview && group.fills.length === 1) onReview(b.id); else setExpanded(v => !v); };
  return <article className={`fill-row ${expanded ? "expanded" : ""}`} data-testid={testId} data-trade-id={b.id} data-fill-count={group.fills.length}>
    <div className="fill-heading">
      {!showMarket && <Avatar handle={b.handle} />}
      <div className="fill-identity"><b>{showMarket ? b.prediction_question ?? MARKETS[group.market].title : b.is_you ? "You" : <PlayerLink handle={b.handle}>@{b.handle}</PlayerLink>}</b><span><i className={b.side === "long" ? "lime" : "red"}>{b.prediction_outcome?.toUpperCase() ?? (b.side === "long" ? "↑ Long" : "↓ Short")}</i><span>×{group.quantity}</span>{!closed && <em className="fill-live">LIVE</em>}</span></div>
      <strong className={`fill-result ${tone}`}>{result == null ? "—" : signedMoney(result)}</strong>
      <button type="button" className="fill-disclosure" onClick={action} aria-expanded={onReview && group.fills.length === 1 ? undefined : expanded} aria-label={onReview && group.fills.length === 1 ? `Review ${MARKETS[group.market].title} trade` : `${expanded ? "Hide" : "Show"} ${group.fills.length} fill${group.fills.length === 1 ? "" : "s"}`}><span aria-hidden="true">{expanded ? "−" : "↗"}</span></button>
    </div>
    <div className="fill-prices"><span><small>Entry</small><b>{px(b.entry_price, d)}</b></span><svg viewBox="0 0 100 14" preserveAspectRatio="none" role="img" aria-label={`Entry to ${closed ? "exit" : "live price"}`} className={tone}><line x1="5" y1="7" x2="95" y2="7" stroke="currentColor" strokeWidth="1.5" strokeDasharray={closed ? undefined : "4 4"}/><circle cx="5" cy="7" r="3" fill="currentColor"/><circle cx="95" cy="7" r="3" fill={closed ? "currentColor" : "var(--bg)"} stroke="currentColor"/></svg><span><small>{closed ? "Exit · closed" : "Now · open"}</small><b>{end == null ? "—" : px(end,d)}</b></span></div>
    <div className="fill-footer"><time dateTime={b.opened_at || undefined}>{stamp(b.opened_at)}</time><span>{closed ? `→ ${clock(b.at)}` : "Still open"}</span>{group.fills.length > 1 && <button type="button" onClick={() => setExpanded(v => !v)} aria-expanded={expanded}>{group.fills.length} fills ⌄</button>}{closed && b.reason && b.reason !== "closed" && <span className="fill-reason">{b.reason.replace(/_/g," ")}</span>}</div>
    {expanded && <div className="fill-breakdown" data-testid="fill-breakdown">{group.fills.map(f => <div key={f.id} data-trade-id={f.id}><span>×{f.quantity} · {px(f.entry_price,d)} → {f.exit_price == null ? "Open" : px(f.exit_price,d)}<time>{stamp(f.opened_at)}{f.state === "closed" ? ` → ${clock(f.at)}` : ""}</time></span><b className={f.pnl == null ? "muted" : f.pnl >= 0 ? "lime" : "red"}>{f.pnl == null ? "Open" : signedMoney(f.pnl)}</b>{onReview && <button type="button" onClick={() => onReview(f.id)}>Review ↗</button>}</div>)}</div>}
  </article>;
}
