import { PlayerLink } from "./Profiles";
import { useEffect, useRef, useState } from "react";
import { BubbleLayer } from "./Bubbles";
import type { Bubble, Rules } from "./types";
import { TAP_SIZE, game, stacksOf, useGame } from "./game";

import { shareInvite } from "./Squad";
import { BrokieChart, CHART_SMALL } from "./Chart";
import { Button, Eyebrow, Sheet, ago, hintDone, hintOn, money, px, signedMoney } from "./ui";
import { MARKETS, Market, Position, Side, pnlOf } from "./types";

const FRAMES = [{ s: 60, l: "1m" }, { s: 300, l: "5m" }, { s: 900, l: "15m" }];

export function TradeScreen({ toast, goSquad, goHistory }: { toast: (m: string) => void; goSquad: () => void; goHistory: () => void }) {
  const st = useGame();
  const me = st.me!;
  const [crowd, setCrowd] = useState(() => { try { return localStorage.getItem("brokie.crowd") !== "off"; } catch { return true; } });
  const lastEnterToast = useRef(0);
  const [style, setStyle] = useState<"candles" | "line">(() => (localStorage.getItem("brokie.style") as "line") || "candles");
  const [closing, setClosing] = useState<string | null>(null);
  const [pnlInfo, setPnlInfo] = useState(false);
  const [chartInfo, setChartInfo] = useState(false);
  // Fuko: a bigger chart option. Tall mode uses most of the screen; remembered per device.
  const [big, setBig] = useState(() => { try { return localStorage.getItem("brokie.bigChart") === "on"; } catch { return false; } });
  const bigH = typeof window === "undefined" ? 480 : Math.round(Math.max(380, Math.min(window.innerHeight * 0.62, 620)));
  const toggleBig = () => { const v = !big; setBig(v); try { localStorage.setItem("brokie.bigChart", v ? "on" : "off"); } catch { /* */ } };
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
      <div className="row between account-summary" style={{ alignItems: "flex-end" }}>
        <div>
          <Eyebrow>Season {me.season_number ?? ""} challenge · USD</Eyebrow>
          <div className="equity" data-testid="equity">{money(equity)}</div>
          <div className={equity >= base ? "lime" : "red"} style={{ fontSize: 12, fontWeight: 500 }}>
            {equity >= base ? "↗" : "↘"} {signedMoney(equity - base)} · {((equity - base) / base * 100).toFixed(2)}%
            {rules?.funded && <span className="chip-status" style={{ background: "rgba(242,202,115,.15)", color: "var(--gold)" }}>🏆 TARGET HIT</span>}
          </div>
          <button className="muted info-link" onClick={() => setPnlInfo(true)} data-testid="pnl-info" aria-label="How is this P&L calculated?">Season P&amp;L · equity vs starting balance ⓘ</button>
        </div>
        <div className="tagline" style={{ textAlign: "right", fontSize: 10, fontWeight: 500, paddingBottom: 6, lineHeight: 1.7 }}>
          <div>100% fake money.</div><div className="muted">100% real bragging rights.</div>
        </div>
      </div>

      {rules && <RuleStatus rules={rules} toast={toast} goHistory={goHistory} />}
      {rules && <Meters rules={rules} equity={equity} />}

      <div className="markets">
        {(Object.keys(MARKETS) as Market[]).map((m) => (
          <button key={m} className={`market ${market === m ? "on" : ""}`} style={{ ["--c" as string]: MARKETS[m].color }} onClick={() => game.setMarket(m)} data-testid={`market-${m}`}>
            <div className="row" style={{ gap: 6 }}><span className="dot" /><b>{MARKETS[m].title}</b></div>
            <span className="mono">{mark(m) ? px(mark(m)!) : "—"}</span>
          </button>
        ))}
      </div>

      <div className="chart-card">
        <div className="row between" style={{ alignItems: "flex-start" }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600 }}>{MARKETS[market].subtitle} <span className="mono muted" style={{ fontSize: 9 }}>{MARKETS[market].symbol}</span></div>
            <div className="row" style={{ gap: 8, alignItems: "baseline", marginTop: 6 }}>
              <span className="quote">{quote ? px(quote) : "—"}</span>
              <span className={`mono ${change >= 0 ? "lime" : "red"}`} style={{ fontSize: 11, fontWeight: 600 }}>{change >= 0 ? "+" : "−"}{px(Math.abs(change))}</span>
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
          overlay={(toXY, width) => crowd && st.bubbleScope === `${market}:${game.squad?.id ?? ""}` && <>
            <BubbleLayer key={`${market}:${game.squad?.id ?? ""}`} now={game.now()} hideMine bubbles={st.bubbles} market={market} quote={quote} toXY={toXY} width={width} onSelect={pick}
              onZoomOut={st.candleSeconds < 900 ? () => game.setCandleSeconds(st.candleSeconds === 60 ? 300 : 900) : undefined}
              onEnter={(b) => { const now = Date.now(); if (now - lastEnterToast.current < 5000) return; lastEnterToast.current = now; setActivity({ text: `@${b.handle} went ${b.side} ${b.quantity} micro${b.quantity === 1 ? "" : "s"}`, n: now }); }} />
            {activity ? <span key={activity.n} className="chart-toast" role="status">{activity.text}</span>
              : markerHint && crowdHere.length > 0 && <span className="chart-toast hint">Tap a face for their trade</span>}
          </>} />
        <div className="chips" style={{ marginTop: 10 }}>
          {(["candles", "line"] as const).map((s) => (
            <button key={s} className={`chip lime ${style === s ? "on" : ""}`} aria-label={s === "candles" ? "Candlestick chart" : "Line chart"} aria-pressed={style === s} onClick={() => { setStyle(s); localStorage.setItem("brokie.style", s); }}>{s === "candles" ? "▮▮" : "∿"}</button>
          ))}
          <span style={{ width: 1, height: 16, background: "var(--line)", margin: "0 3px" }} />
          {FRAMES.map((f) => <button key={f.s} className={`chip ${st.candleSeconds === f.s ? "on" : ""}`} aria-label={`${f.s / 60} minute candles`} aria-pressed={st.candleSeconds === f.s} onClick={() => game.setCandleSeconds(f.s)}>{f.l}</button>)}
          <button className={`chip lime ${big ? "on" : ""}`} style={{ marginLeft: "auto" }} aria-pressed={big} data-testid="big-chart"
            aria-label={big ? "Smaller chart" : "Bigger chart"} onClick={toggleBig}>{big ? "⤡" : "⤢"}</button>
          <button className={`chip lime ${crowd ? "on" : ""}`} aria-pressed={crowd} data-testid="crowd-toggle"
            aria-label={crowd ? "Hide squad trades on the chart" : "Show squad trades on the chart"}
            onClick={() => { const v = !crowd; setCrowd(v); try { localStorage.setItem("brokie.crowd", v ? "on" : "off"); } catch { /* */ } }}>
            <span className="crowd-chip">👥{crowd && longs > 0 && <span className="lime">{longs}▲</span>}{crowd && shorts > 0 && <span className="red">{shorts}▼</span>}</span>
          </button>
        </div>
        <div className="chart-attribution">
          {open ? "Real market prices from OANDA, fake money. Not financial advice." :"Market's closed. New trades open when prices are live again."}
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

      <Pit goSquad={goSquad} toast={toast} />

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
    <div className="stack" style={{ gap: 12 }}>
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
          : e.kind === "funded" ? <b style={{ color: "var(--gold)" }}>🏆 Hit +10%. Target badge earned.</b>
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
      <div><b>Daily loss limit hit.</b><div className="muted" style={{ fontSize: 12, marginTop: 3 }}>Positions closed. Unlocks at midnight Brisbane time.</div><button className="text-action lime" onClick={goHistory}>Review your trades →</button></div>
    </div>
  );
  return (
    <div className="status-card" style={{ background: "#1b1b1b", border: "1px solid #444", flexDirection: "column", alignItems: "stretch" }} data-testid="status-blown">
      <div className="row"><span style={{ fontSize: 30, filter: "grayscale(1)" }}>💀</span>
        <div><b style={{ fontSize: 17 }}>REKT.</b><div className="muted" style={{ fontSize: 12, marginTop: 3 }}>You hit the {rules.max_dd_pct}% max drawdown. Account blown for this season.</div></div></div>
      {rules.resets_used === 0 ? (
        <button className="big-btn lime" style={{ marginTop: 12 }} disabled={busy} data-testid="buy-back"
          onClick={async () => { setBusy(true); try { await game.buyBack(); toast("Back in. Tighter rules: 4% daily, 8% drawdown."); } catch (e) { toast((e as Error).message); } setBusy(false); }}>
          {busy ? <span className="spinner" /> : "Use your one buy-back (4% / 8% rules)"}
        </button>
      ) : <div className="muted" style={{ fontSize: 12, marginTop: 10 }}>Buy-back used. See you next season.</div>}
    </div>
  );
}

