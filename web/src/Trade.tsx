import { useEffect, useState } from "react";
import { BubbleLayer } from "./Bubbles";
import type { Bubble, Rules } from "./types";
import { QTY_CHOICES, game, useGame } from "./game";
import { EmojiBar, } from "./Social";
import { shareInvite } from "./Squad";
import { BrokieChart, vibeOf } from "./Chart";
import { Button, Eyebrow, Sheet, ago, money, px, signedMoney } from "./ui";
import { MARKETS, Market, Side, pnlOf } from "./types";

const FRAMES = [{ s: 60, l: "1m" }, { s: 300, l: "5m" }, { s: 900, l: "15m" }];

export function TradeScreen({ toast, goSquad }: { toast: (m: string) => void; goSquad: () => void }) {
  const st = useGame();
  const me = st.me!;
  const [style, setStyle] = useState<"candles" | "line">(() => (localStorage.getItem("brokie.style") as "line") || "candles");
  const [ticket, setTicket] = useState<Side | null>(null);
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

  async function close(id: string, title: string) {
    setClosing(id);
    const r = await game.close(id);
    setClosing(null);
    toast(r.error ?? `Closed ${title} · ${signedMoney(r.pnl ?? 0)}`);
  }

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
          overlay={(toXY, width) => (
            <BubbleLayer bubbles={st.bubbles} market={market} quote={quote} toXY={toXY} width={width} onSelect={setPicked}
              onEnter={(b) => toast(`@${b.handle} ${b.side === "long" ? "longed" : "shorted"} ${MARKETS[market].title} ×${b.quantity}`)} />
          )} />
        <div className="chips" style={{ marginTop: 10 }}>
          {(["candles", "line"] as const).map((s) => (
            <button key={s} className={`chip lime ${style === s ? "on" : ""}`} aria-label={s === "candles" ? "Candlestick chart" : "Line chart"} aria-pressed={style === s} onClick={() => { setStyle(s); localStorage.setItem("brokie.style", s); }}>{s === "candles" ? "▮▮" : "∿"}</button>
          ))}
          <span style={{ width: 1, height: 16, background: "var(--line)", margin: "0 3px" }} />
          {FRAMES.map((f) => <button key={f.s} className={`chip ${st.candleSeconds === f.s ? "on" : ""}`} aria-label={`${f.s / 60} minute candles`} aria-pressed={st.candleSeconds === f.s} onClick={() => game.setCandleSeconds(f.s)}>{f.l}</button>)}
        </div>
        <div className="muted" style={{ fontSize: 9, marginTop: 10 }}>
          {open ? `Live prices · OANDA practice feed · tap the chart to read a bar` : "Market's closed. New trades open when prices are live again."}
        </div>
        <div className="chart-attribution">
          Charts by <a href="https://www.tradingview.com/" target="_blank" rel="noopener noreferrer">TradingView</a>
          <span aria-hidden="true"> · </span><a href="./tradingview-NOTICE.txt" target="_blank" rel="noopener noreferrer">Attribution</a>
        </div>
      </div>

      <div className="size-row" role="radiogroup" aria-label="Order size in micro contracts" data-testid="size-chips">
        <span className="eyebrow" style={{ fontSize: 8 }}>Size</span>
        {QTY_CHOICES.map((n) => (
          <button key={n} role="radio" aria-checked={st.qty === n} className={`chip lime ${st.qty === n ? "on" : ""}`} onClick={() => game.setQty(n)} data-testid={`size-${n}`}>{n} micro{n === 1 ? "" : "s"}</button>
        ))}
        <span className="mono muted" style={{ fontSize: 10, marginLeft: "auto" }}>{money(MARKETS[market].pointValue * st.qty, 0)}/pt</span>
      </div>
      <div className="row" style={{ gap: 12 }}>
        <Button onClick={() => setTicket("long")} id="go-long" disabled={rules?.status === "blown" || rules?.status === "locked"}>↗ Go long</Button>
        <Button variant="short" onClick={() => setTicket("short")} id="go-short" disabled={rules?.status === "blown" || rules?.status === "locked"}>↘ Go short</Button>
      </div>
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
          return (
            <div className="card-row" key={p.id} data-testid="position">
              <span className="badge-sq" style={{ background: MARKETS[p.market].color + "1A", color: MARKETS[p.market].color }}>{MARKETS[p.market].title[0]}</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 700 }}>{MARKETS[p.market].title} · {p.side === "long" ? "Long" : "Short"}</div>
                <div className="muted" style={{ fontSize: 10, marginTop: 4 }}>{p.quantity} micro · at {px(p.entry_price)} · open P&amp;L</div>
              </div>
              <span className={`mono ${pnl >= 0 ? "lime" : "red"}`} style={{ fontSize: 13, fontWeight: 600 }}>{signedMoney(pnl)}</span>
              <button className="x-btn" aria-label="Close position" onClick={() => close(p.id, MARKETS[p.market].title)} disabled={!!closing} data-testid="close-position">
                {closing === p.id ? <span className="spinner" style={{ width: 12, height: 12 }} /> : "✕"}
              </button>
            </div>
          );
        })}
      </div>

      <Pit goSquad={goSquad} toast={toast} />

      <OrderSheet side={ticket} onClose={() => setTicket(null)} toast={toast} equity={equity} />
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

