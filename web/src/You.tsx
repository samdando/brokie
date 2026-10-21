import { useEffect, useState } from "react";
import { game, useGame } from "./game";
import { Button, Eyebrow, Sheet, countdown, money, px, signedMoney } from "./ui";
import { MARKETS, Trade, pnlOf } from "./types";

export function YouScreen({ toast }: { toast: (m: string) => void }) {
  const st = useGame();
  const me = st.me!;
  const [edit, setEdit] = useState(false);
  const [card, setCard] = useState<Trade | null>(null);
  const unrealized = me.positions.reduce((s, p) => { const q = game.quote(p.market)?.price; return s + (q ? pnlOf(p, q) : 0); }, 0);
  const wins = me.trades.filter((t) => t.pnl > 0).length;
  const base = me.rules?.start_balance ?? 10000;
  useEffect(() => { void game.refreshLifetime(); }, []);
  return (
    <div className="stack" style={{ gap: 24 }}>
      <div><h1 className="title">Your trading arc.</h1><div className="muted" style={{ fontSize: 13 }}>Every great trader starts somewhere.</div></div>
      <div className="row" style={{ gap: 16 }}>
        <span style={{ width: 60, height: 60, borderRadius: 20, background: "var(--lime)", color: "var(--bg)", display: "grid", placeItems: "center", font: "700 26px var(--round)" }}>{me.handle[0].toUpperCase()}</span>
        <div>
          <button onClick={() => setEdit(true)} style={{ font: "700 23px var(--round)" }} data-testid="edit-handle">@{me.handle} <span className="muted" style={{ fontSize: 14 }}>✎</span></button>
          <div className="eyebrow" style={{ fontSize: 8, marginTop: 5 }}>Founding brokie · resets in {countdown(me.season_ends_at, game.now())}</div>
        </div>
      </div>
      <div className="row" style={{ gap: 10 }}>
        {[["Closed trades", String(me.trades.length)], ["Win rate", me.trades.length ? `${Math.round((wins / me.trades.length) * 100)}%` : "—"], ["Season P&L", signedMoney(me.cash - base)]].map(([k, v]) => (
          <div key={k} className="panel" style={{ flex: 1, padding: 13, borderRadius: 14 }}><div className="eyebrow" style={{ fontSize: 7 }}>{k}</div><div style={{ font: "600 19px var(--round)", marginTop: 12, whiteSpace: "nowrap" }}>{v}</div></div>
        ))}
      </div>
      <div className="panel stack" style={{ gap: 14, padding: 18, borderRadius: 16 }}>
        <div className="detail"><span>Paper cash</span><span>{money(me.cash)}</span></div>
        <div className="detail"><span>Open P&amp;L</span><span>{signedMoney(unrealized)}</span></div>
        {me.protection_credit > 0 && <div className="detail"><span>Liquidation credit</span><span>{money(me.protection_credit)}</span></div>}
      </div>

      <LifetimeCard />
      <BackupRow />

      <div className="stack" style={{ gap: 14 }}>
        <div className="row between"><h2 className="h2">The receipts</h2><span className="eyebrow">Tap to share</span></div>
        {me.trades.length === 0 && <div className="panel muted" style={{ fontSize: 13, padding: 18 }}>Close your first trade and it will land here. Wins, losses, character development.</div>}
        {me.trades.map((t) => (
          <button key={t.id} className="panel row" style={{ padding: 15, borderRadius: 13, textAlign: "left" }} onClick={() => setCard(t)} data-testid="receipt">
            <div style={{ flex: 1 }}><div style={{ fontSize: 13, fontWeight: 600 }}>{MARKETS[t.market].title} · {t.side === "long" ? "Long" : "Short"} · {t.quantity} micro{t.reason !== "closed" ? ` · ${t.reason.replace("_", " ")}` : ""}</div>
              <div className="mono muted" style={{ fontSize: 10, marginTop: 5 }}>{px(t.entry_price)} → {px(t.exit_price)}</div></div>
            <span className={`mono ${t.pnl >= 0 ? "lime" : "red"}`} style={{ fontSize: 13, fontWeight: 700 }}>{signedMoney(t.pnl)}</span>
            <span className="muted" style={{ fontSize: 12 }}>↗</span>
          </button>
        ))}
      </div>
      <InstallTip />
      <div className="mono muted" style={{ fontSize: 10, textAlign: "center", lineHeight: 1.8 }}>BROKIE / 0.2 WEB<br />All the market. None of the rent money.</div>
      <HandleSheet open={edit} onClose={() => setEdit(false)} toast={toast} />
      <TradeCardSheet trade={card} handle={me.handle} onClose={() => setCard(null)} />
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
      <b style={{ color: "#fff" }}>📲 Put Brokie on your home screen</b><br />
      {ios ? <>In Safari tap <b>Share</b> → <b>Add to Home Screen</b>.</> : <>In Chrome tap <b>⋮</b> → <b>Install app</b> (or <b>Add to Home screen</b>).</>}
    </div>
  );
}

// ---------- Trade cards (drawn on a canvas so they can be shared as an image)

