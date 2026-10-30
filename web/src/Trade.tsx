import { FloorPresence } from "./FloorPresence";
import { useTradeSwipe } from "./useTradeSwipe";
import { priceForPnl, protectionDirection, protectionPnl } from "./protection";
import { EventStrip } from "./Events";
import { tradingSummary } from "./tradingSummary";
import { SelectionRail } from "./SelectionRail";
import { SessionClock } from "./SessionClock";
import { haptic, orderEffect, readEffect } from "./effects";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { BubbleLayer } from "./Bubbles";
import type { Bubble, Rules } from "./types";
import { frameLabel, game, stacksOf, useGame } from "./game";
import { isCrypto, sessionCountdown, FUTURES, CRYPTOS } from "./sessions";

import { BrokieChart, CHART_SMALL } from "./Chart";
import { Button, Eyebrow, Sheet, TickValue, hintDone, hintOn, money, px, sessionOpenLabel, signedMoney, useNow } from "./ui";
import { MARKETS, Market, Position, Side, digits, pnlOf } from "./types";


export function TradeScreen({ toast, goSquad, goHistory }: { toast: (m: string) => void; goSquad: () => void; goHistory: () => void }) {
  const st = useGame();
  const me = st.me!;
  const crypto = isCrypto(st.market);
  const lastFuture = useRef<Market>("nas");
  const lastCrypto = useRef<Market>("btc");
  if (crypto) lastCrypto.current = st.market; else if (st.market !== "prediction") lastFuture.current = st.market;
  const [accountOpen, setAccountOpen] = useState(false);
  const [settled, setSettled] = useState<{ pnl: number; title: string } | null>(null);
  useEffect(() => { if (!settled) return; const timer=setTimeout(()=>setSettled(null),2800); return ()=>clearTimeout(timer); },[settled]);
  const [crowd, setCrowd] = useState(() => { try { return localStorage.getItem("brokie.crowd") !== "off"; } catch { return true; } });
  const [showHistory, setShowHistory] = useState(() => { try { return localStorage.getItem("brokie.chartHistory") === "on"; } catch { return false; } });
  const [style, setStyle] = useState<"candles" | "line">(() => (localStorage.getItem("brokie.style") as "line") || "candles");
  const [closing, setClosing] = useState<string | null>(null);
  const closeInFlight = useRef(false);
  const [pnlInfo, setPnlInfo] = useState(false);
  const [positionsOpen, setPositionsOpen] = useState(false);
  const [protectionId, setProtectionId] = useState<string | null>(null);
  const [chartInfo, setChartInfo] = useState(false);
  const [big, setBig] = useState(false);
  const [viewportH, setViewportH] = useState(window.visualViewport?.height ?? window.innerHeight);
  useEffect(() => {
    const resize = () => setViewportH(window.visualViewport?.height ?? window.innerHeight);
    window.addEventListener("resize", resize); window.visualViewport?.addEventListener("resize", resize);
    return () => { window.removeEventListener("resize", resize); window.visualViewport?.removeEventListener("resize", resize); };
  }, []);
  const [previewH, setPreviewH] = useState(CHART_SMALL);
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
  const [cardHint, setCardHint] = useState(() => hintOn("cards"));
  const mark = (m: Market) => game.quote(m)?.price ?? null;
  const unrealized = me.positions.reduce((s, p) => s + (mark(p.market) ? pnlOf(p, mark(p.market)!) : 0), 0);
  const equity = Math.max(0, me.cash + unrealized);
  const rules = me.rules;
  const base = rules?.start_balance ?? 100000;
  const pick = (_b: Bubble) => hintDone("markers");
  useEffect(() => {
    void game.refreshBubbles();
    const t = setInterval(() => { if (!document.hidden) void game.refreshBubbles(); }, 3000);
    return () => clearInterval(t);
  }, [st.market, st.squadId]);
  const market = st.market;
  // Both sections stay discoverable; the server still owns trading-session availability.
  const shown: Market[] = [...(crypto ? CRYPTOS : FUTURES)];
  const heldElsewhere = [...new Set(me.positions.map(p => p.market))].filter(m => !shown.includes(m));
  const candles = game.liveCandles(market);
  const quote = mark(market);
  // Own fills come from account state immediately, including each individual leg.
  // The position pills may aggregate size, but chart entries keep their real fills.
  const chartBubbles: Bubble[] = [
    ...(st.bubbleScope === `${market}:${game.squad?.id ?? ""}` ? st.bubbles.filter(b => !(b.is_you && b.state === "open") && (crowd || b.is_you)) : []),
    ...me.positions.filter(p => p.market === market).map(p => ({ ...p, state: "open" as const, handle: me.handle, is_you: true, exit_price: null, pnl: null, reason: null, at: p.opened_at, size_pct: null, dd_floor: null, equity: null })),
  ];
  const open = game.isOpen(market);
  useLayoutEffect(() => {
    const card=chartCard.current;
    if (!card) return;
    const dock=card.closest(".trade-screen")?.querySelector<HTMLElement>(".trade-dock");
    const fit=()=>{
      const css=getComputedStyle(card);
      const used=Array.from(card.children).reduce((sum,child)=>{
        const style=getComputedStyle(child);
        if (child.querySelector(".chart-host") || ["fixed","absolute"].includes(style.position)) return sum;
        return sum+(child as HTMLElement).offsetHeight+parseFloat(style.marginTop||"0")+parseFloat(style.marginBottom||"0");
      },0);
      const padding=parseFloat(css.paddingTop)+parseFloat(css.paddingBottom);
      if(big) setBigH(Math.max(80,Math.floor(card.clientHeight-padding-used-2)));
      else if(dock) setPreviewH(Math.max(96,Math.min(640,Math.floor(dock.getBoundingClientRect().top-card.getBoundingClientRect().top-window.scrollY-padding-used-12))));
    };
    fit();const ro=new ResizeObserver(fit);ro.observe(card);if(dock)ro.observe(dock);
    for(const child of Array.from(card.children))if(!child.querySelector(".chart-host"))ro.observe(child);
    return ()=>ro.disconnect();
  },[big,viewportH,open,market]);
  const change = quote && candles[0] ? quote - candles[0].open : 0;
  const hi = candles.length ? Math.max(...candles.map((c) => c.high)) : null;
  const lo = candles.length ? Math.min(...candles.map((c) => c.low)) : null;

  const stacks = stacksOf(me.positions);
  async function close(id: string, ids: string[], title: string): Promise<boolean> {
    if (closeInFlight.current) return false;
    closeInFlight.current = true;
    setClosing(id);
    try {
      const r = await game.closeStack(ids);
      if (!r.error && (r.pnl ?? 0) > 0) { setSettled({ pnl:r.pnl!,title }); haptic(10); }
      else toast(r.error ?? `Closed ${title} · ${signedMoney(r.pnl ?? 0)}`);
      return !r.error;
    } catch (e) { toast((e as Error).message || "Close wasn't confirmed. Check your position."); return false; }
    finally { closeInFlight.current = false; setClosing(null); }
  }
  const here = stacks.filter(s => s.merged.market === market);
  const quick = here.length === 1 ? here[0] : null;
  const quickTitle = quick ? `${MARKETS[market].title} · ${quick.merged.side === "long" ? "Long" : "Short"} ${quick.merged.quantity}` : "Choose a position";
  const swipe = useTradeSwipe({
    enabled: here.length > 0 && !closing && !st.pending && game.ordersInFlight === 0 && !accountOpen && !positionsOpen && !protectionId && !chartInfo && !st.chatOpen,
    fullscreen: big,
    revision: `${market}:${here.map(s=>`${s.ids.join(',')}:${s.merged.quantity}`).join('|')}`,
    onCommit: () => {
      if (!quick) { setPositionsOpen(true); return; }
      void close(quick.merged.id, [...quick.ids], `${MARKETS[market].title} ${quick.merged.side} ×${quick.merged.quantity}`);
    }
  });
  async function saveProtection(id: string, b: { sl?: number; tp?: number }) {
    try { await game.setBracket(id, b); toast("SL/TP saved · stays active when you leave the app"); if (cardHint) { hintDone("cards"); setCardHint(false); } }
    catch (e) { toast((e as Error).message || "Stop was not saved. Try again."); }
  }
  async function clearProtection(id: string, key: "sl" | "tp") {
    try { await game.clearBracket(id, key); toast(`${key.toUpperCase()} removed`); }
    catch (e) { toast((e as Error).message || "Could not remove the stop. It is still active."); }
  }

  const positionCards = <div className="stack position-list" style={{ gap: 10 }}>
    {stacks.map(({ merged: p, ids }) => {
      const price = mark(p.market);
      return <SwipeCard key={p.id} p={p} pnl={price !== null && Number.isFinite(price) && price > 0 ? pnlOf(p, price) : null} busy={closing === p.id} disabled={!!closing}
        hedged={me.positions.some(q => q.market === p.market && q.side !== p.side)} protection={st.brackets[p.id]} onProtection={() => { setPositionsOpen(false); setProtectionId(p.id); }}
        onClose={() => { if (cardHint) { hintDone("cards"); setCardHint(false); } return close(p.id, ids, `${MARKETS[p.market].title} x${p.quantity}`); }} />;
    })}
  </div>;
  const orderDock = <div className="trade-dock">
    <div className={`dock-close-surface ${swipe.distance ? "swiping" : ""}`} style={{ ["--close-progress" as string]: swipe.distance }} data-testid="quick-close">
      <TradingStatus market={market} disabled={!!closing} onOpen={()=>rules?.status === "blown" ? setAccountOpen(true) : setPositionsOpen(true)} swipeHint={here.length ? closing ? "Closing…" : quick ? `Swipe → close ${quickTitle}` : "Swipe → choose a position" : undefined}/>
      {swipe.distance > 0 && <div className="quick-close-progress" role="status"><span>{swipe.distance >= 1 ? quick ? "Release to close" : "Release to choose" : "Keep swiping →"}</span><b>{quickTitle}</b></div>}
    </div>
    <div className="execution-options chart-controls">
      <button type="button" className="execution-style style-switch" role="switch" aria-checked={style === "line"} aria-label={style === "candles" ? "Candlestick chart. Tap for line chart" : "Line chart. Tap for candlestick chart"} title={style === "candles" ? "Candles" : "Line"} data-testid="style-switch" onClick={()=>{const next=style === "candles" ? "line" : "candles";setStyle(next);try{localStorage.setItem("brokie.style",next);}catch{/* */}}}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">{style === "candles" ? <><path d="M7 3v4m0 9v5m10-18v7m0 7v4"/><rect x="4" y="7" width="6" height="9" rx="1"/><rect x="14" y="10" width="6" height="7" rx="1"/></> : <path d="m3 17 5-7 5 4 8-10"/>}</svg>
      </button>
      <div className="execution-interval"><SelectionRail label="Chart timeframe" value={st.candleSeconds} options={st.frames.map(f=>({value:f,label:frameLabel(f)}))} onChange={f=>game.setCandleSeconds(f)} testId="timeframe-rail" itemPrefix="timeframe"/></div>
      <div className="quantity-selector" role="group" aria-label="Order size in micros" data-testid="micro-rail" onKeyDown={e=>{if(!["ArrowLeft","ArrowRight"].includes(e.key)||st.pending||game.ordersInFlight>0)return;e.preventDefault();const values=[1,10,100],i=values.indexOf(st.qty);game.setQty(values[Math.max(0,Math.min(2,i+(e.key === "ArrowRight"?1:-1)))]);}}><span>Size</span>{[1,10,100].map(q=><button type="button" key={q} aria-pressed={st.qty === q} aria-label={`${q} micro${q===1?"":"s"}`} disabled={!!st.pending||game.ordersInFlight>0} onClick={()=>{game.setQty(q);haptic(8);}} data-testid={`size-${q}`}>{q}</button>)}</div>
    </div>
    <SpamPad toast={toast} disabled={rules?.status === "blown"||rules?.status === "locked"||!open}/>
  </div>;



  return (
    <div className="stack trade-screen" onPointerDownCapture={swipe.onPointerDownCapture} onClickCapture={swipe.onClickCapture}>

      <div className="floor-toolbar">
        <button type="button" className={`account-disclosure ${rules?.status ?? "active"}`} onClick={()=>setAccountOpen(true)} aria-label="Account and risk details" data-testid="account-disclosure"><span className="account-status-dot"/><span>Paper account <b data-testid="account-equity-preview">{money(equity,0)}</b></span><span aria-hidden="true">⌄</span></button>
        <button type="button" className={`market-section-switch ${crypto ? "selected" : ""}`} aria-label={crypto ? "Switch to futures" : "Switch to crypto"} data-testid="crypto-switch" onClick={()=>game.setMarket(crypto ? lastFuture.current : lastCrypto.current)}>{crypto ? "Futures" : "Crypto"}<span aria-hidden="true">{crypto ? "↙" : "↗"}</span></button>
      </div>
      {rules?.status === "blown" && <button className="account-restriction" onClick={()=>setAccountOpen(true)} data-testid="season-restriction"><b>Season max-loss limit reached</b><span>{rules.resets_used === 0 ? "Free restart available ↗" : "View account status ↗"}</span></button>}
      <div className="market-stage" data-testid="markets-section" data-section={crypto ? "crypto" : "futures"}>
      <div className={`markets ${shown.length > 3 ? "four" : ""}`} style={{ ["--n" as string]: shown.length }}>
        {shown.map((m) => (
          <button key={m} className={`market ${market === m ? "on" : ""}`} style={{ ["--c" as string]: MARKETS[m].color }} onClick={() => game.setMarket(m)} data-testid={`market-${m}`}>
            <span className="market-identity"><b>{m === "nas" ? "Nasdaq" : m === "es" ? "S&P" : m === "us30" ? "Dow" : MARKETS[m].title}</b></span>
          </button>
        ))}
      </div>

      {heldElsewhere.length > 0 && <div className="chips">{heldElsewhere.map(m => <button className="chip" key={m} onClick={() => game.setMarket(m)}>View {MARKETS[m].title} position</button>)}</div>}

      <div ref={chartCard} className={`chart-card ${big ? "chart-fullscreen" : ""}`} role={big ? "dialog" : undefined} aria-modal={big || undefined} aria-label={big ? "Fullscreen chart" : undefined}>
        <div className="chart-utilities">
          <div className="instrument-title">{crypto ? `${MARKETS[market].title} · Paper crypto` : MARKETS[market].subtitle}<span className="badge" data-testid="live-badge" style={{ color: open ? "var(--lime)" : "var(--muted)" }}><span className="dot" style={{ width: 4, height: 4, ["--c" as string]: open ? "var(--lime)" : "var(--muted)" }} />{open ? "LIVE" : "CLOSED"}</span></div>
          <div className="chart-actions">
          <button type="button" className="chart-utility history-switch" aria-pressed={showHistory} aria-label={showHistory ? "Hide closed trades on chart" : "Show closed trades on chart"} onClick={() => { const next = !showHistory; setShowHistory(next); try { localStorage.setItem("brokie.chartHistory", next ? "on" : "off"); } catch { /* */ } }} data-testid="history-toggle"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M3 11a9 9 0 1 1 2 7M3 5v6h6m3-5v6l4 2"/></svg></button>
          <button type="button" className="chart-utility chart-info-btn" onClick={() => setChartInfo(!chartInfo)} aria-expanded={chartInfo} aria-label="Chart info"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v1"/></svg></button>
          <button className={`chart-corner-toggle ${big ? "on" : ""}`} aria-pressed={big} data-testid="big-chart"
            aria-label={big ? "Exit fullscreen chart" : "Open fullscreen chart"} onClick={toggleBig}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d={big ? "M3 8h5V3m8 0v5h5M3 16h5v5m8 0v-5h5" : "M8 3H3v5m13-5h5v5M3 16v5h5m8 0h5v-5"} /></svg></button>
          </div>
        </div>
        <div className="row between market-heading" style={{ alignItems: "flex-start" }}>
          <div>

            <div className="row" style={{ gap: 8, alignItems: "baseline", marginTop: 6 }}>
              <span className="quote"><TickValue value={quote}>{quote ? px(quote, digits(market)) : "—"}</TickValue></span>
              <span className={`mono ${change >= 0 ? "lime" : "red"}`} style={{ fontSize: 11, fontWeight: 600 }}>{change >= 0 ? "+" : "−"}{px(Math.abs(change), digits(market))}</span>
            </div>
          </div>


        </div>
        <FloorPresence market={market} showMarkers={crowd} onMarkers={()=>{setCrowd(v=>!v);try{localStorage.setItem("brokie.crowd",crowd?"off":"on");}catch{/* */}}} onSquad={()=>{setBig(false);goSquad();}} toast={toast}/>
        {settled && <div className="trade-success" role="status" data-testid="trade-success"><span>Trade closed · {settled.title}</span><b>{signedMoney(settled.pnl)}</b></div>}
        <BrokieChart fullscreen={big} height={big ? bigH : previewH} handle={me.handle} market={market} candles={candles} bucketSeconds={st.candleSeconds} quote={quote} positions={stacks.map((x) => x.merged)} style={style}
          brackets={st.brackets} onBracket={saveProtection} onClearBracket={clearProtection}
          sizePctOf={(p) => { const v = st.bubbles.filter((b) => b.is_you && b.state === "open" && b.side === p.side).reduce((s, b) => s + (b.size_pct ?? 0), 0); return v || null; }}
          // History is opt-in; current squad entries stay visible by default.
          overlay={(toXY, width, height) => <>
            <BubbleLayer key={`${market}:${game.squad?.id ?? ""}`} height={height} showHistory={showHistory} now={game.now()} bubbles={chartBubbles} market={market} quote={quote} toXY={toXY} width={width} onSelect={pick}
              onZoomOut={st.frames.some((f) => f > st.candleSeconds) ? () => game.setCandleSeconds(st.frames.find((f) => f > st.candleSeconds)!) : undefined}
              onEnter={()=>{}} />
            {!candles.length && <div className="chart-empty" role="status"><span aria-hidden="true">⌁</span><b>Waiting for the market</b><small>Fresh prices and candles will appear here.</small></div>}
          </>} />
        {!open && <div className="chart-attribution">{crypto ? "Crypto orders open during the weekend trading session." : "Market closed · new trades resume when prices are live."}</div>}
        {big && orderDock}
      </div>

      <SessionClock market={market} compact />
      {!big && orderDock}


      </div>
      <Sheet open={accountOpen} onClose={()=>setAccountOpen(false)}><div className="account-detail stack" data-testid="account-sheet"><div className="row between"><h2 className="h2">Account & risk</h2><button type="button" className="text-action" onClick={()=>setAccountOpen(false)}>Done</button></div><p className="account-context">{money(base,0)} starting balance · Simulated funds</p>
      <section className={`account-hero account-compact ${rules?.status ?? "active"}`}>
        <div className="account-summary">
          <div><Eyebrow>Account equity · USD</Eyebrow><div className="equity" data-testid="equity"><TickValue value={equity}>{money(equity)}</TickValue></div></div>
          <div className="account-season"><Eyebrow>Season {me.season_number ?? ""}</Eyebrow>
            <button type="button" className={`gain-btn ${equity >= base ? "lime" : "red"}`} onClick={() => { setAccountOpen(false); setPnlInfo(true); }} data-testid="pnl-info" aria-label="Season P&L. How is this calculated?">{signedMoney(equity - base)} <span aria-hidden="true">ⓘ</span></button>
            <small className="season-return">{equity >= base ? "+" : ""}{((equity - base) / base * 100).toFixed(2)}%{rules?.funded ? <span className="chip-status" data-testid="funded-chip">Funded</span> : rules?.target_hit ? <span className="chip-status" data-testid="target-chip">Target hit</span> : null}</small>
          </div>
        </div>
        {rules && <RuleStatus rules={rules} toast={toast} goHistory={goHistory} />}
        {rules && <Meters rules={rules} equity={equity} />}
      </section>
      <SessionClock market={market} alerts={false} /><EventStrip compact />
      <button type="button" className="text-action" onClick={()=>{setAccountOpen(false);goHistory();}}>View trade history ↗</button></div></Sheet>
      <Sheet open={chartInfo} onClose={()=>setChartInfo(false)}><div className="stack"><div className="row between"><h2 className="h2">Your chart</h2><button type="button" className="text-action" onClick={()=>setChartInfo(false)}>Done</button></div>        <div className="chart-help muted">{hi !== null && <>High {px(hi)} · Low {px(lo!)}. </>}{big ? "Pinch to zoom, drag to pan, double-tap to return live." : "Preview locked. Use the top-right expand button to pan, zoom and trade fullscreen."} Pictures mark entries: green ↑ is long, red ↓ is short. Tap grouped pictures to see everyone and each trade. Small crosses mark exits.</div>
</div></Sheet>
      <Sheet open={positionsOpen} onClose={() => setPositionsOpen(false)}>
        <div className="stack" data-testid="positions-sheet">
          <div className="row between"><h2 className="h2">Your open positions</h2><button className="text-action" aria-label="Close positions" onClick={() => setPositionsOpen(false)}>Done</button></div>
          <TradingStatus market={market} />
          {stacks.length ? positionCards : <div className="floor-empty"><span aria-hidden="true">↗</span><b>You’re flat. Room for a fresh setup.</b><p>Your open trades and their protection will appear here.</p></div>}
          <small className="muted">Unrealised P&amp;L covers all open trades in USD.</small>
        </div>
      </Sheet>
      <Sheet open={protectionId !== null} onClose={() => setProtectionId(null)}>
        {protectionId && <ProtectionEditor key={protectionId} id={protectionId} toast={toast} onClose={() => setProtectionId(null)} />}
      </Sheet>
      <PnlSheet open={pnlInfo} onClose={() => setPnlInfo(false)} equity={equity} unrealized={unrealized} base={base} />
    </div>
  );
}

