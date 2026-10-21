import { useEffect, useRef, useState } from "react";
import { BubbleLayer } from "./Bubbles";
import type { Bubble, Rules } from "./types";
import { TAP_SIZE, game, useGame } from "./game";
import { EmojiBar, } from "./Social";
import { shareInvite } from "./Squad";
import { BrokieChart, vibeOf } from "./Chart";
import { Button, Eyebrow, Sheet, ago, money, px, signedMoney } from "./ui";
import { MARKETS, Market, Position, Side, pnlOf } from "./types";

const FRAMES = [{ s: 60, l: "1m" }, { s: 300, l: "5m" }, { s: 900, l: "15m" }];

export function TradeScreen({ toast, goSquad }: { toast: (m: string) => void; goSquad: () => void }) {
  const st = useGame();
  const me = st.me!;
  const [style, setStyle] = useState<"candles" | "line">(() => (localStorage.getItem("brokie.style") as "line") || "candles");
  const [closing, setClosing] = useState<string | null>(null);
  const [pnlInfo, setPnlInfo] = useState(false);
  const mark = (m: Market) => game.quote(m)?.price ?? null;
  const unrealized = me.positions.reduce((s, p) => s + (mark(p.market) ? pnlOf(p, mark(p.market)!) : 0), 0);
  const equity = Math.max(0, me.cash + unrealized);
  const rules = me.rules;
  const base = rules?.start_balance ?? 10000;
  const [picked, setPicked] = useState<Bubble | null>(null);
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
  const vibe = vibeOf(candles);
  const hi = candles.length ? Math.max(...candles.map((c) => c.high)) : null;
  const lo = candles.length ? Math.min(...candles.map((c) => c.low)) : null;

  async function close(id: string, title: string): Promise<boolean> {
    setClosing(id);
    const r = await game.close(id);
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
    <div className="stack">
      <div className="row between" style={{ alignItems: "flex-end" }}>
        <div>
          <Eyebrow>Season {me.season_number ?? ""} challenge · USD</Eyebrow>
          <div className="equity" data-testid="equity">{money(equity)}</div>
          <div className={equity >= base ? "lime" : "red"} style={{ fontSize: 12, fontWeight: 500 }}>
            {equity >= base ? "↗" : "↘"} {signedMoney(equity - base)} · {((equity - base) / base * 100).toFixed(2)}%
            {rules?.funded && <span className="chip-status" style={{ background: "rgba(242,202,115,.15)", color: "var(--gold)" }}>🏆 FUNDED</span>}
          </div>
          <button className="muted info-link" onClick={() => setPnlInfo(true)} data-testid="pnl-info" aria-label="How is this P&L calculated?">Season P&amp;L · equity vs starting balance ⓘ</button>
        </div>
        <div className="tagline" style={{ textAlign: "right", fontSize: 10, fontWeight: 500, paddingBottom: 6, lineHeight: 1.7 }}>
          <div>100% fake money.</div><div className="muted">100% real bragging rights.</div>
        </div>
      </div>

      {rules && <RuleStatus rules={rules} toast={toast} />}
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
          <span className="badge" data-testid="live-badge" style={{ color: open ? "#fff" : "var(--muted)" }}>
            <span className="dot" style={{ width: 5, height: 5, ["--c" as string]: open ? "var(--red)" : "var(--muted)" }} />{open ? "LIVE" : "MARKET CLOSED"}
          </span>
        </div>
        <div className="row between" style={{ margin: "12px 0 6px" }}>
          <span className="vibe" style={{ color: vibe.color, background: vibe.color + "1F" }}>{vibe.label}</span>
          <span className="muted" style={{ fontSize: 9, marginRight: "auto", marginLeft: 8 }}>vs 20-bar avg</span>
          {hi !== null && <span className="mono muted" style={{ fontSize: 9 }}>H {px(hi)} L {px(lo!)}</span>}
        </div>
        <BrokieChart market={market} candles={candles} bucketSeconds={st.candleSeconds} quote={quote} positions={me.positions} style={style}
          brackets={st.brackets} onBracket={(id, b) => game.setBracket(id, b)} onClearBracket={(id, k) => game.clearBracket(id, k)}
          sizePctOf={(p) => st.bubbles.find((b) => b.is_you && b.state === "open" && b.side === p.side && b.entry_price === p.entry_price && b.quantity === p.quantity)?.size_pct ?? null}
          overlay={(toXY, width) => (
            <BubbleLayer hideMine bubbles={st.bubbles} market={market} quote={quote} toXY={toXY} width={width} onSelect={setPicked}
              onEnter={(b) => toast(`@${b.handle} aped ${b.side === "long" ? "LONG" : "SHORT"} ${b.quantity} micro${b.quantity === 1 ? "" : "s"} 🚀`)} />
          )} />
        <div className="chips" style={{ marginTop: 10 }}>
          {(["candles", "line"] as const).map((s) => (
            <button key={s} className={`chip lime ${style === s ? "on" : ""}`} aria-label={s === "candles" ? "Candlestick chart" : "Line chart"} aria-pressed={style === s} onClick={() => { setStyle(s); localStorage.setItem("brokie.style", s); }}>{s === "candles" ? "▮▮" : "∿"}</button>
          ))}
          <span style={{ width: 1, height: 16, background: "var(--line)", margin: "0 3px" }} />
          {FRAMES.map((f) => <button key={f.s} className={`chip ${st.candleSeconds === f.s ? "on" : ""}`} aria-label={`${f.s / 60} minute candles`} aria-pressed={st.candleSeconds === f.s} onClick={() => game.setCandleSeconds(f.s)}>{f.l}</button>)}
        </div>
        <div className="muted" style={{ fontSize: 9, marginTop: 10 }}>
          {open ? `Live prices · OANDA practice feed · pinch to zoom · drag to pan · hold for crosshair · double-tap for live` : "Market's closed. New trades open when prices are live again."}
        </div>
        <div className="chart-attribution">
          Charts by <a href="https://www.tradingview.com/" target="_blank" rel="noopener noreferrer">TradingView</a>
          <span aria-hidden="true"> · </span><a href="./tradingview-NOTICE.txt" target="_blank" rel="noopener noreferrer">Attribution</a>
        </div>
      </div>

      <SpamPad toast={toast} disabled={rules?.status === "blown" || rules?.status === "locked" || !open} />
      <div className="disclaimer">SIMULATED TRADING · NOT FINANCIAL ADVICE · NO REAL MONEY</div>

      <div className="stack" style={{ gap: 12 }}>
        <div className="row between"><h2 className="h2">Your positions</h2><span className="eyebrow">{me.positions.length} open</span></div>
        {me.positions.length === 0 && (
          <div className="panel" style={{ padding: 18, borderRadius: 15 }}>
            <b style={{ fontSize: 13 }}>No trades. Peak risk management.</b>
            <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>Pick a market and make your first paper trade.</div>
          </div>
        )}
        {me.positions.map((p) => {
          const m = mark(p.market); const pnl = m ? pnlOf(p, m) : 0;
          return <SwipeCard key={p.id} p={p} pnl={pnl} busy={closing === p.id} disabled={!!closing}
            hedged={me.positions.some((q) => q.market === p.market && q.side !== p.side)}
            onClose={() => close(p.id, MARKETS[p.market].title)} />;
        })}
        {me.positions.length > 0 && <div className="muted" style={{ fontSize: 10, textAlign: "center" }}>Swipe a card away to close · drag ⇕ on the chart for SL/TP</div>}
      </div>

      <Pit goSquad={goSquad} toast={toast} />

      <BubbleSheet b={picked} onClose={() => setPicked(null)} quote={quote} />
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

function Pit({ goSquad, toast }: { goSquad: () => void; toast: (m: string) => void }) {
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
      ) : st.feed.slice(0, 5).map((e) => <FeedRow key={`${e.kind}-${e.id}`} e={e} />)}
      {squad && squad.member_count > 1 && (
        <>
          <div className="react-hint">React to your squad · tap to send to {squad.name}</div>
          <EmojiBar compact onSent={(e) => toast(e ?? `Sent to ${squad.name}`)} />
        </>
      )}
    </div>
  );
}

