import { tradingSummary } from "./tradingSummary";
import { SelectionRail } from "./SelectionRail";
import { SessionClock } from "./SessionClock";
import { MarketArt } from "./MarketArt";
import { orderEffect, readEffect } from "./effects";
import { PredictionMarkets } from "./PredictionMarkets";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { BubbleLayer } from "./Bubbles";
import type { Bubble, Rules } from "./types";
import { frameLabel, game, stacksOf, useGame } from "./game";
import { sessionMarkets } from "./sessions";

import { BrokieChart, CHART_SMALL } from "./Chart";
import { Button, Eyebrow, Icon, Sheet, TickValue, hintDone, hintOn, money, px, sessionOpenLabel, signedMoney, useNow } from "./ui";
import { MARKETS, Market, Position, Side, digits, pnlOf } from "./types";


export function TradeScreen({ toast, goSquad, goHistory }: { toast: (m: string) => void; goSquad: () => void; goHistory: () => void }) {
  const st = useGame();
  const me = st.me!;
  const lastChart = useRef<Market>(st.market === "prediction" ? "nas" : st.market);
  const [switching, setSwitching] = useState(false);
  const switchTimer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(switchTimer.current), []);
  function switchPrediction() {
    if (switching) return;
    if (st.market !== "prediction") lastChart.current = st.market;
    setSwitching(true);
    game.setMarket(st.market === "prediction" ? (shown.includes(lastChart.current) ? lastChart.current : shown[0]) : "prediction");
    switchTimer.current = setTimeout(() => setSwitching(false), 420);
  }
  const [crowd, setCrowd] = useState(() => { try { return localStorage.getItem("brokie.crowd") !== "off"; } catch { return true; } });
  const [showHistory, setShowHistory] = useState(false);
  const lastEnterToast = useRef(0);
  const [style, setStyle] = useState<"candles" | "line">(() => (localStorage.getItem("brokie.style") as "line") || "candles");
  const [closing, setClosing] = useState<string | null>(null);
  const [pnlInfo, setPnlInfo] = useState(false);
  const [positionsOpen, setPositionsOpen] = useState(false);
  const [chartInfo, setChartInfo] = useState(false);
  const [big, setBig] = useState(false);
  const [viewportH, setViewportH] = useState(window.visualViewport?.height ?? window.innerHeight);
  useEffect(() => {
    const resize = () => setViewportH(window.visualViewport?.height ?? window.innerHeight);
    window.addEventListener("resize", resize); window.visualViewport?.addEventListener("resize", resize);
    return () => { window.removeEventListener("resize", resize); window.visualViewport?.removeEventListener("resize", resize); };
  }, []);
  const [bigH, setBigH] = useState(Math.max(120, viewportH - 300));
  // Remember where the page was BEFORE the chart leaves the page flow: once it's fixed, the browser
  // shifts the scroll position to keep content in place, and reading it then would be ~a chart too high.
  const pageScroll = useRef({ x: 0, y: 0 });
  const chartCard = useRef<HTMLDivElement>(null);
  const chartRect = useRef<DOMRect | null>(null);
  const toggleBig = () => {
    if (!big) pageScroll.current = { x: window.scrollX, y: window.scrollY };
    chartRect.current = chartCard.current?.getBoundingClientRect() ?? null;
    setBig(v => !v);
  };
  useLayoutEffect(() => {
    const el = chartCard.current, from = chartRect.current;
    if (!el || !from || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const to = el.getBoundingClientRect();
    el.animate([
      { transformOrigin: "top left", transform: `translate(${from.x - to.x}px, ${from.y - to.y}px) scale(${from.width / to.width}, ${from.height / to.height})`, borderRadius: big ? "21px" : "0" },
      { transformOrigin: "top left", transform: "none", borderRadius: big ? "0" : "21px" }
    ], { duration: 340, easing: "cubic-bezier(.2,.8,.2,1)" });
    chartRect.current = null;
  }, [big]);
  useEffect(() => {
    if (!big) return;
    const { x, y } = pageScroll.current;
    const body = document.body, root = document.documentElement;
    const bodyStyle = body.style.cssText, rootStyle = root.style.cssText;
    Object.assign(body.style, { position: "fixed", top: `-${y}px`, left: `-${x}px`, width: "100%", overflow: "hidden", touchAction: "auto", overscrollBehavior: "none" });
    Object.assign(root.style, { overflow: "hidden", touchAction: "auto", overscrollBehavior: "none" });
    const escape = (e: KeyboardEvent) => { if (e.key === "Escape") setBig(false); };
    window.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("keydown", escape);
      body.style.cssText = bodyStyle; root.style.cssText = rootStyle;
      // Put the page back where it was. Again over the next two frames: until the chart is back in
      // the page at its small size, the page can be too short and the browser cuts the scroll short.
      const restore = () => window.scrollTo({ left: x, top: y, behavior: "instant" });
      restore(); requestAnimationFrame(() => { restore(); requestAnimationFrame(restore); });
    };
  }, [big]);
  const [activity, setActivity] = useState<{ text: string; n: number } | null>(null);
  useEffect(() => { setActivity(null); }, [st.market, st.squadId]);
  useEffect(() => { if (!activity) return; const t = setTimeout(() => setActivity(null), 5000); return () => clearTimeout(t); }, [activity]);
  const [markerHint, setMarkerHint] = useState(() => hintOn("markers"));
  const [cardHint, setCardHint] = useState(() => hintOn("cards"));
  const mark = (m: Market) => game.quote(m)?.price ?? null;
  const unrealized = me.positions.reduce((s, p) => s + (p.market === "prediction" ? pnlOf(p, 0) : mark(p.market) ? pnlOf(p, mark(p.market)!) : 0), 0);
  const equity = Math.max(0, me.cash + unrealized);
  const rules = me.rules;
  const base = rules?.start_balance ?? 10000;
  const pick = (_b: Bubble) => { if (markerHint) { hintDone("markers"); setMarkerHint(false); } };
  // Players (not legs) on each side, for the squad toggle: spamming 20 micros is still one player.
  const crowdHere = st.bubbleScope === `${st.market}:${game.squad?.id ?? ""}` ? st.bubbles.filter((b) => b.state === "open" && !b.is_you) : [];
  const longs = new Set(crowdHere.filter((b) => b.side === "long").map((b) => b.handle)).size;
  const shorts = new Set(crowdHere.filter((b) => b.side === "short").map((b) => b.handle)).size;
  useEffect(() => {
    void game.refreshBubbles();
    const t = setInterval(() => { if (!document.hidden) void game.refreshBubbles(); }, 3000);
    return () => clearInterval(t);
  }, [st.market, st.squadId]);
  const market = st.market;
  // A market only shows once the price feed has a quote for it (so a new market appears by itself when its feed goes live).
  const shown = sessionMarkets(game.now());
  const heldElsewhere = [...new Set(me.positions.filter(p => p.market !== "prediction").map(p => p.market))].filter(m => !shown.includes(m));
  const candles = game.liveCandles(market);
  const quote = mark(market);
  const open = game.isOpen(market);
  useLayoutEffect(() => {
    const card = chartCard.current;
    if (!big || !card) return;
    const fit = () => {
      const css = getComputedStyle(card);
      const used = Array.from(card.children).reduce((sum, child) => {
        if (child.querySelector(".chart-host")) return sum;
        const style = getComputedStyle(child);
        // Layout height stays stable while the fullscreen entrance animation scales the card.
        return sum + (child as HTMLElement).offsetHeight + parseFloat(style.marginTop || "0") + parseFloat(style.marginBottom || "0");
      }, 0);
      setBigH(Math.max(80, Math.floor(card.clientHeight - parseFloat(css.paddingTop) - parseFloat(css.paddingBottom) - used - 2)));
    };
    fit();
    const ro = new ResizeObserver(fit); ro.observe(card);
    for (const child of Array.from(card.children)) if (!child.querySelector(".chart-host")) ro.observe(child);
    return () => ro.disconnect();
  }, [big, viewportH, chartInfo, open]);
  const change = quote && candles[0] ? quote - candles[0].open : 0;
  const hi = candles.length ? Math.max(...candles.map((c) => c.high)) : null;
  const lo = candles.length ? Math.min(...candles.map((c) => c.low)) : null;

  const stacks = stacksOf(me.positions.filter(p => p.market !== "prediction"));
  async function close(id: string, ids: string[], title: string): Promise<boolean> {
    setClosing(id);
    const r = await game.closeStack(ids);
    setClosing(null);
    toast(r.error ?? `Closed ${title} · ${signedMoney(r.pnl ?? 0)}`);
    return !r.error;
  }
  // Ticket 14: enforce dragged SL/TP while the app is open.
  useEffect(() => {
    let alive = true;
    void game.checkBrackets().then((hits) => { if (alive) for (const h of hits) toast(h.error ?? `${h.hit === "tp" ? "🎯 TP hit" : "🛑 SL hit"} · ${signedMoney(h.pnl ?? 0)}`); });
    return () => { alive = false; };
  }, [st.me]);

  const positionCards = <div className="stack position-list" style={{ gap: 10 }}>
    {stacks.map(({ merged: p, ids }) => {
      const price = mark(p.market);
      return <SwipeCard key={p.id} p={p} pnl={price !== null && Number.isFinite(price) && price > 0 ? pnlOf(p, price) : null} busy={closing === p.id} disabled={!!closing}
        hedged={me.positions.some(q => q.market === p.market && q.side !== p.side)}
        onClose={() => { if (cardHint) { hintDone("cards"); setCardHint(false); } return close(p.id, ids, `${MARKETS[p.market].title} x${p.quantity}`); }} />;
    })}
  </div>;
  const orderDock = <div className="trade-dock">
    <TradingStatus market={market} onOpen={() => setPositionsOpen(true)} />
    <div className="size-picker"><span>MICROS</span><SelectionRail label="Order size" value={st.qty} options={[1, 10, 100].map(n => ({ value: n, label: `${n}` }))} disabled={!!st.pending || game.ordersInFlight > 0} onChange={n => game.setQty(n)} testId="micro-rail" itemPrefix="size" /></div>
    <SpamPad toast={toast} disabled={rules?.status === "blown" || rules?.status === "locked" || !open} />
  </div>;


  return (
    <div className="stack trade-screen">

      <div className="trade-mode-row"><span className="eyebrow">{market === "prediction" ? "THE PREDICTION ROOM" : "THE TRADING FLOOR"}</span>
      <button className={`predictions-entry ${market === "prediction" ? "active" : ""}`} onClick={switchPrediction} aria-pressed={market === "prediction"} disabled={switching} data-testid="prediction-switch"><span className="prediction-orbit" aria-hidden="true">✦</span><span>{market === "prediction" ? "Back to charts" : "Predictions"}</span><span aria-hidden="true">{market === "prediction" ? "↙" : "↗"}</span></button></div>
      <div key={market === "prediction" ? "predictions" : "charts"} className={`market-stage ${switching ? market === "prediction" ? "to-predictions" : "to-charts" : ""}`}>
      {market !== "prediction" && <>

      <div className={`markets ${shown.length > 3 ? "four" : ""}`} style={{ ["--n" as string]: shown.length }}>
        {shown.map((m) => (
          <button key={m} className={`market ${market === m ? "on" : ""}`} style={{ ["--c" as string]: MARKETS[m].color }} onClick={() => game.setMarket(m)} data-testid={`market-${m}`}>
            <MarketArt market={m} /><b>{m === "nas" ? "US 100" : m === "es" ? "US 500" : m === "us30" ? "US 30" : MARKETS[m].title}</b>
            <span className="mono">{mark(m) ? px(mark(m)!, digits(m)) : "—"}</span>
          </button>
        ))}
      </div>

      {heldElsewhere.length > 0 && <div className="chips">{heldElsewhere.map(m => <button className="chip" key={m} onClick={() => game.setMarket(m)}>View {MARKETS[m].title} position</button>)}</div>}

      </>}
      {market === "prediction" ? <PredictionMarkets toast={toast} /> : <>
      <div ref={chartCard} className={`chart-card ${big ? "chart-fullscreen" : ""}`} role={big ? "dialog" : undefined} aria-modal={big || undefined} aria-label={big ? "Fullscreen chart" : undefined}>
        <div className="row between market-heading" style={{ alignItems: "flex-start" }}>
          <div>
            <div className="instrument-title">{MARKETS[market].subtitle}<span className="badge" data-testid="live-badge" style={{ color: open ? "var(--lime)" : "var(--muted)" }}><span className="dot" style={{ width: 4, height: 4, ["--c" as string]: open ? "var(--lime)" : "var(--muted)" }} />{open ? "LIVE" : "CLOSED"}</span></div>
            <div className="row" style={{ gap: 8, alignItems: "baseline", marginTop: 6 }}>
              <span className="quote"><TickValue value={quote}>{quote ? px(quote, digits(market)) : "—"}</TickValue></span>
              <span className={`mono ${change >= 0 ? "lime" : "red"}`} style={{ fontSize: 11, fontWeight: 600 }}>{change >= 0 ? "+" : "−"}{px(Math.abs(change), digits(market))}</span>
            </div>
          </div>
          <button className={`chart-corner-toggle ${big ? "on" : ""}`} aria-pressed={big} data-testid="big-chart"
            aria-label={big ? "Exit fullscreen chart" : "Open fullscreen chart"} onClick={toggleBig}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d={big ? "M3 8h5V3m8 0v5h5M3 16h5v5m8 0v-5h5" : "M8 3H3v5m13-5h5v5M3 16v5h5m8 0h5v-5"} /></svg></button>

        </div>
        {chartInfo && <div className="chart-help muted">{hi !== null && <>High {px(hi)} · Low {px(lo!)}. </>}{big ? "Pinch to zoom, drag to pan, double-tap to return live." : "Preview locked. Use the top-right expand button to pan, zoom and trade fullscreen."}</div>}
        <BrokieChart fullscreen={big} height={big ? bigH : CHART_SMALL} handle={me.handle} market={market} candles={candles} bucketSeconds={st.candleSeconds} quote={quote} positions={stacks.map((x) => x.merged)} style={style}
          brackets={st.brackets} onBracket={(id, b) => { game.setBracket(id, b); if (cardHint) { hintDone("cards"); setCardHint(false); } }} onClearBracket={(id, k) => game.clearBracket(id, k)}
          sizePctOf={(p) => { const v = st.bubbles.filter((b) => b.is_you && b.state === "open" && b.side === p.side).reduce((s, b) => s + (b.size_pct ?? 0), 0); return v || null; }}
          // History is opt-in; the squad toggle controls friends' markers.
          overlay={(toXY, width) => st.bubbleScope === `${market}:${game.squad?.id ?? ""}` && <>
            <BubbleLayer key={`${market}:${game.squad?.id ?? ""}`} showHistory={showHistory} now={game.now()} hideMine bubbles={crowd ? st.bubbles : st.bubbles.filter((b) => b.is_you)} market={market} quote={quote} toXY={toXY} width={width} onSelect={pick}
              onZoomOut={st.frames.some((f) => f > st.candleSeconds) ? () => game.setCandleSeconds(st.frames.find((f) => f > st.candleSeconds)!) : undefined}
              onEnter={(b) => { const now = Date.now(); if (now - lastEnterToast.current < 5000) return; lastEnterToast.current = now; setActivity({ text: `@${b.handle} went ${b.side} ${b.quantity} micro${b.quantity === 1 ? "" : "s"}`, n: now }); }} />
            {crowd && (activity ? <span key={activity.n} className="chart-toast" role="status">{activity.text}</span>
              : markerHint && crowdHere.length > 0 && <span className="chart-toast hint">Tap a face for their trade</span>)}
          </>} />
        <div className="chips chart-controls" style={{ marginTop: 10 }}>
          {/* One button: shows the chart style you're on; tap to flip between candles and line. */}
          <button type="button" className="chip lime on style-switch" role="switch" aria-checked={style === "line"} data-testid="style-switch"
            aria-label={style === "candles" ? "Candlestick chart. Tap for line chart" : "Line chart. Tap for candlestick chart"}
            onClick={() => { const s = style === "candles" ? "line" : "candles"; setStyle(s); try { localStorage.setItem("brokie.style", s); } catch { /* */ } }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">{style === "candles" ? <><path d="M7 3v4m0 9v5m10-18v7m0 7v4"/><rect x="4" y="7" width="6" height="9" rx="1"/><rect x="14" y="10" width="6" height="7" rx="1"/></> : <path d="m3 17 5-7 5 4 8-10"/>}</svg><small>{style === "candles" ? "Candles" : "Line"}</small>
          </button>
          <SelectionRail label="Chart timeframe" value={st.candleSeconds} options={st.frames.map(f => ({ value: f, label: frameLabel(f) }))} onChange={f => game.setCandleSeconds(f)} testId="timeframe-rail" itemPrefix="timeframe" />

          <button className={`chip lime ${crowd ? "on" : ""}`} aria-pressed={crowd} data-testid="crowd-toggle"
            aria-label={crowd ? "Hide squad trades on the chart" : "Show squad trades on the chart"}
            onClick={() => { const v = !crowd; setCrowd(v); try { localStorage.setItem("brokie.crowd", v ? "on" : "off"); } catch { /* */ } }}>
            <span className="crowd-chip">{Icon.squad}{crowd && longs > 0 && <span className="lime">{longs}▲</span>}{crowd && shorts > 0 && <span className="red">{shorts}▼</span>}</span><small>Squad</small>
          </button>
          <button className="chip history-switch" aria-pressed={showHistory} aria-label={showHistory ? "Hide closed trades on chart" : "Show closed trades on chart"} onClick={() => setShowHistory(!showHistory)} data-testid="history-toggle"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M3 11a9 9 0 1 1 2 7M3 5v6h6m3-5v6l4 2"/></svg><small>History</small></button>
          <button className="chip chart-info-btn" onClick={() => setChartInfo(!chartInfo)} aria-expanded={chartInfo} aria-label="Chart info">ⓘ<small>Info</small></button>
        </div>
        {!open && <div className="chart-attribution">Market closed · new trades resume when prices are live.</div>}
        {big && orderDock}
      </div>

      <section className="positions-section" data-testid="positions-section">
        {stacks.length > 0 ? <>
          <div className="row between"><h2 className="h2">Open positions</h2><button className="text-action" onClick={() => setPositionsOpen(true)}>{stacks.length} open ↗</button></div>
          {positionCards}
          {cardHint && <div className="position-hint">Swipe a position to close · drag its chart pill for SL/TP</div>}
        </> : <div className="flat-state"><span><i aria-hidden="true" />You’re flat <small>No open trades</small></span><button onClick={goHistory}>History ↗</button></div>}
      </section>

      <section className={`account-hero account-compact ${rules?.status ?? "active"}`}>
        <div className="account-summary">
          <div><Eyebrow>Account equity · USD</Eyebrow><div className="equity" data-testid="equity"><TickValue value={equity}>{money(equity)}</TickValue></div></div>
          <div className="account-season"><Eyebrow>Season {me.season_number ?? ""}</Eyebrow>
            <button type="button" className={`gain-btn ${equity >= base ? "lime" : "red"}`} onClick={() => setPnlInfo(true)} data-testid="pnl-info" aria-label="Season P&L. How is this calculated?">{signedMoney(equity - base)} <span aria-hidden="true">ⓘ</span></button>
            <small className="season-return">{equity >= base ? "+" : ""}{((equity - base) / base * 100).toFixed(2)}%{rules?.funded ? <span className="chip-status" data-testid="funded-chip">Funded</span> : rules?.target_hit ? <span className="chip-status" data-testid="target-chip">Target hit</span> : null}</small>
          </div>
        </div>
        {rules && <RuleStatus rules={rules} toast={toast} goHistory={goHistory} />}
        {rules && <Meters rules={rules} equity={equity} />}
      </section>
      <SessionClock market={market} />
      {!big && orderDock}


      </>}
      </div>
      <Sheet open={positionsOpen} onClose={() => setPositionsOpen(false)}>
        <div className="stack" data-testid="positions-sheet">
          <div className="row between"><h2 className="h2">Your open positions</h2><button className="text-action" aria-label="Close positions" onClick={() => setPositionsOpen(false)}>Done</button></div>
          <TradingStatus market={market} />
          {stacks.length ? positionCards : <div className="flat-state">You’re flat. No open trades.</div>}
          <small className="muted">Unrealised P&amp;L covers all open trades in USD. Prediction tokens are separate.</small>
        </div>
      </Sheet>
      <PnlSheet open={pnlInfo} onClose={() => setPnlInfo(false)} equity={equity} unrealized={unrealized} base={base} />
    </div>
  );
}

