import { PlayerLink } from "./Profiles";
import { useEffect, useRef, useState } from "react";
import { BubbleLayer } from "./Bubbles";
import type { Bubble, Rules } from "./types";
import { TAP_SIZE, frameLabel, game, stacksOf, useGame } from "./game";

import { shareInvite } from "./Squad";
import { BrokieChart, CHART_SMALL } from "./Chart";
import { Button, Eyebrow, Sheet, TickValue, ago, hintDone, hintOn, money, px, sessionOpenLabel, signedMoney } from "./ui";
import { MARKETS, Market, Position, Side, digits, pnlOf } from "./types";


export function TradeScreen({ toast, goSquad, goHistory }: { toast: (m: string) => void; goSquad: () => void; goHistory: () => void }) {
  const st = useGame();
  const me = st.me!;
  const [crowd, setCrowd] = useState(() => { try { return localStorage.getItem("brokie.crowd") !== "off"; } catch { return true; } });
  const lastEnterToast = useRef(0);
  const [style, setStyle] = useState<"candles" | "line">(() => (localStorage.getItem("brokie.style") as "line") || "candles");
  const [closing, setClosing] = useState<string | null>(null);
  const [pnlInfo, setPnlInfo] = useState(false);
  const [chartInfo, setChartInfo] = useState(false);
  const [big, setBig] = useState(false);
  const [viewportH, setViewportH] = useState(window.visualViewport?.height ?? window.innerHeight);
  useEffect(() => {
    const resize = () => setViewportH(window.visualViewport?.height ?? window.innerHeight);
    window.addEventListener("resize", resize); window.visualViewport?.addEventListener("resize", resize);
    return () => { window.removeEventListener("resize", resize); window.visualViewport?.removeEventListener("resize", resize); };
  }, []);
  const bigH = Math.max(120, viewportH - (window.innerWidth <= 360 ? 290 : 240));
  // Remember where the page was BEFORE the chart leaves the page flow: once it's fixed, the browser
  // shifts the scroll position to keep content in place, and reading it then would be ~a chart too high.
  const pageScroll = useRef({ x: 0, y: 0 });
  const toggleBig = () => { if (!big) pageScroll.current = { x: window.scrollX, y: window.scrollY }; setBig(v => !v); };
  useEffect(() => {
    if (!big) return;
    const { x, y } = pageScroll.current;
    const body = document.body, root = document.documentElement;
    const bodyStyle = body.style.cssText, rootStyle = root.style.cssText;
    Object.assign(body.style, { position: "fixed", top: `-${y}px`, left: `-${x}px`, width: "100%", overflow: "hidden", touchAction: "none", overscrollBehavior: "none" });
    Object.assign(root.style, { overflow: "hidden", touchAction: "none", overscrollBehavior: "none" });
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
  const unrealized = me.positions.reduce((s, p) => s + (mark(p.market) ? pnlOf(p, mark(p.market)!) : 0), 0);
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
  const shown = (Object.keys(MARKETS) as Market[]).filter((m) => m === market || mark(m) !== null || !me.quotes?.length);
  const candles = game.liveCandles(market);
  const quote = mark(market);
  const open = game.isOpen(market);
  const change = quote && candles[0] ? quote - candles[0].open : 0;
  const hi = candles.length ? Math.max(...candles.map((c) => c.high)) : null;
  const lo = candles.length ? Math.min(...candles.map((c) => c.low)) : null;

  const stacks = stacksOf(me.positions);
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

  return (
    <div className="stack trade-screen">
      <section className={`account-hero ${rules?.status ?? "active"}`}>
      <div className="row between account-summary" style={{ alignItems: "flex-end" }}>
        <div>
          <Eyebrow>Season {me.season_number ?? ""} challenge · USD</Eyebrow>
          <div className="equity" data-testid="equity"><TickValue value={equity}>{money(equity)}</TickValue></div>
          <div className={`season-gain ${equity >= base ? "lime" : "red"}`}>
            <button type="button" className="gain-btn" onClick={() => setPnlInfo(true)} data-testid="pnl-info" aria-label="Season P&L. How is this calculated?">{equity >= base ? "↗" : "↘"} {signedMoney(equity - base)} · {((equity - base) / base * 100).toFixed(2)}% <span className="muted">ⓘ</span></button>
            {rules?.funded ? <span className="chip-status" style={{ background: "rgba(242,202,115,.15)", color: "var(--gold)" }} data-testid="funded-chip">🏆 FUNDED</span>
              : rules?.target_hit && <span className="chip-status" style={{ background: "rgba(214,254,89,.12)", color: "var(--lime)" }} data-testid="target-chip">🎯 TARGET HIT</span>}
          </div>
        </div>
      </div>

      {rules && <RuleStatus rules={rules} toast={toast} goHistory={goHistory} />}
      {rules && <Meters rules={rules} equity={equity} />}
      </section>

      <div className={`markets ${shown.length > 3 ? "four" : ""}`} style={{ ["--n" as string]: shown.length }}>
        {shown.map((m) => (
          <button key={m} className={`market ${market === m ? "on" : ""}`} style={{ ["--c" as string]: MARKETS[m].color }} onClick={() => game.setMarket(m)} data-testid={`market-${m}`}>
            <div className="row" style={{ gap: 6 }}><span className="dot" /><b>{MARKETS[m].title}</b></div>
            <span className="mono">{mark(m) ? px(mark(m)!, digits(m)) : "—"}</span>
          </button>
        ))}
      </div>

      <div className={`chart-card ${big ? "chart-fullscreen" : ""}`} role={big ? "dialog" : undefined} aria-modal={big || undefined} aria-label={big ? "Fullscreen chart" : undefined}>
        <div className="row between market-heading" style={{ alignItems: "flex-start" }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600 }}>{MARKETS[market].subtitle} <span className="mono muted" style={{ fontSize: 9 }}>{MARKETS[market].symbol}</span></div>
            <div className="row" style={{ gap: 8, alignItems: "baseline", marginTop: 6 }}>
              <span className="quote"><TickValue value={quote}>{quote ? px(quote, digits(market)) : "—"}</TickValue></span>
              <span className={`mono ${change >= 0 ? "lime" : "red"}`} style={{ fontSize: 11, fontWeight: 600 }}>{change >= 0 ? "+" : "−"}{px(Math.abs(change), digits(market))}</span>
            </div>
          </div>
          <span className="row" style={{ gap: 6 }}>
          <button className="text-action muted chart-info-btn" onClick={() => setChartInfo(!chartInfo)} aria-expanded={chartInfo} aria-label="Chart info">ⓘ</button>
          <span className="badge" data-testid="live-badge" style={{ color: open ? "#fff" : "var(--muted)" }}>
            <span className="dot" style={{ width: 5, height: 5, ["--c" as string]: open ? "var(--red)" : "var(--muted)" }} />{open ? "LIVE" : "MARKET CLOSED"}
          </span>
          </span>
        </div>
        {chartInfo && <div className="chart-help muted">{hi !== null && <>High {px(hi)} · Low {px(lo!)}. </>}Pinch to zoom, drag to pan, double-tap to return live.</div>}
        <BrokieChart height={big ? bigH : CHART_SMALL} handle={me.handle} market={market} candles={candles} bucketSeconds={st.candleSeconds} quote={quote} positions={stacks.map((x) => x.merged)} style={style}
          brackets={st.brackets} onBracket={(id, b) => { game.setBracket(id, b); if (cardHint) { hintDone("cards"); setCardHint(false); } }} onClearBracket={(id, k) => game.clearBracket(id, k)}
          sizePctOf={(p) => { const v = st.bubbles.filter((b) => b.is_you && b.state === "open" && b.side === p.side).reduce((s, b) => s + (b.size_pct ?? 0), 0); return v || null; }}
          // Your own past trades always show; the 👥 toggle only hides friends'.
          overlay={(toXY, width) => st.bubbleScope === `${market}:${game.squad?.id ?? ""}` && <>
            <BubbleLayer key={`${market}:${game.squad?.id ?? ""}`} now={game.now()} hideMine bubbles={crowd ? st.bubbles : st.bubbles.filter((b) => b.is_you)} market={market} quote={quote} toXY={toXY} width={width} onSelect={pick}
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
            <span aria-hidden="true">{style === "candles" ? "▮▮" : "∿"}</span>
          </button>
          {/* One timeframe button: shows the current timeframe; tap to step down to the next one in your list (You tab), wrapping back to the highest. */}
          <button type="button" className="chip lime on frame-btn" data-testid="frame-btn" onClick={() => game.nextFrame()} disabled={st.frames.length < 2}
            aria-label={`${frameLabel(st.candleSeconds)} candles${st.frames.length > 1 ? `. Tap for ${frameLabel(game.frameAfter())}` : ""}`}>{frameLabel(st.candleSeconds)}</button>
          <button className={`chip lime ${big ? "on" : ""}`} style={{ marginLeft: "auto" }} aria-pressed={big} data-testid="big-chart"
            aria-label={big ? "Smaller chart" : "Bigger chart"} onClick={toggleBig}>{big ? "⤡" : "⤢"}</button>
          <button className={`chip lime ${crowd ? "on" : ""}`} aria-pressed={crowd} data-testid="crowd-toggle"
            aria-label={crowd ? "Hide squad trades on the chart" : "Show squad trades on the chart"}
            onClick={() => { const v = !crowd; setCrowd(v); try { localStorage.setItem("brokie.crowd", v ? "on" : "off"); } catch { /* */ } }}>
            <span className="crowd-chip">👥{crowd && longs > 0 && <span className="lime">{longs}▲</span>}{crowd && shorts > 0 && <span className="red">{shorts}▼</span>}</span>
          </button>
        </div>
        <div className="chart-attribution">
          Real market prices from OANDA, fake money. Not financial advice. {!open && "Market’s closed. New trades open when prices are live again."}
          {" "}Charts by <a href="https://www.tradingview.com/" target="_blank" rel="noopener noreferrer">TradingView</a>
          {" "}(<a href="./tradingview-NOTICE.txt" target="_blank" rel="noopener noreferrer">notice</a>).
        </div>
      </div>

      <div className="trade-dock"><SpamPad toast={toast} disabled={rules?.status === "blown" || rules?.status === "locked" || !open} /></div>

      <div className="stack" style={{ gap: 12 }}>
        <div className="row between"><h2 className="h2">Your positions</h2><span className="eyebrow">{stacks.length} open</span></div>
        {me.positions.length === 0 && (
          <div className="panel" style={{ padding: 18, borderRadius: 15 }}>
            <b style={{ fontSize: 13 }}>No open positions.</b>
            <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>{me.trades.length > 0 || (rules && rules.status !== "active") ? "Your closed trades are in your history." : "Pick a market and make your first paper trade."}</div>
          </div>
        )}
        {stacks.map(({ merged: p, ids }) => {
          const m = mark(p.market); const pnl = m ? pnlOf(p, m) : 0;
          return <SwipeCard key={p.id} p={p} pnl={pnl} busy={closing === p.id} disabled={!!closing}
            hedged={me.positions.some((q) => q.market === p.market && q.side !== p.side)}
            onClose={() => { if (cardHint) { hintDone("cards"); setCardHint(false); } return close(p.id, ids, `${MARKETS[p.market].title} x${p.quantity}`); }} />;
        })}
        {me.positions.length > 0 && cardHint && <div className="muted" style={{ fontSize: 10, textAlign: "center" }}>Swipe a card away to close · drag your position pill on the chart for SL/TP</div>}
      </div>


      <PnlSheet open={pnlInfo} onClose={() => setPnlInfo(false)} equity={equity} unrealized={unrealized} base={base} />
    </div>
  );
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
          The big number up top is your whole account: cash plus what your open trades are worth right now. Each position row shows only <b>that trade's</b> open P&amp;L, so the rows won't add up to the season number once you've closed trades.
          Prices are the live midpoint, and practice fills don't charge spread or commission. Your Receipts list shows the latest 50 closed trades; the totals here cover the whole season.
        </div>
        <Button variant="ghost" onClick={onClose}>Got it</Button>
      </div>
    </Sheet>
  );
}

export function Pit({ goSquad, toast, full = false }: { goSquad: () => void; toast: (m: string) => void; full?: boolean }) {
  const st = useGame();
  const squad = game.squad;
  const [busy, setBusy] = useState(false);
  async function invite() {
    if (!squad || busy) return;
    setBusy(true);
    const r = await shareInvite(squad);
    setBusy(false);
    if (r === "copied") toast("Invite copied. Paste it in the group chat.");
    else if (r === "failed") toast(`Couldn't copy. Your code is ${squad.invite_code}.`);
  }
  return (
    <div className="stack pit-section" style={{ gap: 12 }}>
      <div className="row between"><h2 className="h2">The pit</h2><span className="eyebrow">{squad?.name ?? "Your squad"}</span></div>
      {!squad ? (
        <div className="panel stack" style={{ padding: 16, gap: 10 }} data-testid="pit-empty">
          <b style={{ fontSize: 13 }}>It's quiet. Trading is better with mates.</b>
          <div className="muted" style={{ fontSize: 12 }}>Start a squad to get an invite link, then send it to the group chat.</div>
          <button className="big-btn lime" style={{ height: 42, fontSize: 13 }} onClick={goSquad} data-testid="pit-start-squad">Start a squad to invite friends ↗</button>
        </div>
      ) : st.feed.length === 0 ? (
        <div className="panel stack" style={{ padding: 16, gap: 10 }} data-testid="pit-empty">
          <span className="muted" style={{ fontSize: 12 }}>Quiet in here. Be the first to make a move{squad.member_count === 1 ? ", or bring your mates." : "."}</span>
          {squad.member_count === 1 && <button className="big-btn lime" style={{ height: 42, fontSize: 13 }} onClick={invite} disabled={busy} data-testid="pit-invite">{busy ? <span className="spinner" /> : "Invite friends ↗"}</button>}
        </div>
      ) : <ActivityFeed full={full} />}
      {squad && !full && <button className="text-action lime" onClick={goSquad}>Open squad activity →</button>}
    </div>
  );
}

function ActivityFeed({ full }: { full: boolean }) {
  const feed = useGame().feed;
  const groups: typeof feed[] = [];
  for (const event of feed) {
    const prev = groups[groups.length - 1];
    const first = prev?.[0];
    if (first && event.kind === "opened" && first.kind === event.kind && first.handle === event.handle && first.market === event.market && first.side === event.side && Math.abs(Date.parse(first.at) - Date.parse(event.at)) < 60_000) prev.push(event);
    else groups.push([event]);
  }
  return <div className="activity-feed">{(full ? groups : groups.slice(0, 2)).map((events) => events.length === 1
    ? <FeedRow key={`${events[0].kind}-${events[0].id}`} e={events[0]} />
    : <details key={`${events[0].kind}-${events[0].id}`} className="activity-group"><summary>@{events[0].handle} · {events.length} {MARKETS[events[0].market].title} {events[0].side === "long" ? "buys" : "sells"}<span className="muted">View trades</span></summary>{events.map(e => <FeedRow key={e.id} e={e} />)}</details>)}</div>;
}

export function FeedRow({ e }: { e: import("./types").FeedEvent }) {
  const size = `${e.quantity} ${MARKETS[e.market].title}`;
  return (
    <div className="panel" style={{ padding: 14, borderRadius: 16, display: "flex", gap: 11 }}>
      <span className={`av ${e.is_you ? "you" : ""}`} style={{ width: 33, height: 33 }}>{e.handle[0].toUpperCase()}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="row" style={{ gap: 6 }}>
          <b style={{ fontSize: 12 }}><PlayerLink handle={e.handle}>{e.is_you ? "You" : `@${e.handle}`}</PlayerLink></b>
          <span className="muted" style={{ fontSize: 9 }}>{ago(e.at)}</span>
          {(e.kind === "opened" || e.kind === "closed") && <span style={{ marginLeft: "auto", fontSize: 10, fontWeight: 600 }} className={e.side === "long" ? "lime" : "red"}>{MARKETS[e.market].title} {e.side === "long" ? "↑" : "↓"}</span>}
        </div>
        <div style={{ fontSize: 13, marginTop: 5, color: "rgba(255,255,255,.85)" }}>
          {e.kind === "rekt" ? <b style={{ color: "#bbb" }}>💀 Blew the account. REKT.</b>
          : e.kind === "funded" ? <b style={{ color: "var(--gold)" }}>🏆 Funded: +10% and 5 trading days.</b>
          : e.kind === "closed" && e.pnl !== null ? (
            <>{e.reason === "blown" ? `Blown out of ${size} ` : e.reason === "daily_limit" ? `Daily limit closed ${size} ` : `Closed ${e.side} ${size} `}
              <b className={`mono ${e.pnl >= 0 ? "lime" : "red"}`}>{signedMoney(e.pnl)}</b>{e.reason === "closed" && (e.pnl >= 0 ? " 🔥" : " 💀")}</>
          ) : <>Went {e.side} {size} at {px(e.price)}</>}
        </div>
      </div>
    </div>
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
          onClick={async () => { setBusy(true); try { await game.buyBack(); toast("Back in. 4% daily limit, and 5 new trading days to qualify."); } catch (e) { toast((e as Error).message); } setBusy(false); }}>
          {busy ? <span className="spinner" /> : "Use your one buy-back (4% daily · 8% max loss)"}
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
      <div className="meter-caption">{cap}% {id === "meter-daily" ? "daily cap" : trailing ? "trailing limit" : "end-of-day limit"}</div>
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
      <div className="risk-strips" aria-hidden="true">{[["DAILY ROOM", df], ["DRAWDOWN ROOM", dd], ["TARGET", rules.funded || rules.target_hit ? 1 : progress]].map(([label, value]) => <div key={String(label)}><span>{label}</span><i><b style={{ width: `${Math.max(0, Math.min(1, Number(value))) * 100}%`, background: label === "TARGET" ? "var(--lime)" : tone(Number(value)) }} /></i></div>)}</div>
    <details className="rule-summary compact-rules">
      <summary><span>Daily loss room <b style={{ color: tone(df) }}>{money(dailyRoom, 0)}</b></span><span className="muted">Target {Math.round(progress * 100)}% ⌄</span></summary>
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
    const cap = game.tapReduces(side) ? game.heldAgainst(side) : 10;
    if (n >= cap) { buzz([20, 30, 20]); setShake(side); setTimeout(() => setShake(null), 300); return; }
    const lvl = Math.min(2, Math.floor(n / 5));
    buzz([12, 22, 35][lvl]);
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
    if (disabled) { stopHold(); return; }
    const cur = game.state.pending;
    const n = cur && cur.side === side ? cur.count : 0;
    const reduce = game.tapReduces(side);
    const cap = reduce ? game.heldAgainst(side) : 10;
    if (n < cap) { tap(side, true); return; }
    if (reduce) { stopHold(); return; }   // closing: nothing more to take off after this order
    const now = Date.now();
    holdSends.current = holdSends.current.filter((t) => now - t < 10_000);
    if (game.ordersInFlight > 0 || holdSends.current.length >= ORDERS_PER_10S) return;   // wait for a free slot
    holdSends.current.push(now);
    game.sendTapsNow(done(side));
  }
  latest.current.holdStep = holdStep;
  function startHold(side: Side) {
    stopHold();
    tap(side, true);
    const h: NonNullable<typeof hold.current> = { side, start: null, every: null };
    h.start = setTimeout(() => { h.start = null; h.every = setInterval(() => latest.current.holdStep(side), HOLD_EVERY_MS); }, HOLD_DELAY_MS);
    hold.current = h;
  }
  useEffect(() => () => stopHold(), []);
  useEffect(() => { if (disabled) stopHold(false); }, [disabled]);
  useEffect(() => { stopHold(); }, [st.market]);
  useEffect(() => {
    const off = () => stopHold();
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
      <button type="button" className={`spam-btn ${side} combo-tier-${tier} ${squash === side ? "squash" : ""} ${shake === side ? "nope" : ""}`}
        style={{ ["--glow" as string]: String(Math.min(1, n / 10)) }} disabled={disabled}
        onPointerDown={(e) => { e.preventDefault(); startHold(side); }} onPointerUp={() => stopHold()} onPointerCancel={() => stopHold()} onPointerLeave={() => stopHold()}
        onContextMenu={(e) => e.preventDefault()}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); if (e.repeat) holdStep(side); else tap(side); } }}
        onKeyUp={(e) => { if ((e.key === "Enter" || e.key === " ") && game.state.pending) game.armTaps(done(side)); }}
        onAnimationEnd={(e) => { if (e.target === e.currentTarget) setSquash(null); }} data-testid={side === "long" ? "go-long" : "go-short"} id={side === "long" ? "go-long" : "go-short"}>
        {chain && <span key={chain.id} className={`combo-badge tier-${tier}`} data-testid="tap-combo" data-count={chain.count} data-side={side} aria-hidden="true">
          <span className="combo-count">{chain.count}</span><span className="combo-copy"><b>{tier === 3 ? "UNREAL" : tier === 2 ? "ON FIRE" : "COMBO"}</b><small>TAP STREAK</small></span><span className="combo-symbol">{tier >= 2 ? "🔥" : "ϟ"}</span><i className="combo-fuse" />
        </span>}
        <span className="spam-label">{side === "long" ? "↗" : "↘"} {label}</span>
        <span className="spam-sub">{n ? `${sign}${n}` : partial ? `tap = close ${TAP_SIZE}` : hedge ? "tap = hedge" : tapHint ? `tap ${sign}${TAP_SIZE} · hold = spam` : "\u00a0"}</span>
        {pops.filter((p) => p.side === side).map((p) => <span key={p.id} className="tap-feedback" aria-hidden="true"><span className="tap-fx"><i className="tap-ring" /><i className="tap-spark spark-one" /><i className="tap-spark spark-two" /><i className="tap-spark spark-three" /></span><span className="spam-pop">{sign}{TAP_SIZE}</span></span>)}
      </button>
    );
  };
  return <div className="spam-pad" data-testid="spam-pad">{btn("long")}{btn("short")}</div>;
}

/** Ticket 16: a position as a clean card. Drag it sideways; past 40% it tints (lime win / red
 *  loss) and buzzes; let go past that and it flies off and closes (confetti or crack). */
function SwipeCard({ p, pnl, busy, disabled, hedged, onClose }:
  { p: Position; pnl: number; busy: boolean; disabled: boolean; hedged: boolean; onClose: () => Promise<boolean> }) {
  const [dx, setDx] = useState(0);
  const [phase, setPhase] = useState<"idle" | "drag" | "fly" | "back" | "gone">("idle");
  const [fx, setFx] = useState<"win" | "loss" | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const armed = useRef(false);
  const win = pnl >= 0;
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
        setFx(win ? "win" : "loss");
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
        <span className={`mono pos-pnl ${win ? "lime" : "red"}`}><TickValue value={pnl}>{signedMoney(pnl)}</TickValue></span>
        {busy && <span className="spinner" style={{ width: 12, height: 12 }} />}
      </div>
      {fx === "win" && <div className="confetti" aria-hidden="true">{Array.from({ length: 14 }, (_, i) => <i key={i} style={{ ["--i" as string]: i }} />)}</div>}
    </div>
  );
}