function TradingStatus({ market, onOpen, swipeHint, disabled }: { market: Market; onOpen?: () => void; swipeHint?: string; disabled?: boolean }) {
  const st = useGame(), now = useNow(1000) + st.clockOffset;
  const summary = tradingSummary(st.me?.positions ?? [], st.me?.quotes ?? [], market, now);
  const value = summary.pnl === null ? "—" : summary.flat ? "$0.00" : signedMoney(summary.pnl);
  const tone = summary.flat || summary.pnl === null ? "muted" : summary.pnl >= 0 ? "lime" : "red";
  const exposure = [summary.long ? `LONG ${summary.long}` : "", summary.short ? `SHORT ${summary.short}` : ""].filter(Boolean).join(" · ") || "FLAT";
  const content = <><span className="dock-pnl"><small>Unrealised <span>· all trades</span></small><b className={tone} data-testid="live-unrealised">{value}</b>{summary.stale && <em>{summary.pnl === null ? "Waiting for prices" : "Last quoted prices"}</em>}</span>
    <span className="dock-exposure">{st.bracketSaving && <em className="protection-saving" role="status">Saving SL/TP…</em>}<small className={st.me?.rules?.status === "locked" || st.me?.rules?.status === "blown" ? "red" : ""}>{st.me?.rules?.status === "locked" ? "Daily limit reached" : st.me?.rules?.status === "blown" ? "Season max-loss reached" : `${MARKETS[market].title} · ${exposure}`}</small><b>{summary.groups ? `${summary.groups} open position${summary.groups === 1 ? "" : "s"}` : "No open positions"}{onOpen && <span aria-hidden="true"> ›</span>}</b>{swipeHint && <em className="quick-close-hint">{swipeHint}</em>}</span></>;
  return onOpen ? <button className="dock-status" onClick={onOpen} disabled={disabled} aria-busy={disabled || undefined} aria-label="View open positions and unrealised P&L" data-testid="trading-status">{content}</button> : <div className="dock-status">{content}</div>;
}