function TradingStatus({ market, onOpen }: { market: Market; onOpen?: () => void }) {
  const st = useGame(), now = useNow(1000) + st.clockOffset;
  const summary = tradingSummary(st.me?.positions ?? [], st.me?.quotes ?? [], market, now);
  const value = summary.pnl === null ? "—" : summary.flat ? "$0.00" : signedMoney(summary.pnl);
  const tone = summary.flat || summary.pnl === null ? "muted" : summary.pnl >= 0 ? "lime" : "red";
  const exposure = [summary.long ? `LONG ${summary.long}` : "", summary.short ? `SHORT ${summary.short}` : ""].filter(Boolean).join(" · ") || "FLAT";
  const content = <><span className="dock-pnl"><small>Unrealised <span>· all trades</span></small><b className={tone} data-testid="live-unrealised">{value}</b>{summary.stale && <em>{summary.pnl === null ? "Waiting for prices" : "Last quoted prices"}</em>}</span>
    <span className="dock-exposure"><small>{MARKETS[market].title} · {exposure}</small><b>{summary.groups ? `${summary.groups} open position${summary.groups === 1 ? "" : "s"}` : "No open positions"}{onOpen && <span aria-hidden="true"> ›</span>}</b></span></>;
  return onOpen ? <button className="dock-status" onClick={onOpen} aria-label="View open positions and unrealised P&L" data-testid="trading-status">{content}</button> : <div className="dock-status">{content}</div>;
}

