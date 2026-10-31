import { ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArcadeChart, HoldPreview, levelsFromSlide } from "./ArcadeChart";
import { ChartIndicators } from "./ChartIndicators";
import { candleRead, IndicatorOptions } from "./indicators";
import { frameLabel, game, stacksOf, useGame } from "./game";
import { isCrypto, FUTURES, CRYPTOS } from "./sessions";
import { MARKETS, Market, Side, digits, pnlOf } from "./types";
import { Sheet, px, signedMoney } from "./ui";
import { haptic, orderEffect, readEffect } from "./effects";
import { swipeGuard } from "./pageSwipe";

const CASH_OUT_MS = 450;

/** The default Trade page: Brokie's own chart fills the screen. Hold to trade, slide for TP/SL,
 *  hold "Cash out" to close. Everything else lives in the drawer. */
export function FocusFloor({ toast, indicators, onIndicators, onAccount, onPositions, onClassic, presence }: {
  toast: (m: string) => void; indicators: IndicatorOptions; onIndicators: () => void; onAccount: () => void; onPositions: () => void;
  onClassic: () => void; presence: ReactNode;
}) {
  const st = useGame();
  const me = st.me!;
  const market = st.market;
  const root = useRef<HTMLDivElement>(null);
  const [h, setH] = useState(520);
  const [drawer, setDrawer] = useState(false);
  const [markets, setMarkets] = useState(false);
  const [preview, setPreview] = useState<HoldPreview | null>(null);
  const order = useRef<{ side: Side; entry: number; done: Promise<string | null>; levels: { tp: number | null; sl: number | null } } | null>(null);

  // Fill the space between the page header and the tab bar.
  useLayoutEffect(() => {
    const fit = () => {
      const el = root.current; if (!el) return;
      const top = el.getBoundingClientRect().top + window.scrollY;
      const tabs = document.querySelector<HTMLElement>(".tabs")?.offsetHeight ?? 72;
      const vh = window.visualViewport?.height ?? innerHeight;
      setH(Math.max(320, Math.floor(vh - top - tabs - 8)));
    };
    fit(); addEventListener("resize", fit); window.visualViewport?.addEventListener("resize", fit);
    return () => { removeEventListener("resize", fit); window.visualViewport?.removeEventListener("resize", fit); };
  }, []);

  const candles = game.liveCandles(market);
  const quote = game.quote(market)?.price ?? null;
  const open = game.isOpen(market);
  const rules = me.rules;
  const stacks = stacksOf(me.positions);
  const here = stacks.filter(s => s.merged.market === market);
  const herePnl = quote == null ? null : here.reduce((s, x) => s + pnlOf(x.merged, quote), 0);
  const unrealized = me.positions.reduce((s, p) => { const q = game.quote(p.market)?.price; return s + (q ? pnlOf(p, q) : 0); }, 0);
  const base = rules?.start_balance ?? 100000;
  const seasonPct = (me.cash + unrealized - base) / base * 100;
  const pattern = indicators.patterns ? candleRead(candles.slice(0, -1)) : null;
  const tick = MARKETS[market].tick;
  const change = quote != null && candles[0] ? quote - candles[0].open : 0;

  const blocked = rules?.status === "blown" ? "Season max-loss reached. Open your account to restart."
    : rules?.status === "locked" ? "Daily limit reached. Trading unlocks next session."
    : !open ? (isCrypto(market) ? "Crypto trades during the weekend session." : "Market closed. Trades resume when prices are live.")
    : st.pending || game.ordersInFlight > 0 ? "One order at a time." : null;

  function onArm(side: Side) {
    if (quote == null) return;
    haptic([12]); orderEffect(readEffect());
    const qty = st.qty;
    const levels = { tp: null as number | null, sl: null as number | null };
    order.current = { side, entry: quote, levels, done: game.open(side, qty) };
    setPreview({ side, entry: quote, tp: null, sl: null });
  }
  function onSlide(price: number | null) {
    const o = order.current; if (!o) return;
    const l = levelsFromSlide(o.side, o.entry, price, tick);
    o.levels = l;
    setPreview(p => p ? { ...p, ...l } : p);
  }
  async function onRelease() {
    const o = order.current; order.current = null;
    setPreview(null);
    if (!o) return;
    const err = await o.done;
    const label = `${o.side === "long" ? "Bought" : "Sold"} ${game.state.qty} ${MARKETS[market].title}`;
    if (err) { toast(err); haptic([40, 30, 40]); return; }
    if (o.levels.tp == null || o.levels.sl == null) { toast(label); return; }
    const stack = stacksOf(game.state.me?.positions ?? []).find(s => s.merged.market === market && s.merged.side === o.side);
    if (!stack) { toast(`${label} · set TP/SL from your position`); return; }
    try {
      await game.setBracket(stack.merged.id, { tp: o.levels.tp, sl: o.levels.sl });
      toast(`${label} · TP ${px(o.levels.tp, digits(market))} · SL ${px(o.levels.sl, digits(market))} locked`);
    } catch (e) { toast(`${label} · TP/SL not saved: ${(e as Error).message}`); }
  }
  async function moveLevel(id: string, kind: "sl" | "tp", price: number) {
    try { await game.setBracket(id, { [kind]: price }); toast(`${kind.toUpperCase()} moved to ${px(price, digits(market))}`); }
    catch (e) { toast((e as Error).message || "Level not saved."); }
  }

  // Hold-to-cash-out: closes every position on this market.
  const [cash, setCash] = useState(0);
  const cashTimer = useRef<{ start: number; raf: number } | null>(null);
  const [closing, setClosing] = useState(false);
  function cashDown(e: React.PointerEvent) {
    if (closing || !here.length) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    swipeGuard.owned = true;
    const start = performance.now();
    const tickFn = () => {
      const t = Math.min(1, (performance.now() - start) / CASH_OUT_MS); setCash(t);
      if (t >= 1) { cashTimer.current = null; void cashOut(); return; }
      cashTimer.current = { start, raf: requestAnimationFrame(tickFn) };
    };
    cashTimer.current = { start, raf: requestAnimationFrame(tickFn) };
  }
  function cashUp() { if (cashTimer.current) cancelAnimationFrame(cashTimer.current.raf); cashTimer.current = null; setCash(0); swipeGuard.owned = false; }
  async function cashOut() {
    setClosing(true); swipeGuard.owned = false;
    let total = 0, error: string | undefined;
    for (const s of here) { const r = await game.closeStack([...s.ids]); total += r.pnl ?? 0; if (r.error) { error = r.error; break; } }
    setClosing(false); setCash(0);
    haptic(total >= 0 ? [10, 40, 18] : [40, 30, 40]);
    toast(error ?? `Cashed out ${MARKETS[market].title} · ${signedMoney(total)}`);
  }
  useEffect(() => () => { if (cashTimer.current) cancelAnimationFrame(cashTimer.current.raf); }, []);

  const shown = isCrypto(market) ? CRYPTOS : FUTURES;
  return (
    <div ref={root} className="focus-floor" data-testid="focus-floor" style={{ height: h }}>
      <ArcadeChart market={market} candles={candles} bucketSeconds={st.candleSeconds} quote={quote} positions={here.map(s => s.merged)} brackets={st.brackets}
        preview={preview} onMoveLevel={moveLevel} height={h}
        trade={{ blocked, onArm, onSlide, onRelease, onBlocked: (r) => { toast(r); haptic(10); } }}
        overlay={(toXY, w, hh) => <ChartIndicators candles={candles} options={indicators} seconds={st.candleSeconds} toXY={toXY} width={w} height={hh} />} />

      <div className="focus-hud top">
        <button type="button" className={`pnl-box ${herePnl == null || here.length === 0 ? "flat" : herePnl >= 0 ? "up" : "down"}`} onClick={onAccount} data-testid="focus-pnl" aria-label="Account and P&L">
          <small>P&amp;L · {MARKETS[market].title}</small>
          <b>{here.length && herePnl != null ? signedMoney(herePnl) : "$0.00"}</b>
          <span className={seasonPct >= 0 ? "lime" : "red"}>Season {seasonPct >= 0 ? "+" : ""}{seasonPct.toFixed(2)}%</span>
        </button>
        <div className="focus-controls">
          <button type="button" className="focus-chip market-chip" onClick={() => setMarkets(true)} data-testid="focus-market" style={{ ["--c" as string]: MARKETS[market].color }}>
            <b>{MARKETS[market].title}</b><span>{quote != null ? px(quote, digits(market)) : "—"}</span><em className={change >= 0 ? "lime" : "red"}>{change >= 0 ? "▲" : "▼"}</em>
          </button>
          <div className="focus-chip-row">
            <button type="button" className="focus-chip" onClick={() => game.nextFrame()} data-testid="focus-frame" aria-label="Change timeframe">{frameLabel(st.candleSeconds)}</button>
            <button type="button" className="focus-chip" onClick={onIndicators} data-testid="focus-indicators" aria-label="Chart indicators">ƒx</button>
            <button type="button" className="focus-chip" onClick={() => setDrawer(true)} data-testid="focus-more" aria-label="Squad, positions and settings">⋯</button>
          </div>
        </div>
      </div>
      {!open && <div className="focus-banner">{blocked}</div>}
      {pattern && <div className={`pattern-callout ${pattern.side}`} data-testid="pattern-callout"><small>Pattern locked</small><b>{pattern.name}</b></div>}

      <div className="focus-hud bottom">
        {here.length ? (
          <button type="button" className={`cash-out ${herePnl != null && herePnl >= 0 ? "up" : "down"}`} disabled={closing} data-testid="cash-out"
            onPointerDown={cashDown} onPointerUp={cashUp} onPointerCancel={cashUp} onPointerLeave={cashUp} style={{ ["--hold" as string]: cash }}>
            <span>{closing ? "Cashing out…" : "Hold to cash out"}</span><b>{herePnl != null ? signedMoney(herePnl) : "—"}</b>
          </button>
        ) : (
          <div className="hold-hint" aria-hidden={!!preview}><span className="lime">▲ Hold top half to BUY</span><span className="red">▼ Hold bottom half to SELL</span><small>Slide for TP/SL · lift to lock</small></div>
        )}
        <div className="focus-size" role="group" aria-label="Order size in micros">{[1, 10, 100].map(q => <button type="button" key={q} aria-pressed={st.qty === q} onClick={() => { game.setQty(q); haptic(8); }} data-testid={`focus-size-${q}`}>{q}</button>)}</div>
      </div>

      <Sheet open={markets} onClose={() => setMarkets(false)}>
        <div className="stack" data-testid="focus-markets"><div className="row between"><h2 className="h2">Markets</h2><button type="button" className="text-action" onClick={() => setMarkets(false)}>Done</button></div>
          {[["Futures", FUTURES], ["Crypto", CRYPTOS]].map(([label, list]) => <div key={label as string} className="stack" style={{ gap: 8 }}><small className="eyebrow">{label as string}</small>
            <div className="focus-market-grid">{(list as Market[]).map(m => <button type="button" key={m} className={m === market ? "on" : ""} style={{ ["--c" as string]: MARKETS[m].color }} onClick={() => { game.setMarket(m); setMarkets(false); }} data-testid={`focus-market-${m}`}>
              <b>{MARKETS[m].title}</b><small>{MARKETS[m].subtitle}</small><span>{game.quote(m) ? px(game.quote(m)!.price, digits(m)) : "—"}</span></button>)}</div></div>)}
          {!shown.includes(market) && null}
        </div>
      </Sheet>
      <Sheet open={drawer} onClose={() => setDrawer(false)}>
        <div className="stack focus-drawer" data-testid="focus-drawer">
          <div className="row between"><h2 className="h2">Floor</h2><button type="button" className="text-action" onClick={() => setDrawer(false)}>Done</button></div>
          {presence}
          <button type="button" className="drawer-row" onClick={() => { setDrawer(false); onPositions(); }}><b>Open positions</b><span>{stacks.length ? `${stacks.length} open · ${signedMoney(unrealized)}` : "Flat"} ›</span></button>
          <button type="button" className="drawer-row" onClick={() => { setDrawer(false); onAccount(); }}><b>Account &amp; risk</b><span>{money0(me.cash + unrealized)} ›</span></button>
          <button type="button" className="drawer-row" onClick={() => { setDrawer(false); onIndicators(); }}><b>Indicators</b><span>{Object.values(indicators).filter(Boolean).length} on ›</span></button>
          <button type="button" className="drawer-row" onClick={() => { setDrawer(false); onClassic(); }} data-testid="classic-layout"><b>Classic layout</b><span>Buttons + TradingView chart ›</span></button>
          <small className="muted">Hold anywhere on the chart to trade. Top half buys, bottom half sells. Slide up or down while holding to set TP and SL (1:1), lift to lock. Drag a TP/SL line to move it. Pinch to zoom, double-tap to reset.</small>
        </div>
      </Sheet>
    </div>
  );
}

const money0 = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
