import { haptic, orderEffect, saveEffect } from "./effects";
import { Avatar } from "./Avatar";
import { AvatarShop } from "./AvatarShop";
import { DailyRecap, TradeReview } from "./TradeReview";
import { useEffect, useState } from "react";
import { FRAME_OPTIONS, game, useGame } from "./game";
import { Button, Eyebrow, Sheet, countdown, money, px, signedMoney } from "./ui";
import { drawTradeImage, receiptURL } from "./TradeImage";
import { MARKETS, SharedReceipt, Trade, pnlOf } from "./types";
import { RankCard } from "./rank";
import { UsdcPlay } from "./UsdcPlay";

export function YouScreen({ toast, onFeedback }: { toast: (m: string) => void; onFeedback: () => void }) {
  const st = useGame();
  const me = st.me!;
  const [period, setPeriod] = useState<"season" | "lifetime">("season");
  const [settings, setSettings] = useState(false);
  const [look, setLook] = useState(false);
  const [allReceipts, setAllReceipts] = useState(false);
  const [edit, setEdit] = useState(false);
  const [card, setCard] = useState<Trade | null>(null);
  const unrealized = me.positions.reduce((s, p) => { const q = game.quote(p.market)?.price; return s + (p.market === "prediction" ? pnlOf(p, 0) : q ? pnlOf(p, q) : 0); }, 0);
  const wins = me.trades.filter((t) => t.pnl > 0).length;
  const base = me.rules?.start_balance ?? 100000;
  useEffect(() => { void game.refreshLifetime(); }, []);
  return (
    <div className="stack you-screen secondary-screen" style={{ gap: 24 }}>
      <div className="row you-identity" style={{ gap: 16 }}> 
        <button className="profile-look" onClick={() => setLook(true)} aria-label="Change your look"><Avatar handle={me.handle} style={{ width: 52, height: 52, fontSize: 27 }} /></button>
        <div>
          <button onClick={() => setEdit(true)} style={{ font: "700 23px var(--round)" }} data-testid="edit-handle">@{me.handle} <span className="muted" style={{ fontSize: 14 }}>✎</span></button>
          <div className="profile-caption">Your corner of the market.</div>
        </div>
        <button className="profile-settings" aria-label="Account settings" onClick={() => setSettings(true)}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="m9 3-.7 2.5-2.4 1L3.7 6 2 9l1.9 1.8v2.4L2 15l1.7 3 2.2-.5 2.4 1L9 21h6l.7-2.5 2.4-1 2.2.5 1.7-3-1.9-1.8v-2.4L22 9l-1.7-3-2.2.5-2.4-1L15 3Z"/><circle cx="12" cy="12" r="3"/></svg></button>
      </div>

      <div className="seg" role="tablist" aria-label="Performance period"><button role="tab" aria-selected={period === "season"} className={period === "season" ? "on" : ""} onClick={() => setPeriod("season")}>This season</button><button role="tab" aria-selected={period === "lifetime"} className={period === "lifetime" ? "on" : ""} onClick={() => setPeriod("lifetime")}>Lifetime</button></div>
      {period === "season" ? <>
      <section className="season-score"><div className="row between"><Eyebrow>Season {me.season_number ?? ""} · total return</Eyebrow><span className="profile-season-end">{countdown(me.season_ends_at, game.now())} left</span></div><strong className={me.cash + unrealized >= base ? "lime" : "red"}>{((me.cash + unrealized - base) / base * 100) >= 0 ? "+" : ""}{((me.cash + unrealized - base) / base * 100).toFixed(2)}%</strong><div className={`season-score-money ${me.cash + unrealized >= base ? "lime" : "red"}`}>{signedMoney(me.cash + unrealized - base)}</div><span className="muted">{money(me.cash + unrealized)} paper equity</span></section>
      <RankCard r={{ return_pct: (me.cash + unrealized - base) / base * 100, status: me.rules?.status, funded: me.rules?.funded, trading_days: me.rules?.trading_days, qualified: me.rules ? me.rules.trading_days >= (me.rules.qualify_days || 5) : undefined }} />
      <div className="profile-stats">
        {[["Trades · last 50", String(me.trades.length)], ["Win rate · last 50", me.trades.length ? `${Math.round((wins / me.trades.length) * 100)}%` : "—"], ["Realized P&L", signedMoney(me.cash - base)]].map(([k, v]) => (
          <div key={k} className={`panel ${k === "Realized P&L" ? me.cash >= base ? "lime" : "red" : ""}`} style={{ flex: 1, padding: 13, borderRadius: 14 }}><div className="eyebrow" style={{ fontSize: 7 }}>{k}</div><div style={{ font: "600 19px var(--round)", marginTop: 12, whiteSpace: "nowrap" }}>{v}</div></div>
        ))}
      </div>
      <details className="quiet-disclosure balance-disclosure"><summary><span>Account breakdown</span><small>Cash &amp; open P&amp;L <span aria-hidden="true">⌄</span></small></summary><div className="stack season-balance" style={{ gap: 14 }}>
        <div className="detail"><span>Paper cash</span><span>{money(me.cash)}</span></div>
        <div className="detail"><span>Open P&amp;L (unrealized)</span><span className={unrealized >= 0 ? "lime" : "red"}>{signedMoney(unrealized)}</span></div>
        <div className="muted" style={{ fontSize: 10 }}>Season totals include all closed trades and open positions. Trade count and win rate cover your latest 50 closed trades.</div>
        {me.protection_credit > 0 && <div className="detail"><span>Liquidation credit</span><span>{money(me.protection_credit)}</span></div>}
      </div></details>

      </> : <LifetimeCard />}
      <Sheet open={settings} onClose={() => setSettings(false)}><div className="stack"><div className="row between"><h3 className="h3">Account settings</h3><button className="text-action" onClick={() => setSettings(false)}>Done</button></div><button className="text-action" onClick={() => { setSettings(false); setEdit(true); }}>Edit handle</button><OppositeSetting /><OrderEffectsSetting /><FramesSetting /><BackupRow /><a className="muted" style={{ fontSize: 11 }} href="./tradingview-NOTICE.txt" target="_blank" rel="noopener noreferrer">TradingView Lightweight Charts · legal notice ↗</a></div></Sheet>

      <button className="profile-customize" onClick={() => setLook(true)}><Avatar handle={me.handle} /><span><b>Make it yours</b><small>Your face on the trading floor.</small></span><span aria-hidden="true">↗</span></button>
      <Sheet open={look} onClose={() => setLook(false)}><div className="stack"><div className="row between"><Eyebrow>Your look</Eyebrow><button className="text-action" onClick={() => setLook(false)}>Done</button></div><AvatarShop toast={toast} /></div></Sheet>
      <DailyRecap />
      <UsdcPlay />
      <div id="receipts" className="stack" style={{ gap: 14 }}>
        <div className="row between"><h2 className="h2">Your trades</h2><span className="section-caption">Latest 50 · tap to review</span></div>
        {me.trades.length === 0 && <div className="quiet-empty"><span aria-hidden="true">↗</span><b>A fresh start.</b><p>Your closed trades will land here.<br />Every entry has something to teach you.</p></div>}
        {(allReceipts ? me.trades : me.trades.slice(0,6)).map((t) => (
          <button key={t.id} className="panel row receipt-ticket" style={{ padding: 15, borderRadius: 13, textAlign: "left" }} onClick={() => setCard(t)} data-testid="receipt">
            <div style={{ flex: 1 }}><div style={{ fontSize: 13, fontWeight: 600 }}>{t.prediction_question ?? MARKETS[t.market].title} · {t.prediction_outcome?.toUpperCase() ?? (t.side === "long" ? "Long" : "Short")} · {t.quantity} {t.market === "prediction" ? "shares" : t.quantity === 1 ? "micro" : "micros"}</div>
              <div className="mono muted" style={{ fontSize: 10, marginTop: 5 }}>{px(t.entry_price)} → {px(t.exit_price)}</div><div className="receipt-meta muted">{new Date(t.closed_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}{t.reason !== "closed" && <span>Closed: {t.reason.replace(/_/g, " ")}</span>}</div></div>
            <span className={`mono ${t.pnl >= 0 ? "lime" : "red"}`} style={{ fontSize: 13, fontWeight: 700 }}>{signedMoney(t.pnl)}</span>
            <span className="muted" style={{ fontSize: 12 }}>↗</span>
          </button>
        ))}
        {me.trades.length > 6 && <button className="quiet-action receipts-more" onClick={() => setAllReceipts(!allReceipts)}>{allReceipts ? "Show fewer trades" : `View all ${me.trades.length} trades`}</button>}
      </div>
      <button className="text-action settings-entry" onClick={onFeedback} data-testid="feedback-btn">Help shape Brokie <span>Send feedback ↗</span></button>
      <InstallTip />
      <HandleSheet open={edit} onClose={() => setEdit(false)} toast={toast} />
      <TradeCardSheet key={card?.id ?? "closed"} trade={card} handle={me.handle} onClose={() => setCard(null)} />
    </div>
  );
}

function BackupRow() {
  const st = useGame();
  const [busy, setBusy] = useState(false);
  const get = async () => { setBusy(true); try { await game.issueBackupCode(); } finally { setBusy(false); } };
  if (st.me?.has_backup_code) return <button className="muted row" style={{ fontSize: 13 }} onClick={get} data-testid="backup-code-button">🔑 Get a new backup code</button>;
  return (
    <button className="row" style={{ padding: 14, borderRadius: 14, background: "rgba(214,254,89,.08)", border: "1px solid rgba(214,254,89,.3)", textAlign: "left", gap: 12 }} onClick={get} data-testid="backup-code-button">
      <span className="badge-sq" style={{ background: "var(--lime)", color: "var(--bg)" }}>{busy ? <span className="spinner" style={{ width: 12, height: 12 }} /> : "🔑"}</span>
      <div style={{ flex: 1 }}><b style={{ fontSize: 13 }}>Save your account</b><div className="muted" style={{ fontSize: 11, marginTop: 3 }}>Get a backup code so a new phone doesn't wipe your stack.</div></div>
      <span className="lime">›</span>
    </button>
  );
}

export function BackupCodeSheet() {
  const st = useGame();
  const [copied, setCopied] = useState(false);
  const code = st.freshBackupCode;
  return (
    <Sheet open={!!code} onClose={() => undefined} locked>
      <div className="stack" style={{ gap: 18 }}>
        <Eyebrow>Your backup code</Eyebrow>
        <h3 className="h3" style={{ fontSize: 26 }}>Save this somewhere safe.</h3>
        <div className="muted" style={{ fontSize: 13, lineHeight: 1.5 }}>It's the only way to get your account onto a new phone. Screenshot it or put it in your notes. We can't show it again.</div>
        <div className="code-box" data-testid="backup-code">{code}</div>
        <Button variant="ghost" onClick={async () => { await navigator.clipboard?.writeText(code ?? "").catch(() => undefined); setCopied(true); }}>{copied ? "Copied ✓" : "Copy code"}</Button>
        <Button onClick={() => { setCopied(false); game.dismissBackupCode(); }} id="backup-saved">I've saved it</Button>
        <div className="muted" style={{ fontSize: 11 }}>Getting a new code later replaces this one.</div>
      </div>
    </Sheet>
  );
}

function HandleSheet({ open, onClose, toast }: { open: boolean; onClose: () => void; toast: (m: string) => void }) {
  const st = useGame();
  const [draft, setDraft] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setDraft(st.me?.handle ?? ""); setErr(null); } }, [open]); // eslint-disable-line
  return (
    <Sheet open={open} onClose={onClose}>
      <div className="stack" style={{ gap: 16 }}>
        <Eyebrow>Change your handle</Eyebrow><h3 className="h3">New name, same bad takes.</h3>
        <input className="field" value={draft} maxLength={18} autoCapitalize="none" autoCorrect="off"
          onChange={(e) => setDraft(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))} />
        {err && <div className="err">{err}</div>}
        <Button busy={busy} disabled={draft.length < 3 || draft === st.me?.handle} onClick={async () => {
          setBusy(true); setErr(null);
          try { await game.claimHandle(draft); toast(`You're @${draft} now.`); onClose(); } catch (e) { setErr((e as Error).message); }
          setBusy(false);
        }}>Save handle</Button>
      </div>
    </Sheet>
  );
}