function PnlSheet({ open, onClose, equity, unrealized, base }: { open: boolean; onClose: () => void; equity: number; unrealized: number; base: number }) {
  const st = useGame();
  const me = st.me!;
  const realized = equity - base - unrealized;
  return (
    <Sheet open={open} onClose={onClose}>
      <div className="stack" style={{ gap: 14 }}>
        <div className="row between"><Eyebrow>How your P&amp;L adds up</Eyebrow><button className="muted" onClick={onClose} aria-label="Close">✕</button></div>
        <div className="detail"><span>Starting balance</span><span>{money(base, 0)}</span></div>
        <div className="detail"><span>Closed trades (realized)</span><span className={realized >= 0 ? "lime" : "red"} data-testid="pnl-realized">{signedMoney(realized)}</span></div>
        <div className="detail"><span>Open positions (unrealized)</span><span className={unrealized >= 0 ? "lime" : "red"} data-testid="pnl-unrealized">{signedMoney(unrealized)}</span></div>
        {me.protection_credit > 0 && <div className="detail"><span>Liquidation credit (included above)</span><span>{money(me.protection_credit)}</span></div>}
        <div className="detail"><b>Season P&amp;L (equity − start)</b><b className={equity - base >= 0 ? "lime" : "red"}>{signedMoney(equity - base)}</b></div>
        <div className="muted" style={{ fontSize: 12, lineHeight: 1.5 }}>
          Account equity is your whole account: cash plus what your open trades are worth right now. Each position row shows only <b>that trade's</b> open P&amp;L, so the rows won't add up to the season number once you've closed trades.
          Prices are the live midpoint, and practice fills don't charge spread or commission. Your Receipts list shows the latest 50 closed trades; the totals here cover the whole season.
        </div>
        <Button variant="ghost" onClick={onClose}>Got it</Button>
      </div>
    </Sheet>
  );
}