function OrderSheet({ side, onClose, toast, equity }: { side: Side | null; onClose: () => void; toast: (m: string) => void; equity: number }) {
  const st = useGame();
  const qty = st.qty;
  const setQty = (n: number) => game.setQty(n);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!side) return null;
  const m = MARKETS[st.market];
  const open = game.isOpen(st.market);
  const used = (st.me?.positions ?? []).reduce((s, p) => s + p.quantity * 1000, 0);
  const color = side === "long" ? "var(--lime)" : "var(--red)";
  async function submit() {
    setBusy(true); setErr(null);
    const e = await game.open(side!, qty);
    setBusy(false);
    if (e) setErr(e); else { toast(`${side === "long" ? "Long" : "Short"} ${m.title} opened. You're in.`); onClose(); }
  }
  return (
    <Sheet open onClose={onClose}>
      <div className="stack" style={{ gap: 20 }}>
        <div className="row between"><Eyebrow>Paper order</Eyebrow><button className="muted" onClick={onClose} aria-label="Cancel">✕</button></div>
        <div className="row" style={{ gap: 13 }}>
          <span className="badge-sq" style={{ width: 45, height: 45, borderRadius: 14, background: m.color + "1A", color: m.color, fontSize: 16 }}>{m.title[0]}</span>
          <div><div style={{ font: "700 27px var(--round)" }}>{side === "long" ? "Long" : "Short"} {m.title}</div><div className="muted" style={{ fontSize: 12 }}>{m.subtitle} · {m.symbol}</div></div>
        </div>
        <div className="muted" style={{ fontSize: 13 }}>{side === "long" ? "Think it goes up? You're in the right place." : "Think it goes down? Put your paper on it."}</div>
        <div><Eyebrow>Micro contracts</Eyebrow>
          <div className="qty" style={{ marginTop: 11 }}>
            {[1, 2, 3, 5, 10].map((n) => <button key={n} aria-pressed={qty === n} data-testid={`quantity-${n}`} onClick={() => { setQty(n); setErr(null); }} style={qty === n ? { background: color, color: "var(--bg)" } : undefined}>{n}</button>)}
          </div>
        </div>
        <div className="stack" style={{ gap: 13 }}>
          <div className="detail"><span>{open ? "Live market price" : "Last price · market closed"}</span><span>{px(game.quote(st.market)?.price ?? 0)}</span></div>
          <div className="detail"><span>P&amp;L per 1 point move</span><span>{money(m.pointValue * qty)}</span></div>
          <div className="detail"><span>Practice margin</span><span>{money(qty * 1000, 0)}</span></div>
          <div className="detail"><span>Available</span><span>{money(Math.max(0, equity - used))}</span></div>
        </div>
        {err && <div className="err" data-testid="order-error">{err}</div>}
        <button className="big-btn" style={{ background: color, color: "var(--bg)", opacity: open ? 1 : 0.4 }} disabled={busy || !open} onClick={submit} data-testid="confirm-order">
          {busy ? <span className="spinner" /> : `Open ${side} · ${qty} ${qty === 1 ? "micro" : "micros"}`}
        </button>
        <div className="muted" style={{ fontSize: 10, textAlign: "center" }}>Virtual funds only. Filled by the Brokie server at the live price.</div>
      </div>
    </Sheet>
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