export function FeedRow({ e }: { e: import("./types").FeedEvent }) {
  const size = `${e.quantity} ${MARKETS[e.market].title}`;
  return (
    <div className="panel" style={{ padding: 14, borderRadius: 16, display: "flex", gap: 11 }}>
      <span className={`av ${e.is_you ? "you" : ""}`} style={{ width: 33, height: 33 }}>{e.handle[0].toUpperCase()}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="row" style={{ gap: 6 }}>
          <b style={{ fontSize: 12 }}>{e.is_you ? "You" : `@${e.handle}`}</b>
          <span className="muted" style={{ fontSize: 9 }}>{ago(e.at)}</span>
          {(e.kind === "opened" || e.kind === "closed") && <span style={{ marginLeft: "auto", fontSize: 10, fontWeight: 600 }} className={e.side === "long" ? "lime" : "red"}>{MARKETS[e.market].title} {e.side === "long" ? "↑" : "↓"}</span>}
        </div>
        <div style={{ fontSize: 13, marginTop: 5, color: "rgba(255,255,255,.85)" }}>
          {e.kind === "rekt" ? <b style={{ color: "#bbb" }}>💀 Blew the account. REKT.</b>
          : e.kind === "funded" ? <b style={{ color: "var(--gold)" }}>🏆 Hit +10%. FUNDED.</b>
          : e.kind === "closed" && e.pnl !== null ? (
            <>{e.reason === "blown" ? `Blown out of ${size} ` : e.reason === "daily_limit" ? `Daily limit closed ${size} ` : `Closed ${e.side} ${size} `}
              <b className={`mono ${e.pnl >= 0 ? "lime" : "red"}`}>{signedMoney(e.pnl)}</b>{e.reason === "closed" && (e.pnl >= 0 ? " 🔥" : " 💀")}</>
          ) : <>Went {e.side} {size} at {px(e.price)}</>}
        </div>
      </div>
    </div>
  );
}