function Meters({ rules, equity }: { rules: Rules; equity: number }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const dailyRoom = Math.max(0, equity - rules.daily_floor), dailyMax = rules.day_start_equity - rules.daily_floor;
  const ddRoom = Math.max(0, equity - rules.drawdown_floor), ddMax = rules.peak_equity - rules.drawdown_floor;
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
      <div className="meter-caption">{cap}% {id === "meter-daily" ? "daily cap" : "trailing limit"}</div>
    </button>
  );
  const df = dailyMax > 0 ? dailyRoom / dailyMax : 0, dd = ddMax > 0 ? ddRoom / ddMax : 0;
  const explanations: Record<string, string> = {
    "meter-daily": `At ${money(rules.daily_floor, 0)} account equity, the server closes your positions and locks trading until midnight Brisbane time.`,
    "meter-dd": `Your current trailing floor is ${money(rules.drawdown_floor, 0)}. Reaching it closes your positions and marks this season's account REKT.`,
    "meter-target": `Reach ${money(rules.target, 0)} account equity to earn the Target badge. It is a game badge, with no real funding or cash payout. You need ${rules.qualify_days} trading days to qualify for the leaderboard.`,
  };
  return (
    <details className="rule-summary compact-rules">
      <summary><span>Daily loss room <b style={{ color: tone(df) }}>{money(dailyRoom, 0)}</b></span><span className="muted">Target {Math.round(progress * 100)}% ⌄</span></summary>
      <div className="target-progress"><span>Profit target {Math.round(progress * 100)}% · {rules.trading_days}/{rules.qualify_days} days</span><progress max={1} value={rules.funded ? 1 : progress} /></div>
      <div className="meters">
        {m("Daily loss limit", dailyRoom, df, rules.daily_loss_pct, "meter-daily")}
        {m("Max drawdown", ddRoom, dd, rules.max_dd_pct, "meter-dd")}
      </div>
      <button type="button" className="target-meter" data-testid="meter-target" aria-expanded={expanded === "meter-target"} aria-controls="rule-explainer"
        onClick={() => setExpanded(expanded === "meter-target" ? null : "meter-target")}>
        <span className="target-ring" style={{ ["--progress" as string]: `${(rules.funded ? 1 : progress) * 360}deg` }} aria-hidden="true"><span>{rules.funded ? "✓" : `${Math.round(progress * 100)}%`}</span></span>
        <span className="target-copy"><span className="meter-heading">Profit target <span aria-hidden="true">ⓘ</span></span>
          <strong>{money(gain, 0)} <span className="muted">/ {money(targetGain, 0)}</span></strong>
          <span className="meter-caption">{rules.funded ? "Target badge earned · " : ""}{rules.trading_days}/{rules.qualify_days} trading days · {rules.trading_days >= rules.qualify_days ? "Leaderboard qualified" : "To qualify for leaderboard"}</span>
        </span>
      </button>
      <div id="rule-explainer" hidden={!expanded} className="rule-explainer">{expanded ? explanations[expanded] : ""}</div>
    </details>
  );
}

