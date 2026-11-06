import { Avatar } from "./Avatar";
import { PlayerLink } from "./Profiles";
import { MARKETS, digits, pnlOf, type Bubble, type Market, type Position } from "./types";
import { px, signedMoney } from "./ui";

const time = (at: string) => Number.isFinite(Date.parse(at))
  ? new Date(at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "Time unavailable";

/** A price comparison and trade tape, with no chart gestures. */
export function SimpleFloor({ market, quote, positions, bubbles, onPositions, onExpand, error, onRetry }: {
  market: Market; quote: number | null; positions: Position[]; bubbles: Bubble[];
  onPositions: () => void; onExpand: () => void; error: string | null; onRetry: () => void;
}) {
  const d = digits(market);
  return <div className="simple-floor" data-testid="simple-floor">
    <section className="price-positions" aria-label="Your entries against the current price">
      {positions.length ? positions.map(p => {
        const delta = quote == null ? null : quote - p.entry_price;
        const pnl = quote == null ? null : pnlOf(p, quote);
        const relation = delta === null ? "Waiting for price" : delta === 0 ? "Price is at your entry" : `Price is ${delta > 0 ? "above" : "below"} your entry`;
        return <button type="button" className="price-position" key={p.id} onClick={onPositions} data-testid="price-position">
          <span className="row between"><b>{p.side === "long" ? "↑ Long" : "↓ Short"} ×{p.quantity}</b><strong className={pnl == null ? "muted" : pnl >= 0 ? "lime" : "red"}>{pnl == null ? "—" : signedMoney(pnl)}</strong></span>
          <span className="entry-comparison"><span><small>Your entry</small><b>{px(p.entry_price, d)}</b></span><span className={`price-bridge ${pnl != null && pnl < 0 ? "losing" : ""}`} aria-hidden="true"><i/><em>{delta == null || delta === 0 ? "·" : delta > 0 ? "↗" : "↘"}</em><i/></span><span><small>Price now</small><b>{quote == null ? "—" : px(quote, d)}</b></span></span>
          <span className="price-relation">{relation}{delta != null && delta !== 0 ? ` · ${px(Math.abs(delta), d)} pts` : ""}<span aria-hidden="true"> ›</span></span>
        </button>;
      }) : <div className="flat-price"><span aria-hidden="true">↗</span><b>Your next move?</b><p>Pick BUY or SELL. Your entry will sit beside the live price.</p></div>}
    </section>
    <button type="button" className="open-candles" onClick={onExpand} data-testid="open-candles">Open fullscreen chart <span aria-hidden="true">⤢</span></button>
    <section className="trade-tape" aria-label="Market trades" data-testid="trade-tape">
      <div className="row between"><h2>On the floor</h2><small>Entries → exits</small></div>
      <p className="tape-context">Your trades and your squad’s · {MARKETS[market].title}</p>
      {error && <button type="button" className="trade-load-error" onClick={onRetry} role="status">{error} Tap to retry.</button>}
      {bubbles.length ? bubbles.map(b => {
        const closed = b.state === "closed";
        const end = closed ? b.exit_price : quote;
        const pnl = closed ? b.pnl : end == null ? null : (end - b.entry_price) * MARKETS[market].pointValue * b.quantity * (b.side === "long" ? 1 : -1);
        const up = end != null && end >= b.entry_price;
        return <article className="tape-trade" key={`${b.state}:${b.id}`} data-testid="tape-trade" data-trade-id={b.id}>
          <div className="tape-person"><Avatar handle={b.handle}/><span>{b.is_you ? <b>You</b> : <PlayerLink handle={b.handle}>@{b.handle}</PlayerLink>}<small className={b.side === "long" ? "lime" : "red"}>{b.side === "long" ? "↑ Long" : "↓ Short"} ×{b.quantity}</small></span><strong className={pnl == null ? "muted" : pnl >= 0 ? "lime" : "red"}>{pnl == null ? "—" : signedMoney(pnl)}</strong></div>
          <div className="tape-fills"><span><small>Entry</small><b>{px(b.entry_price, d)}</b><time dateTime={b.opened_at || undefined}>{time(b.opened_at)}</time></span>
            <svg viewBox="0 0 100 36" role="img" aria-label={`Entry to ${closed ? "exit" : "live price"}`} className={pnl == null || pnl >= 0 ? "lime" : "red"}><line x1="6" y1={up ? 29 : 7} x2="94" y2={up ? 7 : 29} stroke="currentColor" strokeWidth="2" strokeDasharray={closed ? undefined : "4 4"}/><circle cx="6" cy={up ? 29 : 7} r="4" fill="currentColor"/><circle cx="94" cy={up ? 7 : 29} r="4" fill={closed ? "currentColor" : "var(--bg)"} stroke="currentColor" strokeWidth="2"/></svg>
            <span><small>{closed ? "Exit · closed" : "Now · open"}</small><b>{end == null ? "—" : px(end, d)}</b>{closed ? <time dateTime={b.at}>{time(b.at)}</time> : <small>Still riding</small>}</span></div>
        </article>;
      }) : <div className="tape-empty">No trades here yet. The first move gets the floor going.</div>}
    </section>
  </div>;
}