function InstallTip() {
  const standalone = typeof window !== "undefined" && (window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone);
  if (standalone) return null;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  return (
    <div className="install-tip">
      <b style={{ color: "#fff" }}>Keep your floor close</b><br />
      {ios ? <>In Safari tap <b>Share</b> → <b>Add to Home Screen</b>.</> : <>In Chrome tap <b>⋮</b> → <b>Install app</b> (or <b>Add to Home screen</b>).</>}
    </div>
  );
}

// ---------- Trade cards (drawn on a canvas so they can be shared as an image)

function TradeCardSheet({ trade, handle, onClose }: { trade: Trade | null; handle: string; onClose: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [link, setLink] = useState("");
  const [copied, setCopied] = useState(false);
  useEffect(() => { setUrl(null); setBlob(null); setError(""); setLink(""); setCopied(false); }, [trade?.id]);
  async function prepare() {
    if (!trade || busy) return;
    setBusy(true); setError("");
    try {
      const token = await game.api.rpc<string>("share_trade", {p_trade:trade.id});
      const target = receiptURL(token);
      const receipt = await game.api.publicRPC<SharedReceipt>("shared_trade", { p_token: token }).catch(() => ({ trade, candles: game.state.candles[trade.market], bucket_seconds: game.state.candleSeconds }));
      const canvas = await drawTradeImage(receipt.trade, handle, target, receipt.candles, receipt.bucket_seconds);
      const image = await new Promise<Blob>((resolve,reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error("Couldn't create the image.")),"image/png"));
      const dataUrl = canvas.toDataURL("image/png");
      setUrl(dataUrl); setBlob(image); setLink(target);
      // One tap: open the share sheet straight away where the phone supports it. If the browser
      // says the tap is too old to share from, the Share button stays up for a second tap.
      if (canShareFile(image)) await share(image, target, dataUrl);
    } catch { setError("Couldn't create the share card. Please try again once sharing is available."); }
    finally { setBusy(false); }
  }
  async function share(b = blob, l = link, u = url) {
    if (!b) return;
    const file = new File([b], "brokie-trade.png", { type: "image/png" });
    if (navigator.canShare?.({ files: [file] })) { try { await navigator.share({ files: [file], title: "Brokie trade", text: l }); return; } catch { return; } }
    const a = document.createElement("a"); a.href = u!; a.download = "brokie-trade.png"; a.click();
  }
  return (
    <Sheet open={!!trade} onClose={onClose}>
      <div className="stack" style={{ gap: 20 }}>
        <div className="row between"><Eyebrow>Trade details</Eyebrow><button className="lime" style={{ fontWeight: 700, fontSize: 13 }} onClick={onClose}>Done</button></div>
        {trade && <div className="stack" style={{ gap: 12 }}><h3 className="h3">{trade.prediction_question ?? MARKETS[trade.market].title} · {trade.prediction_outcome?.toUpperCase() ?? trade.side} · {trade.quantity} {trade.market === "prediction" ? "shares" : "micros"}</h3><div className="detail"><span>Result</span><span className={trade.pnl >= 0 ? "lime" : "red"}>{signedMoney(trade.pnl)}</span></div><div className="detail"><span>Entry → exit</span><span>{px(trade.entry_price)} → {px(trade.exit_price)}</span></div><div className="detail"><span>Closed</span><span>{new Date(trade.closed_at).toLocaleString()}</span></div><div className="detail"><span>Reason</span><span>{trade.reason.replace(/_/g, " ")}</span></div>{trade.trigger_price != null && <div className="detail"><span>Trigger price</span><span>{px(trade.trigger_price)}</span></div>}</div>}
        {trade && <TradeReview trade={trade} />}
        {url && <img src={url} alt="Trade card" className="card-preview" />}
        {!blob ? <><div className="muted" style={{fontSize:12}}>Sharing makes a public receipt link and an image with a QR code. Anyone with the link can view this trade.</div><Button onClick={prepare} busy={busy} id="prepare-card">Share</Button></> : <><Button onClick={() => share()} id="share-card">Share</Button><Button variant="ghost" onClick={async () => { try { await navigator.clipboard.writeText(link); setCopied(true); } catch { setError("Couldn't copy the link. Use the link below."); } }}>{copied ? "Copied ✓" : "Copy receipt link"}</Button><a className="receipt-link" href={link}>{link}</a></>}
        {error && <div className="err" role="alert">{error}</div>}
      </div>
    </Sheet>
  );
}