const buzz = (ms: number | number[]) => { try { navigator.vibrate?.(ms); } catch { /* */ } };

/** Ticket 15: spam BUY / SELL. Every tap = +1 micro instantly (squash, pop, thump); taps batch into
 *  one order 300ms after the last. SELL while long (or BUY while short) opens the hedge leg. */
function SpamPad({ toast, disabled }: { toast: (m: string) => void; disabled: boolean }) {
  const st = useGame();
  const [pops, setPops] = useState<{ id: number; side: Side }[]>([]);
  const [squash, setSquash] = useState<Side | null>(null);
  const [shake, setShake] = useState<Side | null>(null);
  const streak = useRef(0);
  const seq = useRef(0);
  const pend = st.pending;
  const legs = (st.me?.positions ?? []).filter((p) => p.market === st.market);
  const [tapHint] = useState(() => hintOn("taps"));
  function tap(side: Side) {
    if (disabled) return;
    const n = pend && pend.side === side ? pend.count : 0;
    const cap = game.tapReduces(side) ? game.heldAgainst(side) : 10;
    if (n >= cap) { buzz([20, 30, 20]); setShake(side); setTimeout(() => setShake(null), 300); return; }
    streak.current = n + 1;
    const lvl = Math.min(2, Math.floor(n / 5));
    buzz([12, 22, 35][lvl]);
    const id = ++seq.current;
    setPops((p) => [...p.slice(-8), { id, side }]);
    setTimeout(() => setPops((p) => p.filter((x) => x.id !== id)), 420);
    setSquash(null); requestAnimationFrame(() => setSquash(side));
    const hedging = legs.some((p) => p.side !== side) && !legs.some((p) => p.side === side);
    game.tap(side, (err, q, pnl) => {
      if (err) { buzz([30, 40, 30]); setShake(side); setTimeout(() => setShake(null), 400); toast(err); }
      else if (pnl !== undefined) { buzz(pnl >= 0 ? [10, 40, 18] : [40, 30, 40]); toast(`✂️ Took ${q} off ${MARKETS[st.market].title} · ${signedMoney(pnl)}`); }
      else { buzz([10, 40, 18]); toast(`${hedging ? "🛡 Hedged" : side === "long" ? "🚀 Bought" : "📉 Sold"} ${q} micro${q === 1 ? "" : "s"} ${MARKETS[st.market].title}`); }
    });
  }
  const btn = (side: Side) => {
    const n = pend && pend.side === side ? pend.count : 0;
    const label = side === "long" ? "BUY" : "SELL";
    const hedge = legs.some((p) => p.side !== side) && !legs.some((p) => p.side === side);
    const partial = st.opposite === "partial" && hedge;
    const sign = side === "long" ? "+" : "−";   // BUY adds, SELL subtracts
    return (
      <button type="button" className={`spam-btn ${side} ${squash === side ? "squash" : ""} ${shake === side ? "nope" : ""}`}
        style={{ ["--glow" as string]: String(Math.min(1, n / 10)) }} disabled={disabled}
        onPointerDown={(e) => { e.preventDefault(); tap(side); }} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); tap(side); } }}
        onAnimationEnd={() => setSquash(null)} data-testid={side === "long" ? "go-long" : "go-short"} id={side === "long" ? "go-long" : "go-short"}>
        <span className="spam-label">{side === "long" ? "↗" : "↘"} {label}</span>
        <span className="spam-sub">{n ? `${sign}${n}` : partial ? `tap = close ${TAP_SIZE}` : hedge ? "tap = hedge" : tapHint ? `${sign}${TAP_SIZE} per tap` : "\u00a0"}</span>
        {pops.filter((p) => p.side === side).map((p) => <span key={p.id} className="spam-pop">{sign}{TAP_SIZE}</span>)}
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
        <span className={`mono pos-pnl ${win ? "lime" : "red"}`}>{signedMoney(pnl)}</span>
        {busy && <span className="spinner" style={{ width: 12, height: 12 }} />}
      </div>
      {fx === "win" && <div className="confetti" aria-hidden="true">{Array.from({ length: 14 }, (_, i) => <i key={i} style={{ ["--i" as string]: i }} />)}</div>}
    </div>
  );
}