function drawCard(t: Trade, handle: string): HTMLCanvasElement {
  const W = 1020, H = 1275, c = document.createElement("canvas");
  c.width = W; c.height = H;
  const g = c.getContext("2d")!;
  const tint = t.pnl >= 0 ? "#D6FE59" : "#FF7D8B";
  g.fillStyle = "#0C0E0B"; g.fillRect(0, 0, W, H);
  const rg = g.createRadialGradient(W, 0, 10, W, 0, 1100); rg.addColorStop(0, tint + "3A"); rg.addColorStop(1, "#0C0E0B00");
  g.fillStyle = rg; g.fillRect(0, 0, W, H);
  const round = "ui-rounded, 'SF Pro Rounded', Nunito, system-ui, sans-serif", mono = "ui-monospace, Menlo, monospace";
  g.fillStyle = "#fff"; g.font = `900 66px ${round}`; g.fillText("brokie", 72, 140);
  g.fillStyle = "#D6FE59"; g.beginPath(); g.arc(72 + g.measureText("brokie").width + 18, 128, 9, 0, 7); g.fill();
  g.font = `800 24px ${mono}`; g.fillStyle = "#D6FE59"; g.fillText("PAPER TRADE", W - 290, 130);
  const m = MARKETS[t.market];
  g.fillStyle = "#fff"; g.font = `800 46px ${round}`; g.fillText(`${t.side.toUpperCase()} ${m.title} ×${t.quantity}`, 72, 560);
  g.fillStyle = "#969D8D"; g.font = `500 30px system-ui`; g.fillText(`${m.subtitle} · ${m.symbol}`, 72, 610);
  g.fillStyle = tint; g.font = `700 160px ${round}`; g.fillText(signedMoney(t.pnl), 66, 790);
  const move = (t.exit_price - t.entry_price) * (t.side === "long" ? 1 : -1);
  g.fillStyle = "rgba(255,255,255,.7)"; g.font = `500 32px ${mono}`;
  g.fillText(`${px(t.entry_price)} → ${px(t.exit_price)}  ·  ${move >= 0 ? "+" : "−"}${px(Math.abs(move))} pts`, 72, 860);
  g.fillStyle = "#fff"; g.font = `700 38px system-ui`; g.fillText(`@${handle}`, 72, 1130);
  g.fillStyle = "#969D8D"; g.font = `500 26px system-ui`; g.fillText("Fake money. Real bragging rights.", 72, 1190);
  g.font = `500 28px system-ui`; const when = new Date(t.closed_at).toLocaleDateString(undefined, { day: "numeric", month: "short" });
  g.fillText(when, W - 72 - g.measureText(when).width, 1130);
  return c;
}

function TradeCardSheet({ trade, handle, onClose }: { trade: Trade | null; handle: string; onClose: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [blob, setBlob] = useState<Blob | null>(null);
  useEffect(() => {
    if (!trade) { setUrl(null); setBlob(null); return; }
    const canvas = drawCard(trade, handle);
    setUrl(canvas.toDataURL("image/png"));
    canvas.toBlob((b) => setBlob(b), "image/png");
  }, [trade, handle]);
  async function share() {
    if (!blob) return;
    const file = new File([blob], "brokie-trade.png", { type: "image/png" });
    if (navigator.canShare?.({ files: [file] })) { try { await navigator.share({ files: [file], title: "Brokie trade" }); return; } catch { return; } }
    const a = document.createElement("a"); a.href = url!; a.download = "brokie-trade.png"; a.click();
  }
  return (
    <Sheet open={!!trade} onClose={onClose}>
      <div className="stack" style={{ gap: 20 }}>
        <div className="row between"><Eyebrow>Trade card</Eyebrow><button className="lime" style={{ fontWeight: 700, fontSize: 13 }} onClick={onClose}>Done</button></div>
        {url && <img src={url} alt="Trade card" className="card-preview" />}
        <Button onClick={share} disabled={!blob} id="share-card">Share to the group chat ↗</Button>
      </div>
    </Sheet>
  );
}

function LifetimeCard() {
  const lt = useGame().lifetime;
  if (!lt) return null;
  const maxAbs = Math.max(1, ...lt.seasons.map((x) => Math.abs(x.return_pct)));
  return (
    <div className="panel stack" style={{ gap: 14 }} data-testid="lifetime">
      <div className="row between"><h2 className="h2">Lifetime</h2><span className="eyebrow">Never resets</span></div>
      <div className="meters">
        {[["Win rate", lt.win_rate == null ? "—" : `${lt.win_rate}%`], ["Trades", String(lt.total_trades)], ["Max DD", `${(+lt.max_drawdown).toFixed(1)}%`],
          ["Seasons", String(lt.seasons_played)], ["Funded 🏆", String(lt.seasons_funded)], ["Blown 💀", String(lt.seasons_blown)]].map(([k, v]) => (
          <div key={k} className="meter" style={{ background: "var(--bg)" }}><div className="eyebrow" style={{ fontSize: 7 }}>{k}</div><b>{v}</b></div>
        ))}
      </div>
      <div>
        <div className="eyebrow" style={{ fontSize: 7, marginBottom: 8 }}>Season by season</div>
        <div className="row" style={{ alignItems: "flex-end", gap: 6, height: 54 }}>
          {lt.seasons.map((x) => (
            <div key={x.season} style={{ flex: 1, maxWidth: 36, textAlign: "center" }}>
              <div style={{ height: Math.max(3, Math.abs(x.return_pct) / maxAbs * 40), background: x.status === "blown" ? "#555" : x.return_pct >= 0 ? "var(--lime)" : "var(--red)", borderRadius: 3 }} />
              <div className="mono muted" style={{ fontSize: 8, marginTop: 4 }}>S{x.number}{x.funded ? "🏆" : x.status === "blown" ? "💀" : ""}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