function LifetimeCard() {
  const lt = useGame().lifetime;
  if (!lt) return <div className="panel muted" role="status">Lifetime stats are unavailable. <button className="text-action lime" onClick={() => void game.refreshLifetime()}>Retry</button></div>;
  const maxAbs = Math.max(1, ...lt.seasons.map((x) => Math.abs(x.return_pct)));
  return (
    <div className="panel stack" style={{ gap: 14 }} data-testid="lifetime">
      <div className="row between"><h2 className="h2">Lifetime</h2><span className="eyebrow">Never resets</span></div>
      <div className="meters">
        {[["Win rate", lt.win_rate == null ? "—" : `${lt.win_rate}%`], ["Trades", String(lt.total_trades)], ["Max drawdown", `${(+lt.max_drawdown).toFixed(1)}%`],
          ["Seasons", String(lt.seasons_played)], ["Funded", String(lt.seasons_funded)], ["Accounts closed", String(lt.seasons_blown)]].map(([k, v]) => (
          <div key={k} className="meter" style={{ background: "var(--bg)" }}><div className="eyebrow" style={{ fontSize: 7 }}>{k}</div><b>{v}</b></div>
        ))}
      </div>
      <div className="season-results"><Eyebrow>Return by season</Eyebrow>
        {lt.seasons.length === 0 && <p className="muted">Your first season will appear here.</p>}
        {lt.seasons.map(x => <div className="season-result" key={x.season}><span>S{x.number}</span><div className="bar"><i style={{ width: `${Math.abs(x.return_pct) / maxAbs * 100}%`, background: x.return_pct >= 0 ? "var(--lime)" : "var(--red)" }} /></div><span className={`mono ${x.return_pct >= 0 ? "lime" : "red"}`}>{x.return_pct >= 0 ? "+" : ""}{x.return_pct.toFixed(2)}%</span></div>)}
      </div>
    </div>
  );
}