function RuleStatus({ rules, toast, goHistory }: { rules: Rules; toast: (m: string) => void; goHistory: () => void }) {
  const [busy, setBusy] = useState(false);
  if (rules.status === "active") return null;
  if (rules.status === "locked") return (
    <div className="status-card" style={{ background: "rgba(255,125,139,.08)", border: "1px solid rgba(255,125,139,.35)" }} data-testid="status-locked">
      <span style={{ fontSize: 26 }}>🔒</span>
      <div><b>Daily loss limit hit.</b><div className="muted" style={{ fontSize: 12, marginTop: 3 }}>Positions closed. Unlocks when the next session opens at {sessionOpenLabel()} your time (5pm New York).</div><button className="text-action lime" onClick={goHistory}>Review your trades →</button></div>
    </div>
  );
  return (
    <div className="status-card" style={{ background: "#1b1b1b", border: "1px solid #444", flexDirection: "column", alignItems: "stretch" }} data-testid="status-blown">
      <div className="row"><span style={{ fontSize: 30, filter: "grayscale(1)" }}>💀</span>
        <div><b style={{ fontSize: 17 }}>REKT.</b><div className="muted" style={{ fontSize: 12, marginTop: 3 }}>You hit the {rules.max_dd_pct}% max loss limit. Account blown for this season.</div></div></div>
      {rules.resets_used === 0 ? (
        <button className="big-btn lime" style={{ marginTop: 12 }} disabled={busy} data-testid="buy-back"
          onClick={async () => { setBusy(true); try { await game.buyBack(); toast(`Back in. ${rules.daily_loss_amount ? money(rules.daily_loss_amount, 0) : "4%"} daily limit, and 5 new trading days to qualify.`); } catch (e) { toast((e as Error).message); } setBusy(false); }}>
          {busy ? <span className="spinner" /> : `Use your one buy-back (${rules.daily_loss_amount ? money(rules.daily_loss_amount, 0) : "4%"} daily · 8% max loss)`}
        </button>
      ) : <div className="muted" style={{ fontSize: 12, marginTop: 10 }}>Buy-back used. See you next season.</div>}
    </div>
  );
}