function RuleStatus({ rules, toast }: { rules: Rules; toast: (m: string) => void }) {
  const [busy, setBusy] = useState(false);
  if (rules.status === "active") return null;
  if (rules.status === "locked") return (
    <div className="status-card" style={{ background: "rgba(255,125,139,.08)", border: "1px solid rgba(255,125,139,.35)" }} data-testid="status-locked">
      <span style={{ fontSize: 26 }}>🔒</span>
      <div><b>Daily loss limit hit.</b><div className="muted" style={{ fontSize: 12, marginTop: 3 }}>Positions closed. Trading unlocks at midnight Brisbane time.</div></div>
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
    "meter-target": `Reach ${money(rules.target, 0)} account equity to earn the Funded badge. It is a game badge, with no real funding or cash payout. You need ${rules.qualify_days} trading days to qualify for the leaderboard.`,
  };
  return (
    <div className="rule-summary">
      <div className="meters">
        {m("Daily loss limit", dailyRoom, df, rules.daily_loss_pct, "meter-daily")}
        {m("Max drawdown", ddRoom, dd, rules.max_dd_pct, "meter-dd")}
      </div>
      <button type="button" className="target-meter" data-testid="meter-target" aria-expanded={expanded === "meter-target"} aria-controls="rule-explainer"
        onClick={() => setExpanded(expanded === "meter-target" ? null : "meter-target")}>
        <span className="target-ring" style={{ ["--progress" as string]: `${(rules.funded ? 1 : progress) * 360}deg` }} aria-hidden="true"><span>{rules.funded ? "✓" : `${Math.round(progress * 100)}%`}</span></span>
        <span className="target-copy"><span className="meter-heading">Profit target <span aria-hidden="true">ⓘ</span></span>
          <strong>{money(gain, 0)} <span className="muted">/ {money(targetGain, 0)}</span></strong>
          <span className="meter-caption">{rules.funded ? "Funded badge earned · " : ""}{rules.trading_days}/{rules.qualify_days} trading days · {rules.trading_days >= rules.qualify_days ? "Leaderboard qualified" : "To qualify for leaderboard"}</span>
        </span>
      </button>
      <div id="rule-explainer" hidden={!expanded} className="rule-explainer">{expanded ? explanations[expanded] : ""}</div>
    </div>
  );
}

