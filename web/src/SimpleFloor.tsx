import { FillRow } from "./FillRow";
import { groupFills } from "./tradeActivity";
import { MARKETS, digits, pnlOf, type Bubble, type Market, type Position } from "./types";
import { px, signedMoney } from "./ui";

/** A price comparison and trade tape, with no chart gestures. */
export function SimpleFloor({ market, quote, positions, bubbles, onPositions, error, onRetry }: {
  market: Market; quote: number | null; positions: Position[]; bubbles: Bubble[];
  onPositions: () => void; error: string | null; onRetry: () => void;
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
      }) : <div className="flat-price"><i/><span>No open {MARKETS[market].title} trades</span><small>Make your move below</small></div>}
    </section>
    <section className="trade-tape" aria-label="Market trades" data-testid="trade-tape">
      <div className="row between"><h2>On the floor</h2><small>Entries → exits</small></div>
      <p className="tape-context">Your trades and your squad’s · {MARKETS[market].title}</p>
      {error && <button type="button" className="trade-load-error" onClick={onRetry} role="status">{error} Tap to retry.</button>}
      {bubbles.length ? groupFills(bubbles, market).map(group => <FillRow key={group.key} group={group} quote={quote}/>) : <div className="tape-empty">No trades here yet. The first move gets the floor going.</div>}
    </section>
  </div>;
}