function Meters({ rules, equity }: { rules: Rules; equity: number }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const dailyRoom = Math.max(0, equity - rules.daily_floor), dailyMax = rules.day_start_equity - rules.daily_floor;
  const trailing = rules.dd_mode === "trailing";
  const ddRoom = Math.max(0, equity - rules.drawdown_floor), ddMax = (rules.dd_base ?? rules.peak_equity) - rules.drawdown_floor;
  const targetGain = Math.max(0, rules.target - rules.start_balance);
  const gain = Math.max(0, equity - rules.start_balance);
  const progress = targetGain > 0 ? Math.min(1, gain / targetGain) : 0;
  const tone = (f: number) => (f < 0.25 ? "var(--red)" : f <= 0.5 ? "var(--gold)" : "var(--lime)");
  const m = (label: string, remaining: number, frac: number, cap: number, id: string) => (
    <button type="button" className="meter" data-testid={id} aria-expanded={expanded === id} aria-controls="rule-explainer"
      onClick={() => setExpanded(expanded === id ? null : id)}>
      <div className="meter-heading">{label} <span aria-hidden="true">ⓘ</span></div>
      <b style={{ color: tone(frac) }}>{money(remaining, 0)} <small>left</small></b>
      <div className="bar" aria-hidden="true"><i style={{ width: `${Math.max(0, Math.min(1, frac)) * 100}%`, background: tone(frac) }} /></div>
      <div className="meter-caption">{id === "meter-daily" && rules.daily_loss_amount ? money(rules.daily_loss_amount, 0) : `${cap}%`} {id === "meter-daily" ? "daily cap" : trailing ? "trailing limit" : "end-of-day limit"}</div>
    </button>
  );
  const df = dailyMax > 0 ? dailyRoom / dailyMax : 0, dd = ddMax > 0 ? ddRoom / ddMax : 0;
  const explanations: Record<string, string> = {
    "meter-daily": `At ${money(rules.daily_floor, 0)} account equity, the server closes your positions and locks trading until the next session opens at ${sessionOpenLabel()} your time (5pm New York).`,
    "meter-dd": trailing
      ? `Your current trailing floor is ${money(rules.drawdown_floor, 0)}, ${rules.max_dd_pct}% under your highest equity. Reaching it closes your positions and marks this season's account REKT.`
      : `Your floor is ${money(rules.drawdown_floor, 0)}: ${rules.max_dd_pct}% under your best end-of-day balance (${money(rules.dd_base ?? rules.peak_equity, 0)}). It only moves up when a session closes higher (5pm New York), not on intraday spikes. Touching it at any time closes your positions and marks this season's account REKT.`,
    "meter-target": `Get funded: be at ${money(rules.target, 0)} (+10%) with at least ${rules.qualify_days} trading days (any session you open a trade). Hitting the target earlier earns 🎯 Target hit; you still need to be at +10% once the days are in. Funded is a game badge, with no real funding or cash payout. The same ${rules.qualify_days} days qualify you for the leaderboard.`,
  };
  return (
    <div className="hero-risk">

    <details className="rule-summary compact-rules">
      <summary><span>Daily loss room <b style={{ color: tone(df) }}>{money(dailyRoom, 0)}</b></span><span className="muted">Risk details ⌄</span></summary>
      <div className="risk-strips" aria-hidden="true">{[["DAILY ROOM", df], ["DRAWDOWN ROOM", dd], ["TARGET", rules.funded || rules.target_hit ? 1 : progress]].map(([label, value]) => <div key={String(label)}><span>{label}</span><i><b style={{ width: `${Math.max(0, Math.min(1, Number(value))) * 100}%`, background: label === "TARGET" ? "var(--lime)" : tone(Number(value)) }} /></i></div>)}</div>
      <div className="target-progress"><span>Profit target {Math.round(progress * 100)}% · {rules.trading_days}/{rules.qualify_days} days</span><progress max={1} value={rules.funded || rules.target_hit ? 1 : progress} /></div>
      <div className="meters">
        {m("Daily loss limit", dailyRoom, df, rules.daily_loss_pct, "meter-daily")}
        {m("Max loss limit", ddRoom, dd, rules.max_dd_pct, "meter-dd")}
      </div>
      <button type="button" className="target-meter" data-testid="meter-target" aria-expanded={expanded === "meter-target"} aria-controls="rule-explainer"
        onClick={() => setExpanded(expanded === "meter-target" ? null : "meter-target")}>
        <span className="target-ring" style={{ ["--progress" as string]: `${(rules.funded || rules.target_hit ? 1 : progress) * 360}deg` }} aria-hidden="true"><span>{rules.funded ? "🏆" : rules.target_hit ? "✓" : `${Math.round(progress * 100)}%`}</span></span>
        <span className="target-copy"><span className="meter-heading">Profit target <span aria-hidden="true">ⓘ</span></span>
          <strong>{money(gain, 0)} <span className="muted">/ {money(targetGain, 0)}</span></strong>
          <span className="meter-caption" data-testid="target-caption">{rules.funded ? "🏆 Funded · " : rules.target_hit ? "🎯 Target hit · " : ""}{rules.trading_days}/{rules.qualify_days} trading days · {rules.funded ? "Leaderboard qualified" : rules.target_hit ? (rules.trading_days >= rules.qualify_days ? "back to +10% to get funded" : "to get funded") : rules.trading_days >= rules.qualify_days ? "Leaderboard qualified" : "To qualify for leaderboard"}</span>
        </span>
      </button>
      <div id="rule-explainer" hidden={!expanded} className="rule-explainer">{expanded ? explanations[expanded] : ""}</div>
    </details>
    </div>
  );
}

