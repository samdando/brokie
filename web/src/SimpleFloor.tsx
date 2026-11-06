import type { ReactNode } from "react";
import { Avatar } from "./Avatar";
import { groupFills } from "./tradeActivity";
import { MARKETS, digits, pnlOf, type Bubble, type Market, type Position } from "./types";
import { ago, px, signedMoney } from "./ui";

/** Clubhouse keeps the position, its exit, and the next order together. */
export function SimpleFloor({ market, quote, positions, bubbles, orderPad, closing, busy, onClose, onProtect, onFloor, error, onRetry }: {
  market: Market; quote: number | null; positions: Position[]; bubbles: Bubble[]; orderPad: ReactNode;
  closing: string | null; busy: boolean; onClose: (p: Position) => void; onProtect: (p: Position) => void;
  onFloor: () => void; error: string | null; onRetry: () => void;
}) {
  const d = digits(market), recent = groupFills(bubbles,market).slice(0,3);
  return <div className="simple-floor club-trade-flow" data-testid="simple-floor">
    <section className="price-positions" aria-label="Your open position">
      {positions.length ? positions.map(p => {
        const pnl = quote == null ? null : pnlOf(p,quote), delta = quote == null ? null : quote-p.entry_price;
        return <article key={p.id} className="price-position club-position" data-testid="price-position">
          <div className="club-position-head"><b>{p.side === "long" ? "↗" : "↘"} Your {p.side} <span>×{p.quantity}</span></b><small>OPEN</small></div>
          <strong className={`club-position-result ${pnl !== null && pnl < 0 ? "loss" : ""}`} data-testid="position-pnl">{pnl == null ? "—" : signedMoney(pnl)}</strong>
          <span className="price-relation">{delta == null ? "Waiting for a fresh price" : delta === 0 ? "Price is at your entry" : `Price is ${delta > 0 ? "above" : "below"} your entry · ${px(Math.abs(delta),d)} pts`}</span>
          <div className="entry-comparison"><span><small>Your entry</small><b>{px(p.entry_price,d)}</b></span><svg viewBox="0 0 100 16" role="img" aria-label="Your entry connected to the current price"><line x1="5" y1="8" x2="95" y2="8" stroke="currentColor" strokeDasharray="3 3"/><circle cx="5" cy="8" r="3" fill="currentColor"/><circle cx="95" cy="8" r="3" fill="currentColor"/></svg><span><small>Price now</small><b>{quote == null ? "—" : px(quote,d)}</b></span></div>
          <div className="club-position-actions"><button type="button" disabled={busy} onClick={() => onProtect(p)} aria-label={`Stop and target for ${p.side} ${MARKETS[p.market].title}`}>Stop & target</button><button type="button" disabled={busy} onClick={() => onClose(p)} data-testid="close-position" aria-label={`Close ${p.side} ${MARKETS[p.market].title} position`}>{closing ? "Closing…" : "Close position"}</button></div>
        </article>;
      }) : <div className="flat-price"><span aria-hidden="true">◌</span><span>You’re flat. Make your move.</span></div>}
    </section>
    {orderPad}
    <section className="club-floor-peek" aria-label="Recent market activity">
      <div className="club-section-heading"><h2>The group’s moving.</h2><button type="button" onClick={onFloor}>See all <span aria-hidden="true">↗</span></button></div>
      {error && <button type="button" className="trade-load-error" onClick={onRetry} role="status">{error} Tap to retry.</button>}
      {recent.length ? recent.map(group => {
        const b=group.fills[0], closed=b.state === "closed", pnl=closed ? group.fills.reduce((sum,b)=>sum+(b.pnl??0),0) : null;
        return <button type="button" className="club-activity-line" key={group.key} onClick={onFloor} data-testid="activity-preview"><Avatar handle={b.handle}/><span><b>{b.is_you ? "You" : b.handle} {closed ? `closed a ${b.side}` : `went ${b.side}`}</b><small>{closed ? `${px(b.entry_price,d)} → ${px(b.exit_price!,d)}` : `${MARKETS[market].title} · ${group.quantity} micros`} · {ago(b.at)}</small></span><strong className={pnl != null && pnl < 0 ? "red" : "lime"}>{closed ? signedMoney(pnl!) : "OPEN"}</strong></button>;
      }) : <button type="button" className="club-empty-preview" onClick={onFloor}>Bring your mates to the floor <span aria-hidden="true">↗</span></button>}
    </section>
  </div>;
}