function ProtectionEditor({ id, toast, onClose }: { id: string; toast: (message: string) => void; onClose: () => void }) {
  const st = useGame();
  const stack = stacksOf(st.me?.positions ?? []).find(stack => stack.ids.includes(id));
  const p = stack?.merged, saved = st.brackets[p?.id ?? id] ?? {};
  const [levels, setLevels] = useState({ sl: saved.sl?.toString() ?? "", tp: saved.tp?.toString() ?? "" });
  const [unit, setUnit] = useState<"price" | "pnl">("price");
  const busy = !!st.bracketSaving;
  const draftPrice = (kind: "sl" | "tp") => !p || !levels[kind].trim() ? null : unit === "pnl" ? priceForPnl(p, kind, Number(levels[kind])) : Number(levels[kind]);
  function changeUnit(next: "price" | "pnl") {
    if (!p || next === unit) return;
    setLevels(prev => Object.fromEntries((["sl","tp"] as const).map(kind => {
      if (!prev[kind].trim()) return [kind, ""];
      const price = draftPrice(kind);
      const amount = price != null && Number.isFinite(price) ? protectionPnl(p, price) * (kind === "tp" ? 1 : -1) : null;
      return [kind, next === "price" ? price != null ? String(price) : "" : amount != null && amount > 0 ? amount.toFixed(2) : ""];
    })) as { sl: string; tp: string });
    setUnit(next);
  }
  async function submit(kind: "sl" | "tp", remove = false) {
    if (!p) return;
    try {
      if (remove) await game.clearBracket(p.id, kind);
      else {
        const value = draftPrice(kind);
        if (value === null || !Number.isFinite(value) || value <= 0) { toast(unit === "price" ? "Enter a valid market price." : "Enter a positive dollar amount for this position."); return; }
        await game.setBracket(p.id, { [kind]: value });
      }
      if (remove) setLevels(prev => ({ ...prev, [kind]: "" }));
      toast(remove ? `${kind.toUpperCase()} removed` : `${kind.toUpperCase()} saved on server`);
    } catch (e) { toast((e as Error).message || "Change was not confirmed. Try again."); }
  }
  return <div className="stack protection-editor" data-testid="protection-editor">
    <div className="row between"><div><Eyebrow>Position protection</Eyebrow><h2 className="h2">{p ? `${MARKETS[p.market].title} · ${p.side.toUpperCase()} ×${p.quantity}` : "Position closed"}</h2></div><button className="text-action" onClick={onClose}>Done</button></div>
    {p ? <>
      <p className="muted">Saved orders stay active when you close the app. A triggered stop fills at the next available feed price, which can differ from your level.</p>
      <div className="protection-context"><span>Current {MARKETS[p.market].title} price <b>{game.quote(p.market) ? px(game.quote(p.market)!.price,digits(p.market)) : "—"}</b></span><small>Targets apply to {p.quantity} {p.quantity === 1 ? "micro" : "micros"} {p.side === "long" ? "long" : "short"} at {px(p.entry_price,digits(p.market))}.</small></div>
      <div className="seg" role="group" aria-label="Target units"><button type="button" aria-pressed={unit === "price"} className={unit === "price" ? "on" : ""} disabled={busy} onClick={()=>changeUnit("price")}>Market price</button><button type="button" aria-pressed={unit === "pnl"} className={unit === "pnl" ? "on" : ""} disabled={busy} onClick={()=>changeUnit("pnl")}>Profit / loss ($)</button></div>
      <p className="protection-unit-note">{unit === "price" ? "Enter the market’s price, not the dollar profit you want." : "Enter the profit to take or loss to cap for this position. We convert it to a market price."}</p>
      {(["sl", "tp"] as const).map(kind => {
        const draft = draftPrice(kind), valid = draft != null && Number.isFinite(draft) && draft > 0;
        const snapped = valid ? Math.round(draft / MARKETS[p.market].tick) * MARKETS[p.market].tick : null;
        return <form key={kind} onSubmit={e => { e.preventDefault(); void submit(kind); }} className="protection-row">
        <label htmlFor={`protect-${kind}`}>{kind === "sl" ? "Stop loss" : "Take profit"}<small className={saved[kind] != null ? "lime" : "muted"}>{saved[kind] != null ? `Active · ${px(saved[kind]!, digits(p.market))}` : "Not set"}</small></label>
        <div className="row"><input id={`protect-${kind}`} aria-label={`${kind === "sl" ? "Stop loss" : "Take profit"} ${unit === "price" ? "price" : "amount"}`} aria-describedby={`protect-${kind}-preview`} inputMode="decimal" placeholder={unit === "price" ? `${MARKETS[p.market].title} price` : kind === "tp" ? "Profit in USD" : "Loss in USD"} value={levels[kind]} disabled={busy} onChange={e => setLevels(prev => ({ ...prev, [kind]: e.target.value }))}/><button className="protection-save" disabled={busy} type="submit">Save</button>{saved[kind] != null && <button type="button" className="protection-remove" disabled={busy} aria-label={`Cancel ${kind.toUpperCase()}`} onClick={() => void submit(kind,true)}>✕</button>}</div>
        <div className="protection-preview" id={`protect-${kind}-preview`} data-testid={`preview-${kind}`}>{snapped != null ? <><span>Trigger: {MARKETS[p.market].title} {protectionDirection(p,kind)} <b>{px(snapped,digits(p.market))}</b></span><span>Est. position P&amp;L <b className={protectionPnl(p,snapped) >= 0 ? "lime" : "red"}>{signedMoney(protectionPnl(p,snapped))}</b></span><small>Draft until saved · fills can differ after a gap.</small></> : <span>{kind === "tp" ? "A short takes profit as price falls; a long takes profit as price rises." : "Use a market price, or switch to a dollar loss amount."}</span>}</div>
      </form>})}
      {busy && <span className="muted" role="status">Saving… your previous confirmed levels remain active.</span>}
    </> : <p className="muted">This position has closed. Its final result is in your trade history.</p>}
  </div>;
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
  const now = useNow(1000) + game.state.clockOffset;
  const until = rules.unlock_at ? Date.parse(rules.unlock_at) - now : null;
  if (rules.status === "active") return null;
  if (rules.status === "locked") return (
    <div className="status-card" style={{ background: "rgba(255,125,139,.08)", border: "1px solid rgba(255,125,139,.35)" }} data-testid="status-locked">
      <span className="status-symbol" aria-hidden="true">Ⅱ</span>
      <div><b>Daily loss limit hit.</b><div className="muted" style={{ fontSize: 12, marginTop: 3 }}>Positions closed. {until !== null ? until > 0 ? `Daily allowance resets in ${sessionCountdown(until)}.` : "Daily reset reached. Refresh your account." : "Trading resumes at the next daily reset."}</div><div className="row" style={{ gap: 16, marginTop: 8 }}><button className="text-action lime" onClick={goHistory}>Review your trades →</button><button className="text-action" disabled={busy} onClick={async () => { setBusy(true); try { await game.refreshState(); } catch (e) { toast((e as Error).message); } finally { setBusy(false); } }}>{busy ? "Refreshing…" : "Refresh status"}</button></div></div>
    </div>
  );
  return (
    <div className="status-card" style={{ background: "#1b1b1b", border: "1px solid #444", flexDirection: "column", alignItems: "stretch" }} data-testid="status-blown">
      <div className="row"><span className="status-symbol" aria-hidden="true">↘</span>
        <div><b style={{ fontSize: 17 }}>Season max-loss limit reached.</b><div className="muted" style={{ fontSize: 12, marginTop: 6, lineHeight:1.7 }}>This is separate from the daily lock. A new trading day won't reset it.<br />Equity {money(rules.equity)} · season floor {money(rules.drawdown_floor)}.</div></div></div>
      {rules.resets_used === 0 ? (
        <button className="big-btn lime" style={{ marginTop: 12 }} disabled={busy} data-testid="buy-back"
          onClick={async () => { setBusy(true); try { await game.buyBack(); toast(`Back in. ${rules.daily_loss_amount ? money(rules.daily_loss_amount, 0) : "4%"} daily limit, and 5 new trading days to qualify.`); } catch (e) { toast((e as Error).message); } setBusy(false); }}>
          {busy ? <span className="spinner" /> : "Use free restart"}
        </button>
      ) : <div className="muted" style={{ fontSize: 12, marginTop: 10 }}>Your one restart has been used. Trading resumes next season.</div>}
      {rules.resets_used === 0 && <small className="muted">Restarts at {money(rules.start_balance,0)} paper funds, with a {rules.daily_loss_amount ? money(rules.daily_loss_amount,0) : "4%"} daily limit and 5 new qualifying days. One restart per season.</small>}
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

const buzz = haptic;

/** Tap and hold retain the server's batching, partial and hedge rules. */
function SpamPad({ toast, disabled }: { toast: (m: string) => void; disabled: boolean }) {
  const st = useGame();
  const legs = (st.me?.positions ?? []).filter((p) => p.market === st.market);
  /** One tap: +1 micro to the order being collected. `held` = the button is held down, so the
   *  order waits for the release (or fills to 10) instead of sending 300 ms after the tap. */
  function tap(side: Side, held = false) {
    if (disabled) return;
    const cur = game.state.pending;
    const n = cur && cur.side === side ? cur.count : 0;
    const cap = game.tapReduces(side) ? game.heldAgainst(side) : 100;
    if (n >= cap) { haptic(10); return; }
    haptic(8); orderEffect(readEffect());
    game.tap(side, done(side), held);
  }
  /** What happens when an order (a batch of taps) comes back from the server. */
  function done(side: Side) {
    const hedging = legs.some((p) => p.side !== side) && !legs.some((p) => p.side === side);
    const market = MARKETS[st.market].title;
    return (err: string | null, q: number, pnl?: number) => {
      if (err) { stopHold(false); game.dropTaps(); haptic(10); toast(err); }
      else if (pnl !== undefined) { buzz(pnl >= 0 ? [10, 40, 18] : [40, 30, 40]); toast(`Closed ${q} ${market} · ${signedMoney(pnl)}`); }
      else { buzz([10, 40, 18]); toast(`${hedging ? "Hedged" : side === "long" ? "Bought" : "Sold"} ${q} micro${q === 1 ? "" : "s"} ${market}`); }
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
    const label = side === "long" ? "BUY" : "SELL";
    return (
      <button type="button" className={`spam-btn ${side}`} disabled={disabled}
        onPointerDown={(e) => { if (!e.isPrimary || e.button !== 0) return; e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); startHold(side); }} onPointerUp={() => stopHold()} onPointerCancel={() => { stopHold(false); game.dropTaps(); }} onLostPointerCapture={() => stopHold()}
        onContextMenu={(e) => e.preventDefault()}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); if (!e.repeat) tap(side); } }}
        onKeyUp={(e) => { if ((e.key === "Enter" || e.key === " ") && game.state.pending) game.armTaps(done(side)); }}
        data-testid={side === "long" ? "go-long" : "go-short"} id={side === "long" ? "go-long" : "go-short"}>
        <span className="spam-label">{label}</span>
      </button>
    );
  };
  return <div className="spam-pad" data-testid="spam-pad">{btn("long")}{btn("short")}</div>;
}