const buzz = (ms: number | number[]) => { try { navigator.vibrate?.(ms); } catch { /* */ } };

/** Order taps retain the game’s batching and partial/hedge rules; combo feedback is visual only. */
const COMBO_WINDOW_MS = 900;
type TapCombo = { side: Side; count: number; at: number; id: number };
function SpamPad({ toast, disabled }: { toast: (m: string) => void; disabled: boolean }) {
  const st = useGame();
  const [pops, setPops] = useState<{ id: number; side: Side }[]>([]);
  const [squash, setSquash] = useState<Side | null>(null);
  const [shake, setShake] = useState<Side | null>(null);
  const [combo, setCombo] = useState<TapCombo | null>(null);
  const comboRef = useRef<TapCombo | null>(null);
  const comboTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function clearCombo() {
    if (comboTimer.current !== null) clearTimeout(comboTimer.current);
    comboTimer.current = null;
    comboRef.current = null;
    setCombo(null);
  }
  // A streak belongs to one market, squad and order mode, and never survives a lockout.
  useEffect(() => {
    clearCombo();
    return () => { if (comboTimer.current !== null) clearTimeout(comboTimer.current); };
  }, [disabled, st.market, st.squadId, st.opposite]);
  const seq = useRef(0);
  const pend = st.pending;
  const legs = (st.me?.positions ?? []).filter((p) => p.market === st.market);
  const [tapHint] = useState(() => hintOn("taps"));
  /** One tap: +1 micro to the order being collected. `held` = the button is held down, so the
   *  order waits for the release (or fills to 10) instead of sending 300 ms after the tap. */
  function tap(side: Side, held = false) {
    if (disabled) return;
    const cur = game.state.pending;
    const n = cur && cur.side === side ? cur.count : 0;
    const cap = game.tapReduces(side) ? game.heldAgainst(side) : 100;
    if (n >= cap) { buzz([20, 30, 20]); setShake(side); setTimeout(() => setShake(null), 300); return; }
    const lvl = Math.min(2, Math.floor(n / 5));
    buzz([12, 22, 35][lvl]);
    orderEffect(readEffect());
    const id = ++seq.current;
    const now = performance.now();
    const previous = comboRef.current;
    const next = { side, count: previous?.side === side && now - previous.at < COMBO_WINDOW_MS ? previous.count + 1 : 1, at: now, id };
    comboRef.current = next;
    setCombo(next);
    if (comboTimer.current !== null) clearTimeout(comboTimer.current);
    // A short fade follows the chain window; taps after that window start a fresh streak.
    comboTimer.current = setTimeout(clearCombo, COMBO_WINDOW_MS + 300);
    setPops((p) => [...p.slice(-8), { id, side }]);
    setTimeout(() => setPops((p) => p.filter((x) => x.id !== id)), 600);
    setSquash(null); requestAnimationFrame(() => setSquash(side));
    game.tap(side, done(side), held);
  }
  /** What happens when an order (a batch of taps) comes back from the server. */
  function done(side: Side) {
    const hedging = legs.some((p) => p.side !== side) && !legs.some((p) => p.side === side);
    const id = seq.current;
    const market = MARKETS[st.market].title;
    return (err: string | null, q: number, pnl?: number) => {
      if (err) { stopHold(false); game.dropTaps(); if (comboRef.current?.id === id) clearCombo(); buzz([30, 40, 30]); setShake(side); setTimeout(() => setShake(null), 400); toast(err); }
      else if (pnl !== undefined) { buzz(pnl >= 0 ? [10, 40, 18] : [40, 30, 40]); toast(`✂️ Took ${q} off ${market} · ${signedMoney(pnl)}`); }
      else { buzz([10, 40, 18]); toast(`${hedging ? "🛡 Hedged" : side === "long" ? "🚀 Bought" : "📉 Sold"} ${q} micro${q === 1 ? "" : "s"} ${market}`); }
    };
  }

  // Hold to spam: keep a finger on BUY/SELL and after 0.35 s it taps by itself (~11 a second).
  // Every full order of 10 goes straight to the server and the next one starts, paced to the
  // server's 5 new orders per 10 s. Letting go sends whatever is collected. It stops on any
  // refusal (10 open positions, buying power, daily limit) or if the app loses focus.
  const HOLD_DELAY_MS = 350, HOLD_EVERY_MS = 90, ORDERS_PER_10S = 5;
  const hold = useRef<{ side: Side; start: ReturnType<typeof setTimeout> | null; every: ReturnType<typeof setInterval> | null } | null>(null);
  const holdSends = useRef<number[]>([]);
  const latest = useRef({ holdStep: (_: Side) => {} });
  function stopHold(send = true) {
    const h = hold.current; if (!h) return;
    if (h.start !== null) clearTimeout(h.start);
    if (h.every !== null) clearInterval(h.every);
    hold.current = null;
    if (send) game.armTaps(done(h.side));   // let go: the usual short wait, so quick taps still batch
  }
  function holdStep(side: Side) {
    if (!hold.current || disabled) { stopHold(false); return; }
    const cur = game.state.pending;
    const n = cur && cur.side === side ? cur.count : 0;
    const reduce = game.tapReduces(side);
    const cap = reduce ? game.heldAgainst(side) : 100;
    const orderCap = Math.min(cap, Math.max(10, game.state.qty));
    if (n < orderCap) { tap(side, true); return; }
    if (reduce) { stopHold(); return; }   // closing: nothing more to take off after this order
    const now = Date.now();
    holdSends.current = holdSends.current.filter((t) => now - t < 10_000);
    if (game.ordersInFlight > 0 || holdSends.current.length >= ORDERS_PER_10S) return;   // wait for a free slot
    holdSends.current.push(now);
    game.sendTapsNow(done(side));
  }
  latest.current.holdStep = holdStep;
  function startHold(side: Side) {
    if (hold.current || disabled) return;
    tap(side, true);
    const h: { side: Side; start: ReturnType<typeof setTimeout> | null; every: ReturnType<typeof setInterval> | null } = { side, start: null, every: null };
    h.start = setTimeout(() => { h.start = null; h.every = setInterval(() => latest.current.holdStep(side), HOLD_EVERY_MS); }, HOLD_DELAY_MS);
    hold.current = h;
  }
  useEffect(() => () => { stopHold(false); game.dropTaps(); }, []);
  useEffect(() => { if (disabled) { stopHold(false); game.dropTaps(); } }, [disabled]);
  useEffect(() => { stopHold(false); game.dropTaps(); }, [st.market, st.qty]);
  useEffect(() => {
    const off = () => { stopHold(false); game.dropTaps(); };
    document.addEventListener("visibilitychange", off);
    window.addEventListener("blur", off);
    return () => { document.removeEventListener("visibilitychange", off); window.removeEventListener("blur", off); };
  }, []);
  const btn = (side: Side) => {
    const n = pend && pend.side === side ? pend.count : 0;
    const label = side === "long" ? "BUY" : "SELL";
    const hedge = legs.some((p) => p.side !== side) && !legs.some((p) => p.side === side);
    const partial = st.opposite === "partial" && hedge;
    const chain = !disabled && combo?.side === side && combo.count >= 3 ? combo : null;
    const tier = chain ? chain.count >= 10 ? 3 : chain.count >= 6 ? 2 : 1 : 0;
    const sign = side === "long" ? "+" : "−";   // BUY adds, SELL subtracts
    return (
      <button type="button" className={`spam-btn effect-${readEffect()} ${side} combo-tier-${tier} ${squash === side ? "squash" : ""} ${shake === side ? "nope" : ""}`}
        style={{ ["--glow" as string]: String(Math.min(1, n / 10)) }} disabled={disabled}
        onPointerDown={(e) => { if (!e.isPrimary || e.button !== 0) return; e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); startHold(side); }} onPointerUp={() => stopHold()} onPointerCancel={() => { stopHold(false); game.dropTaps(); }} onLostPointerCapture={() => stopHold()}
        onContextMenu={(e) => e.preventDefault()}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); if (!e.repeat) tap(side); } }}
        onKeyUp={(e) => { if ((e.key === "Enter" || e.key === " ") && game.state.pending) game.armTaps(done(side)); }}
        onAnimationEnd={(e) => { if (e.target === e.currentTarget) setSquash(null); }} data-testid={side === "long" ? "go-long" : "go-short"} id={side === "long" ? "go-long" : "go-short"}>
        {chain && <span key={chain.id} className={`combo-badge tier-${tier}`} data-testid="tap-combo" data-count={chain.count} data-side={side} aria-hidden="true">
          <span className="combo-count">{chain.count}</span><span className="combo-copy"><b>{tier === 3 ? "UNREAL" : tier === 2 ? "ON FIRE" : "COMBO"}</b><small>TAP STREAK</small></span><span className="combo-symbol">{tier >= 2 ? "🔥" : "ϟ"}</span><i className="combo-fuse" />
        </span>}
        <span className="spam-label">{side === "long" ? "↗" : "↘"} {label}</span>
        <span className="spam-sub">{n ? `${sign}${n}` : partial ? `tap = close ${st.qty}` : hedge ? "tap = hedge" : tapHint ? `tap ${sign}${st.qty} · hold = spam` : "\u00a0"}</span>
        {pops.filter((p) => p.side === side).map((p) => <span key={p.id} className="tap-feedback" aria-hidden="true"><span className="tap-fx"><i className="tap-ring" /><i className="tap-spark spark-one" /><i className="tap-spark spark-two" /><i className="tap-spark spark-three" /></span><span className="spam-pop">{sign}{st.qty}</span></span>)}
      </button>
    );
  };
  return <div className="spam-pad" data-testid="spam-pad">{btn("long")}{btn("short")}</div>;
}

