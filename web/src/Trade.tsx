import { useEffect, useState } from "react";
import { BubbleLayer } from "./Bubbles";
import type { Bubble, Rules } from "./types";
import { game, useGame } from "./game";
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
            <button key={s} className={`chip lime ${style === s ? "on" : ""}`} onClick={() => { setStyle(s); localStorage.setItem("brokie.style", s); }}>{s === "candles" ? "▮▮" : "∿"}</button>
          ))}
          <span style={{ width: 1, height: 16, background: "var(--line)", margin: "0 3px" }} />
          {FRAMES.map((f) => <button key={f.s} className={`chip ${st.candleSeconds === f.s ? "on" : ""}`} onClick={() => game.setCandleSeconds(f.s)}>{f.l}</button>)}
        </div>
        <div className="muted" style={{ fontSize: 9, marginTop: 10 }}>
          {open ? `Live prices · OANDA practice feed · tap the chart to read a bar` : "Market's closed. New trades open when prices are live again."}
        </div>
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
            <b style={{ fontSize: 13 }}>No bags. Yet.</b>
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
                <div className="muted" style={{ fontSize: 10, marginTop: 4 }}>{p.quantity} micro · at {px(p.entry_price)}</div>
              </div>
              <span className={`mono ${pnl >= 0 ? "lime" : "red"}`} style={{ fontSize: 13, fontWeight: 600 }}>{signedMoney(pnl)}</span>
              <button className="x-btn" aria-label="Close position" onClick={() => close(p.id, MARKETS[p.market].title)} disabled={!!closing} data-testid="close-position">
                {closing === p.id ? <span className="spinner" style={{ width: 12, height: 12 }} /> : "✕"}
              </button>
            </div>
          );
        })}
      </div>

      <Pit goSquad={goSquad} />

      <OrderSheet side={ticket} onClose={() => setTicket(null)} toast={toast} equity={equity} />
      <BubbleSheet b={picked} onClose={() => setPicked(null)} quote={quote} />
    </div>
  );
}

function Pit({ goSquad }: { goSquad: () => void }) {
  const st = useGame();
  const squad = game.squad;
  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="row between"><h2 className="h2">The pit</h2><span className="eyebrow">{squad?.name ?? "Your squad"}</span></div>
      {!squad ? (
        <button className="panel lime" style={{ padding: 16, fontSize: 12, textAlign: "left" }} onClick={goSquad}>Start or join a squad to see your mates' trades ↗</button>
      ) : st.feed.length === 0 ? (
        <div className="panel muted" style={{ padding: 16, fontSize: 12 }}>Quiet in here. Be the first to make a move.</div>
      ) : st.feed.slice(0, 5).map((e) => <FeedRow key={`${e.kind}-${e.id}`} e={e} />)}
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
  const [qty, setQty] = useState(1);
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
    if (e) setErr(e); else { toast(`${side === "long" ? "Long" : "Short"} ${m.title} opened. You're in.`); setQty(1); onClose(); }
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
            {[1, 2, 3, 5, 10].map((n) => <button key={n} data-testid={`quantity-${n}`} onClick={() => { setQty(n); setErr(null); }} style={qty === n ? { background: color, color: "var(--bg)" } : undefined}>{n}</button>)}
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
  const dailyRoom = Math.max(0, equity - rules.daily_floor), dailyMax = rules.day_start_equity - rules.daily_floor;
  const ddRoom = Math.max(0, equity - rules.drawdown_floor), ddMax = rules.peak_equity - rules.drawdown_floor;
  const progress = Math.max(0, Math.min(1, (equity - rules.start_balance) / (rules.target - rules.start_balance)));
  const tone = (f: number) => (f > 0.5 ? "var(--lime)" : f > 0.2 ? "var(--gold)" : "var(--red)");
  const m = (label: string, value: string, frac: number, color: string, id: string) => (
    <div className="meter" data-testid={id}>
      <div className="eyebrow" style={{ fontSize: 7 }}>{label}</div>
      <b style={{ color }}>{value}</b>
      <div className="bar"><i style={{ width: `${Math.max(2, frac * 100)}%`, background: color }} /></div>
    </div>
  );
  const df = dailyMax > 0 ? dailyRoom / dailyMax : 0, dd = ddMax > 0 ? ddRoom / ddMax : 0;
  return (
    <div>
      <div className="meters">
        {m(`Daily left · ${rules.daily_loss_pct}%`, money(dailyRoom, 0), df, tone(df), "meter-daily")}
        {m(`DD left · ${rules.max_dd_pct}%`, money(ddRoom, 0), dd, tone(dd), "meter-dd")}
        {m("To funded", rules.funded ? "🏆 Done" : `${Math.round(progress * 100)}%`, rules.funded ? 1 : progress, "var(--gold)", "meter-target")}
      </div>
      <div className="muted" style={{ fontSize: 10, marginTop: 8 }}>
        {rules.trading_days >= rules.qualify_days ? "✓ Qualified for the season leaderboard" : `${rules.trading_days} of ${rules.qualify_days} trading days to qualify for the leaderboard`}
      </div>
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
