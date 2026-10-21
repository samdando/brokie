import { useState } from "react";
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
          <Eyebrow>This week's stack · USD</Eyebrow>
          <div className="equity" data-testid="equity">{money(equity)}</div>
          <div className={equity >= 10000 ? "lime" : "red"} style={{ fontSize: 12, fontWeight: 500 }}>
            {equity >= 10000 ? "↗" : "↘"} {signedMoney(equity - 10000)} this week
          </div>
        </div>
        <div style={{ textAlign: "right", fontSize: 10, fontWeight: 500, paddingBottom: 6, lineHeight: 1.7 }}>
          <div>100% fake money.</div><div className="muted">100% real bragging rights.</div>
        </div>
      </div>

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
        <BrokieChart market={market} candles={candles} bucketSeconds={st.candleSeconds} quote={quote} positions={me.positions} style={style} />
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
        <Button onClick={() => setTicket("long")} id="go-long">↗ Go long</Button>
        <Button variant="short" onClick={() => setTicket("short")} id="go-short">↘ Go short</Button>
      </div>

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
          <span style={{ marginLeft: "auto", fontSize: 10, fontWeight: 600 }} className={e.side === "long" ? "lime" : "red"}>{MARKETS[e.market].title} {e.side === "long" ? "↑" : "↓"}</span>
        </div>
        <div style={{ fontSize: 13, marginTop: 5, color: "rgba(255,255,255,.85)" }}>
          {e.kind === "closed" && e.pnl !== null ? (
            <>{e.reason === "liquidated" ? `Got liquidated on ${size} ` : `Closed ${e.side} ${size} `}
              <b className={`mono ${e.pnl >= 0 ? "lime" : "red"}`}>{signedMoney(e.pnl)}</b>{e.reason !== "liquidated" && (e.pnl >= 0 ? " 🔥" : " 💀")}</>
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
            {[1, 2, 3].map((n) => <button key={n} data-testid={`quantity-${n}`} onClick={() => { setQty(n); setErr(null); }} style={qty === n ? { background: color, color: "var(--bg)" } : undefined}>{n}</button>)}
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