/** Ticket 16: a position as a clean card. Drag it sideways; past 40% it tints (lime win / red
 *  loss) and buzzes; let go past that and it flies off and closes (confetti or crack). */
function SwipeCard({ p, pnl, busy, disabled, hedged, onClose }:
  { p: Position; pnl: number | null; busy: boolean; disabled: boolean; hedged: boolean; onClose: () => Promise<boolean> }) {
  const [dx, setDx] = useState(0);
  const [phase, setPhase] = useState<"idle" | "drag" | "fly" | "back" | "gone">("idle");
  const [fx, setFx] = useState<"win" | "loss" | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const armed = useRef(false);
  const win = pnl !== null && pnl >= 0;
  const w = () => ref.current?.offsetWidth ?? 320;
  function down(e: React.PointerEvent) {
    if (disabled || phase === "fly" || phase === "gone") return;
    const x0 = e.clientX, y0 = e.clientY; let locked: boolean | null = null; let lastDx = 0;
    const el = e.currentTarget as HTMLElement; el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const ddx = ev.clientX - x0, ddy = ev.clientY - y0;
      if (locked === null && Math.hypot(ddx, ddy) > 8) locked = Math.abs(ddx) > Math.abs(ddy);
      if (!locked) return;
      setPhase("drag"); setDx(ddx); lastDx = ddx;
      const over = Math.abs(ddx) > w() * 0.4;
      if (over !== armed.current) { armed.current = over; if (over) buzz(22); }
    };
    const up = async () => {
      el.removeEventListener("pointermove", move); el.removeEventListener("pointerup", up); el.removeEventListener("pointercancel", up);
      if (!locked) return;
      if (armed.current) {
        armed.current = false;
        const dir = Math.sign(lastDx || 1);
        setPhase("fly"); setDx(dir * (w() + 60));
        buzz(win ? [10, 40, 18] : [40, 30, 40]);
        setFx(pnl === null ? null : win ? "win" : "loss");
        const ok = await onClose();
        if (ok) setPhase("gone"); else { setFx(null); setPhase("back"); setDx(0); }
      } else { setPhase("back"); setDx(0); }
    };
    el.addEventListener("pointermove", move); el.addEventListener("pointerup", up); el.addEventListener("pointercancel", up);
  }
  const over = Math.abs(dx) > w() * 0.4;
  const tint = phase === "drag" && over ? (win ? "tint-win" : "tint-loss") : "";
  return (
    <div className={`swipe-wrap ${phase === "gone" ? "collapse" : ""}`} data-testid="position">
      <div className={`swipe-bg ${win ? "win" : "loss"}`} style={{ opacity: Math.min(1, Math.abs(dx) / (w() * 0.4)) }}>
        <span>{win ? "💰 Bank it" : "✂️ Cut it"}</span><span>{win ? "💰 Bank it" : "✂️ Cut it"}</span>
      </div>
      <div ref={ref} className={`pos-card ${tint} ${phase} ${fx === "loss" ? "crack" : ""}`} onPointerDown={down}
        style={{ transform: `translateX(${dx}px) rotate(${dx / 40}deg)`, touchAction: "pan-y" }}
        onTransitionEnd={() => { if (phase === "back") setPhase("idle"); }}>
        <span className="badge-sq" style={{ background: MARKETS[p.market].color + "1A", color: MARKETS[p.market].color }}>{MARKETS[p.market].title[0]}</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 800 }}>{MARKETS[p.market].title} <span className={p.side === "long" ? "lime" : "red"}>{p.side === "long" ? "LONG ↗" : "SHORT ↘"}</span>
            {hedged && <span className="hedge-pill inline" data-testid="hedged-row">HEDGED</span>}</div>
          <div className="muted mono" style={{ fontSize: 10, marginTop: 4 }}>x{p.quantity} · {px(p.entry_price)}</div>
        </div>
        <span className={`mono pos-pnl ${pnl === null ? "muted" : win ? "lime" : "red"}`}><TickValue value={pnl}>{pnl === null ? "—" : signedMoney(pnl)}</TickValue></span>
        {busy && <span className="spinner" style={{ width: 12, height: 12 }} />}
      </div>
      {fx === "win" && <div className="confetti" aria-hidden="true">{Array.from({ length: 14 }, (_, i) => <i key={i} style={{ ["--i" as string]: i }} />)}</div>}
    </div>
  );
}