/** Which timeframes the chart's timeframe button cycles through. */
function FramesSetting() {
  const st = useGame();
  return (
    <div className="stack" style={{ gap: 8 }} data-testid="frames-setting">
      <div><b style={{ fontSize: 13 }}>Chart timeframes</b>
        <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>Choose the intervals available in the chart’s timeframe control.</div></div>
      <div className="frame-picks" role="group" aria-label="Chart timeframes">
        {FRAME_OPTIONS.map((f) => {
          const on = st.frames.includes(f.s);
          return <button key={f.s} type="button" className={`chip lime ${on ? "on" : ""}`} aria-pressed={on} data-testid={`frame-${f.l}`}
            disabled={on && st.frames.length === 1} onClick={() => game.toggleFrame(f.s)}>{f.l}</button>;
        })}
      </div>
    </div>
  );
}

/** Tapping SELL while long (or BUY while short): take micros off (default) or open a hedge (opt-in). */
function OppositeSetting() {
  const mode = useGame().opposite;
  return (
    <div className="stack" style={{ gap: 8 }} data-testid="opposite-setting">
      <div><b style={{ fontSize: 13 }}>Tapping the other button</b>
        <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>When you're long and tap SELL (or short and tap BUY).</div></div>
      <div className="seg" role="radiogroup" aria-label="Tapping the other button">
        {([["partial", "Take partials"], ["hedge", "Open a hedge"]] as const).map(([v, label]) => (
          <button key={v} type="button" role="radio" aria-checked={mode === v} className={`seg-btn ${mode === v ? "on" : ""}`} onClick={() => game.setOpposite(v)}>{label}</button>
        ))}
      </div>
      <div className="muted" style={{ fontSize: 11 }}>{mode === "partial" ? "Each tap reduces the opposite position by your selected size, newest first. Your SL/TP stays on what's left." : "Each tap opens your selected size the other way, so you're long and short at once."}</div>
    </div>
  );
}

const canShareFile = (b: Blob) => { try { return !!navigator.canShare?.({ files: [new File([b], "brokie-trade.png", { type: "image/png" })] }); } catch { return false; } };

function OrderEffectsSetting() {
  const [sound, setSound] = useState(() => { try { return localStorage.getItem("brokie.sound") === "on"; } catch { return false; } });
  const [touch, setTouch] = useState(() => { try { return localStorage.getItem("brokie.haptics") === "on"; } catch { return false; } });
  return <section className="stack" style={{ gap: 10 }}><b>Feedback</b><small className="muted">Small confirmations, on your terms. Motion follows your device setting.</small><label className="sound-setting"><span>Play order sounds</span><input type="checkbox" checked={sound} onChange={e => { const on = e.target.checked; setSound(on); try { localStorage.setItem("brokie.sound", on ? "on" : "off"); } catch { /* */ } if (on) { saveEffect("soft"); orderEffect("soft", true); } }} /></label><label className="sound-setting"><span>Touch feedback</span><input type="checkbox" checked={touch} onChange={e => { const on=e.target.checked; setTouch(on); try { localStorage.setItem("brokie.haptics",on ? "on" : "off"); } catch { /* */ } if(on) haptic(8); }}/></label></section>;
}