function BubbleSheet({ b, onClose, quote }: { b: Bubble | null; onClose: () => void; quote: number | null }) {
  const st = useGame();
  if (!b) return null;
  const m = MARKETS[st.market];
  const pnl = quote ? (quote - b.entry_price) * m.pointValue * b.quantity * (b.side === "long" ? 1 : -1) : 0;
  const ddLeft = b.equity && b.dd_floor ? b.equity + pnl * 0 - b.dd_floor : null;
  return (
    <Sheet open onClose={onClose}>
      <div className="stack" style={{ gap: 16 }}>
        <div className="row" style={{ gap: 12 }}>
          <span className={`av ${b.is_you ? "you" : ""}`} style={{ width: 46, height: 46, fontSize: 16, boxShadow: `0 0 0 2px ${b.side === "long" ? "var(--lime)" : "var(--red)"}` }}>{b.handle[0].toUpperCase()}</span>
          <div><b style={{ fontSize: 18 }}>{b.is_you ? "You" : `@${b.handle}`}</b><div className="muted" style={{ fontSize: 12 }}>{b.side === "long" ? "Long ▲" : "Short ▼"} {m.title} × {b.quantity}</div></div>
        </div>
        <div className="detail"><span>Entry</span><span>{px(b.entry_price)}</span></div>
        <div className="detail"><span>Open P&amp;L</span><span className={pnl >= 0 ? "lime" : "red"}>{signedMoney(pnl)}</span></div>
        <div className="detail"><span>Size</span><span>{(b.size_pct ?? 0).toFixed(1)}% of account</span></div>
        {ddLeft !== null && <div className="detail"><span>Drawdown room left</span><span>{money(ddLeft, 0)}</span></div>}
        <div className="detail"><span>Opened</span><span>{ago(b.opened_at)}</span></div>
        <Button variant="ghost" onClick={onClose}>Close</Button>
      </div>
    </Sheet>
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
  function tap(side: Side) {
    if (disabled) return;
    const n = pend && pend.side === side ? pend.count : 0;
    if (n >= 10) { buzz([20, 30, 20]); setShake(side); setTimeout(() => setShake(null), 300); return; }
    streak.current = n + 1;
    const lvl = Math.min(2, Math.floor(n / 5));
    buzz([12, 22, 35][lvl]);
    const id = ++seq.current;
    setPops((p) => [...p.slice(-8), { id, side }]);
    setTimeout(() => setPops((p) => p.filter((x) => x.id !== id)), 420);
    setSquash(null); requestAnimationFrame(() => setSquash(side));
    const hedging = legs.some((p) => p.side !== side) && !legs.some((p) => p.side === side);
    game.tap(side, (err, q) => {
      if (err) { buzz([30, 40, 30]); setShake(side); setTimeout(() => setShake(null), 400); toast(err); }
      else { buzz([10, 40, 18]); toast(`${hedging ? "🛡 Hedged" : side === "long" ? "🚀 Bought" : "📉 Sold"} ${q} micro${q === 1 ? "" : "s"} ${MARKETS[st.market].title}`); }
    });
  }
  const btn = (side: Side) => {
    const n = pend && pend.side === side ? pend.count : 0;
    const label = side === "long" ? "BUY" : "SELL";
    const hedge = legs.some((p) => p.side !== side) && !legs.some((p) => p.side === side);
    return (
      <button type="button" className={`spam-btn ${side} ${squash === side ? "squash" : ""} ${shake === side ? "nope" : ""}`}
        style={{ ["--glow" as string]: String(Math.min(1, n / 10)) }} disabled={disabled}
        onPointerDown={(e) => { e.preventDefault(); tap(side); }} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); tap(side); } }}
        onAnimationEnd={() => setSquash(null)} data-testid={side === "long" ? "go-long" : "go-short"} id={side === "long" ? "go-long" : "go-short"}>
        <span className="spam-label">{side === "long" ? "↗" : "↘"} {label}</span>
        <span className="spam-sub">{n ? `x${n}` : hedge ? "tap = hedge" : `+${TAP_SIZE} per tap`}</span>
        {pops.filter((p) => p.side === side).map((p) => <span key={p.id} className="spam-pop">+{TAP_SIZE}</span>)}
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
