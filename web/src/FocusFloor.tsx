import { ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArcadeChart, HoldPreview, levelsFromSlide } from "./ArcadeChart";
import { ChartIndicators } from "./ChartIndicators";
import { BubbleLayer } from "./Bubbles";
import { candleRead, IndicatorOptions } from "./indicators";
import { frameLabel, game, stacksOf, useGame } from "./game";
import { isCrypto, FUTURES, CRYPTOS, opensLabel } from "./sessions";
import { MARKETS, Market, Side, digits, pnlOf, type Bubble } from "./types";
import { Sheet, hintDone, money, px, signedMoney } from "./ui";
import { haptic, orderEffect, readEffect } from "./effects";
import { swipeGuard } from "./pageSwipe";

const CASH_OUT_MS = 450;
const seen = (key: string) => { try { return localStorage.getItem(key) === "done"; } catch { return true; } };
const markSeen = (key: string) => { try { localStorage.setItem(key, "done"); } catch { /* */ } };

/** The default Trade page: Brokie's own chart fills the screen. Hold to trade, slide for TP/SL,
 *  hold "Cash out" to close. Everything else lives in the drawer. */
export function FocusFloor({ active, toast, indicators, onIndicators, onAccount, onPositions, onClassic, presence, crowd, onCrowd, showHistory, onHistory }: {
  active: boolean; toast: (m: string) => void; indicators: IndicatorOptions; onIndicators: () => void; onAccount: () => void; onPositions: () => void;
  onClassic: () => void; presence: ReactNode;
  /** Friends' trades on the chart (the 👥 toggle) and whether closed trades show too. */
  crowd: boolean; onCrowd: () => void; showHistory: boolean; onHistory: () => void;
}) {
  const st = useGame();
  const me = st.me!;
  const market = st.market;
  const root = useRef<HTMLDivElement>(null);
  const [h, setH] = useState(520);
  const [drawer, setDrawer] = useState(false);
  const [markets, setMarkets] = useState(false);
  const [preview, setPreview] = useState<HoldPreview | null>(null);
  // The chart takes whatever the HUD rows above and below leave over.
  const chartBox = useRef<HTMLDivElement>(null);
  const [chartH, setChartH] = useState(360);
  useLayoutEffect(() => {
    const el = chartBox.current; if (!el) return;
    const fit = () => setChartH(Math.max(140, Math.floor(el.clientHeight)));
    fit(); const ro = new ResizeObserver(fit); ro.observe(el); return () => ro.disconnect();
  }, []);
  // Brief hints on each visit; a hold pops the visible hint before it steps aside.
  const [holdCoach, setHoldCoach] = useState(true);
  const [coachVisit, setCoachVisit] = useState(0);
  const [coachPop, setCoachPop] = useState<Side | null>(null);
  // The hints fade on their own after a few seconds, or the moment you touch the chart.
  const [coachFading, setCoachFading] = useState(false);
  useEffect(() => {
    const show = () => {
      if (!active || document.hidden) return;
      setHoldCoach(true); setCoachFading(false); setCoachPop(null); setCoachVisit(v => v + 1);
    };
    show(); document.addEventListener("visibilitychange", show);
    return () => document.removeEventListener("visibilitychange", show);
  }, [active]);
  useEffect(() => {
    if (!holdCoach) return;
    setCoachFading(false);
    const fade = setTimeout(() => setCoachFading(true), 5000);
    const gone = setTimeout(() => { setHoldCoach(false); setCoachPop(null); }, 5600);
    return () => { clearTimeout(fade); clearTimeout(gone); };
  }, [holdCoach, coachVisit]);
  const [positionCoach, setPositionCoach] = useState(() => !seen("brokie.coach.position"));
  const coachTrade = (side: Side) => {
    if (holdCoach) setCoachPop(side);
  };
  const order = useRef<{ side: Side; entry: number; done: Promise<string | null>; levels: { tp: number | null; sl: number | null }; closing?: { closed?: number; pnl?: number } } | null>(null);
  useEffect(() => { order.current = null; setPreview(null); }, [market, st.candleSeconds]);

  // Fill the space between the page header and the tab bar.
  useLayoutEffect(() => {
    const fit = () => {
      const el = root.current; if (!el) return;
      const top = el.getBoundingClientRect().top + window.scrollY;
      const tabs = document.querySelector<HTMLElement>(".tabs")?.offsetHeight ?? 72;
      const vh = window.visualViewport?.height ?? innerHeight;
      setH(Math.max(320, Math.floor(vh - top - tabs - 10)));
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
  // Squad fills on this market (and your own closed trades). Your open positions are already drawn as entry lines.
  const scope = `${market}:${game.squad?.id ?? ""}`;
  const chartBubbles: Bubble[] = st.bubbleScope === scope ? st.bubbles.filter(b => !(b.is_you && b.state === "open") && (crowd || b.is_you)) : [];
  const mates = new Set(chartBubbles.filter(b => !b.is_you && b.state === "open").map(b => b.handle)).size;
  const herePnl = quote == null ? null : here.reduce((s, x) => s + pnlOf(x.merged, quote), 0);
  const showPositionCoach = positionCoach && here.length > 0;
  useEffect(() => {
    if (!showPositionCoach) return;
    const t = setTimeout(() => { setPositionCoach(false); markSeen("brokie.coach.position"); }, 7000);
    return () => clearTimeout(t);
  }, [showPositionCoach]);
  const unrealized = me.positions.reduce((s, p) => { const q = game.quote(p.market)?.price; return s + (q ? pnlOf(p, q) : 0); }, 0);
  const base = rules?.start_balance ?? 100000;
  const seasonPct = (me.cash + unrealized - base) / base * 100;
  const pattern = indicators.patterns ? candleRead(candles.slice(0, -1)) : null;
  const tick = MARKETS[market].tick;
  const change = quote != null && candles[0] ? quote - candles[0].open : 0;
  const changePct = candles[0]?.open ? change / candles[0].open * 100 : 0;
  // The change is measured from the first loaded candle, so say how far back that is.
  const span = spanLabel(candles.length * st.candleSeconds);

  const blocked = rules?.status === "blown" ? "Season max-loss reached. Open your account to restart."
    : rules?.status === "locked" ? "Daily limit reached. Trading unlocks next session."
    : !open ? closedNote(market, game.now())
    : st.pending || game.ordersInFlight > 0 ? "One order at a time." : null;

  function onArm(side: Side) {
    if (quote == null) return;
    coachTrade(side);
    haptic([12]); orderEffect(readEffect());
    const qty = st.qty;
    const levels = { tp: null as number | null, sl: null as number | null };
    // Holding against an open position takes it off (no hedges on this floor).
    const opposite: Side = side === "long" ? "short" : "long";
    const against = here.filter(x => x.merged.side === opposite).reduce((n, x) => n + x.merged.quantity, 0);
    if (against > 0) {
      const result: { closed?: number; pnl?: number } = {};
      order.current = { side, entry: quote, levels, closing: result, done: game.reduce(opposite, Math.min(qty, against)).then(r => { result.closed = r.closed; result.pnl = r.pnl; return r.error ?? null; }) };
      setPreview({ side, entry: quote, tp: null, sl: null, closing: true });
      return;
    }
    order.current = { side, entry: quote, levels, done: game.open(side, qty) };
    setPreview({ side, entry: quote, tp: null, sl: null });
  }
  function onSlide(price: number | null) {
    const o = order.current; if (!o || o.closing) return;
    const l = levelsFromSlide(o.side, o.entry, price, tick);
    o.levels = l;
    setPreview(p => p ? { ...p, ...l } : p);
  }
  async function onRelease() {
    const o = order.current; order.current = null;
    setPreview(null);
    if (!o) return;
    const err = await o.done;
    if (o.closing) {
      if (err) { toast(err); haptic([40, 30, 40]); return; }
      haptic((o.closing.pnl ?? 0) >= 0 ? [10, 40, 18] : [40, 30, 40]);
      toast(`Closed ${o.closing.closed ?? ""} ${MARKETS[market].title} · ${signedMoney(o.closing.pnl ?? 0)}`); return;
    }
    const label = `${o.side === "long" ? "Bought" : "Sold"} ${game.state.qty} ${MARKETS[market].title}`;
    if (err) { toast(err); haptic([40, 30, 40]); return; }
    if (o.levels.tp == null || o.levels.sl == null) { toast(label); return; }
    const stack = stacksOf(game.state.me?.positions ?? []).find(s => s.merged.market === market && s.merged.side === o.side);
    if (!stack) { toast(`${label} · set TP/SL from your position`); return; }
    try {
      await game.setBracket(stack.merged.id, { tp: o.levels.tp, sl: o.levels.sl });
      const first = !seen("brokie.coach.lines"); if (first) markSeen("brokie.coach.lines");
      toast(first ? `${label} · TP/SL locked 1:1. Drag either line to move it on its own.` : `${label} · TP ${px(o.levels.tp, digits(market))} · SL ${px(o.levels.sl, digits(market))} locked`);
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
  const small = h < 520;
  const pnlTone = herePnl == null || here.length === 0 ? "flat" : herePnl >= 0 ? "up" : "down";
  const side = here[0]?.merged.side, held = here.reduce((n, x) => n + x.merged.quantity, 0);
  return (
    <div ref={root} className={`focus-floor ${small ? "small" : ""}`} data-testid="focus-floor" style={{ height: h }}>
      <div className="focus-hud top">
        <div className="focus-hud-row">
          <button type="button" className="focus-chip market-chip" onClick={() => setMarkets(true)} data-testid="focus-market" style={{ ["--c" as string]: MARKETS[market].color }} aria-label={`Market: ${MARKETS[market].title}. Change market`}>
            <i aria-hidden="true" /><b>{MARKETS[market].title}</b><span aria-hidden="true">⌄</span>
          </button>
          <div className="focus-chip-row">
            <button type="button" className="focus-chip" onClick={() => game.nextFrame()} data-testid="focus-frame" aria-label="Change timeframe">{frameLabel(st.candleSeconds)}</button>
            <button type="button" className="focus-chip" onClick={onIndicators} data-testid="focus-indicators" aria-label="Chart indicators">ƒx</button>
            <button type="button" className="focus-chip" onClick={() => setDrawer(true)} data-testid="focus-more" aria-label="Squad, positions and settings">⋯</button>
          </div>
        </div>
        <div className="focus-figures">
          <div className="focus-price" data-testid="focus-price">
            <b>{quote != null ? px(quote, digits(market)) : "—"}</b>
            <span className={change >= 0 ? "lime" : "red"} data-testid="focus-change">{change >= 0 ? "▲" : "▼"} {px(Math.abs(change), digits(market))} <em>{changePct >= 0 ? "+" : "−"}{Math.abs(changePct).toFixed(2)}%{span && <i> · {span}</i>}</em></span>
          </div>
          <button type="button" className={`pnl-box ${pnlTone}`} onClick={here.length ? onPositions : onAccount} data-testid="focus-pnl" aria-label={here.length ? `Manage ${MARKETS[market].title} positions` : "Account and P&L"}>
            <small>{here.length ? `${side === "long" ? "Long" : "Short"} ${held} · P&L` : "Flat · P&L"}</small>
            <b>{here.length && herePnl != null ? signedMoney(herePnl) : "$0.00"}</b>
            <span className={seasonPct >= 0 ? "lime" : "red"}>Season {seasonPct >= 0 ? "+" : ""}{seasonPct.toFixed(2)}%</span>
          </button>
        </div>
      </div>

      <div ref={chartBox} className="focus-chart">
        <ArcadeChart key={`${market}:${st.candleSeconds}`} market={market} candles={candles} bucketSeconds={st.candleSeconds} quote={quote} positions={here.map(s => s.merged)} brackets={st.brackets}
          preview={preview} onMoveLevel={moveLevel} height={chartH} topPad={small ? 18 : 26} bottomPad={small ? 14 : 20}
          trade={{ blocked, onArm, onSlide, onRelease, onBlocked: (r) => { toast(r); haptic(10); } }}
          overlay={(toXY, w, hh) => <>
            <ChartIndicators candles={candles} options={indicators} seconds={st.candleSeconds} toXY={toXY} width={w} height={hh} />
            <BubbleLayer key={scope} height={hh} width={w} showHistory={showHistory} now={game.now()} bubbles={chartBubbles} market={market} quote={quote} toXY={toXY}
              onSelect={() => hintDone("markers")} onEnter={() => {}}
              onZoomOut={st.frames.some((f) => f > st.candleSeconds) ? () => game.setCandleSeconds(st.frames.find((f) => f > st.candleSeconds)!) : undefined} />
          </>} />
        {!open && <div className="focus-banner">{blocked}</div>}
        {pattern && open && !preview && !holdCoach && <div className={`pattern-callout ${pattern.side}`} data-testid="pattern-callout"><small>Pattern</small><b>{pattern.name}</b></div>}
        {active && holdCoach && open && here.length === 0 && <div className={`hold-coach ${coachPop ? `pop-${coachPop}` : ""} ${coachFading ? "fading" : ""}`} data-testid="hold-coach" aria-hidden="true">
          <div className="coach-zone long"><span className="coach-pill">▲ Hold the top half to buy</span></div>
          <div className="coach-zone short"><span className="coach-pill">▼ Hold the bottom half to sell</span></div>
        </div>}
      </div>

      <div className="focus-hud bottom">
        <div className="focus-size-block">
          {showPositionCoach && !preview
            // The add/close tip borrows this line for a few seconds, so it never covers the chart's levels.
            ? <small className="focus-size-context focus-tip" data-testid="focus-tip" role="note">Same half adds · other closes</small>
            : <small className="focus-size-context" data-testid="focus-size-context" aria-live="polite">{st.qty} {st.qty === 1 ? "micro" : "micros"} · {money(st.qty * MARKETS[market].pointValue)} / point</small>}
          <div className="focus-size" role="group" aria-label="Order size in micros">{[1, 10, 100].map(q => <button type="button" key={q} aria-pressed={st.qty === q} onClick={() => { game.setQty(q); haptic(8); if (showPositionCoach) { setPositionCoach(false); markSeen("brokie.coach.position"); } }} data-testid={`focus-size-${q}`}>{q}</button>)}</div>
        </div>
        {here.length ? (
          <button type="button" className={`cash-out ${herePnl != null && herePnl >= 0 ? "up" : "down"}`} disabled={closing} data-testid="cash-out"
            onPointerDown={cashDown} onPointerUp={cashUp} onPointerCancel={cashUp} onPointerLeave={cashUp} style={{ ["--hold" as string]: cash }}>
            <span>{closing ? "Cashing out…" : "Hold to cash out"}</span><b>{herePnl != null ? signedMoney(herePnl) : "—"}</b>
          </button>
        ) : (
          <div className="focus-size-label" aria-hidden="true"><b>Size</b><small>micros per hold</small></div>
        )}
      </div>

      <Sheet open={markets} onClose={() => setMarkets(false)}>
        <div className="stack" data-testid="focus-markets"><div className="row between"><h2 className="h2">Markets</h2><button type="button" className="text-action" onClick={() => setMarkets(false)}>Done</button></div>
          {[["Futures", FUTURES], ["Crypto", CRYPTOS]].map(([label, list]) => <div key={label as string} className="stack" style={{ gap: 8 }}><small className="eyebrow">{label as string}</small>
            <div className="focus-market-grid">{(list as Market[]).map(m => <button type="button" key={m} className={m === market ? "on" : ""} style={{ ["--c" as string]: MARKETS[m].color }} onClick={() => { game.setMarket(m); setMarkets(false); }} data-testid={`focus-market-${m}`}>
              <b>{MARKETS[m].title}</b><small>{MARKETS[m].subtitle}</small><span>{game.quote(m) ? px(game.quote(m)!.price, digits(m)) : "—"}</span>
              {!game.isOpen(m) && <em className="market-closed" data-testid={`focus-market-closed-${m}`}>{opensLabel(m, game.now()) ?? "Waiting for prices"}</em>}</button>)}</div></div>)}
          {!shown.includes(market) && null}
        </div>
      </Sheet>
      <Sheet open={drawer} onClose={() => setDrawer(false)}>
        <div className="stack focus-drawer" data-testid="focus-drawer">
          <div className="row between"><h2 className="h2">Floor</h2><button type="button" className="text-action" onClick={() => setDrawer(false)}>Done</button></div>
          {presence}
          <button type="button" className="drawer-row" onClick={() => { setDrawer(false); onPositions(); }}><b>Open positions</b><span>{stacks.length ? `${stacks.length} open · ${signedMoney(unrealized)}` : "Flat"} ›</span></button>
          <button type="button" className="drawer-row" onClick={() => { setDrawer(false); onAccount(); }}><b>Account &amp; risk</b><span>{money0(me.cash + unrealized)} ›</span></button>
          <button type="button" className="drawer-row" onClick={onCrowd} aria-pressed={crowd} data-testid="focus-crowd"><b>Friends' trades on chart</b><span>{crowd ? `On${mates ? ` · ${mates} in right now` : ""}` : "Off"} ›</span></button>
          <button type="button" className="drawer-row" onClick={onHistory} aria-pressed={showHistory} data-testid="focus-history"><b>Closed trades on chart</b><span>{showHistory ? "On" : "Off"} ›</span></button>
          <button type="button" className="drawer-row" onClick={() => { setDrawer(false); onIndicators(); }}><b>Indicators</b><span>{Object.values(indicators).filter(Boolean).length} on ›</span></button>
          <button type="button" className="drawer-row" onClick={() => { setDrawer(false); onClassic(); }} data-testid="classic-layout"><b>Classic layout</b><span>Buttons + TradingView chart ›</span></button>
          <button type="button" className="drawer-row quiet" onClick={() => { try { localStorage.removeItem("brokie.coach.position"); } catch { /* */ } setHoldCoach(true); setCoachFading(false); setCoachVisit(v => v + 1); setCoachPop(null); setPositionCoach(true); setDrawer(false); }} data-testid="show-tips"><b>Show trading tips</b><span>›</span></button>
          <small className="muted drawer-note">Hold anywhere on the chart to trade. Top half buys, bottom half sells. Slide up or down while holding to set TP and SL (they start 1:1), lift to lock. Then drag the TARGET or STOP line to move either one on its own. Pinch to zoom, double-tap to reset.</small>
        </div>
      </Sheet>
    </div>
  );
}

/** Closed-market copy that says when trading comes back, in the player's own time. */
function closedNote(market: Market, now: number) {
  const opens = opensLabel(market, now);
  if (!opens) return "Waiting for live prices…";
  return `${isCrypto(market) ? "Crypto is weekend-only" : "Market closed"} · ${opens.replace(/^Opens/, "opens")}`;
}

function spanLabel(seconds: number) {
  if (seconds <= 0) return "";
  const m = Math.round(seconds / 60), h = Math.floor(m / 60), d = Math.floor(h / 24);
  return d >= 2 ? `${d}d` : h >= 1 ? `${h}h${m % 60 && h < 6 ? ` ${m % 60}m` : ""}` : `${m}m`;
}

const money0 = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