/** Drag a position sideways and release past 40% to close. Cancellation never closes. */
function SwipeCard({ p, pnl, busy, disabled, hedged, onClose, protection, onProtection }:
  { p: Position; pnl: number | null; busy: boolean; disabled: boolean; hedged: boolean; onClose: () => Promise<boolean>; protection?: { sl?: number; tp?: number }; onProtection: () => void }) {
  const [dx, setDx] = useState(0);
  const [phase, setPhase] = useState<"idle" | "drag" | "fly" | "back" | "gone">("idle");
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
      el.removeEventListener("pointermove", move); el.removeEventListener("pointerup", up); el.removeEventListener("pointercancel", cancel);
      if (!locked) return;
      if (armed.current) {
        armed.current = false;
        const dir = Math.sign(lastDx || 1);
        setPhase("fly"); setDx(dir * (w() + 60));
        buzz(win ? [10, 40, 18] : [40, 30, 40]);
        const ok = await onClose();
        if (ok) setPhase("gone"); else { setPhase("back"); setDx(0); }
      } else { setPhase("back"); setDx(0); }
    };
    const cancel = () => {
      el.removeEventListener("pointermove", move); el.removeEventListener("pointerup", up); el.removeEventListener("pointercancel", cancel);
      armed.current = false; setPhase("back"); setDx(0);
    };
    el.addEventListener("pointermove", move); el.addEventListener("pointerup", up); el.addEventListener("pointercancel", cancel);
  }
  const over = Math.abs(dx) > w() * 0.4;
  const tint = phase === "drag" && over ? (win ? "tint-win" : "tint-loss") : "";
  return (
    <div className={`swipe-wrap ${phase === "gone" ? "collapse" : ""}`} data-testid="position">
      <div className={`swipe-bg ${win ? "win" : "loss"}`} style={{ opacity: Math.min(1, Math.abs(dx) / (w() * 0.4)) }}>
        <span>Close trade</span><span>Close trade</span>
      </div>
      <div ref={ref} className={`pos-card ${tint} ${phase}`} onPointerDown={down}
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
        <button className="position-protection" type="button" disabled={disabled} onPointerDown={e => e.stopPropagation()} onClick={onProtection} aria-label={`Manage SL/TP for ${MARKETS[p.market].title} ${p.side}`}><span>SL <b>{protection?.sl != null ? px(protection.sl, digits(p.market)) : "—"}</b></span><span>TP <b>{protection?.tp != null ? px(protection.tp, digits(p.market)) : "—"}</b></span><span className="manage-protection">Edit SL/TP ↗</span></button>
      </div>
    </div>
  );
}
