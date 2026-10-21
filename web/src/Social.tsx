import { useEffect, useRef, useState } from "react";
import { EMOJIS, game, useGame } from "./game";
import type { FeedbackKind } from "./types";
import { Button, Eyebrow, Sheet, ago, money } from "./ui";

// ---------- Global leaderboard ----------
export function GlobalBoard() {
  const st = useGame();
  const g = st.global;
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void game.refreshGlobal();
    const t = setInterval(() => { if (!document.hidden) void game.refreshGlobal(); }, 15_000);
    return () => clearInterval(t);
  }, []);
  if (!g) return <div style={{ textAlign: "center", padding: 30 }}><span className="spinner lime" /></div>;
  const youInList = g.rows.some((r) => r.is_you);
  const visible = g.me?.show_global !== false;
  return (
    <div data-testid="global-board">
      <div className="row between" style={{ marginBottom: 12 }}>
        <h2 className="h2">Everyone</h2>
        <span className="eyebrow" style={{ fontSize: 8 }}>{g.players} {g.players === 1 ? "player" : "players"} this season</span>
      </div>
      {g.rows.length === 0 && <div className="panel muted" style={{ padding: 18, fontSize: 13 }}>Nobody's traded yet. Be the first on the board.</div>}
      {g.rows.map((r, i) => <GlobalLine key={r.handle} r={r} last={i === g.rows.length - 1} />)}
      {g.me && !youInList && (
        <>
          <div className="muted" style={{ textAlign: "center", fontSize: 12, margin: "6px 0" }}>⋯</div>
          <GlobalLine r={g.me} last />
        </>
      )}
      <div className="muted" style={{ fontSize: 10, marginTop: 12 }}>Ranked by season return. Faded rows haven't hit 5 trading days yet; qualified players rank first.</div>
      <div className="panel row between" style={{ padding: 14, marginTop: 14, borderRadius: 14 }}>
        <div style={{ minWidth: 0 }}><b style={{ fontSize: 13 }}>Show me on the global board</b>
          <div className="muted" style={{ fontSize: 11, marginTop: 3 }}>{visible ? "Everyone can see your @handle and return." : "Hidden. Your squad still sees you."}</div></div>
        <button className={`switch ${visible ? "on" : ""}`} role="switch" aria-checked={visible} aria-label="Show me on the global board" data-testid="global-visibility" disabled={busy}
          onClick={async () => { setBusy(true); try { await game.setGlobalVisibility(!visible); } catch { /* ignore */ } setBusy(false); }}><i /></button>
      </div>
    </div>
  );
}

function GlobalLine({ r, last }: { r: import("./types").GlobalRow; last: boolean }) {
  return (
    <div>
      <div className={`lb-row ${r.is_you ? "you" : ""}`} data-testid="global-row" style={{ opacity: r.qualified ? 1 : 0.7, filter: r.status === "blown" ? "grayscale(.8)" : undefined }}>
        <span className="mono muted" style={{ width: 26, fontSize: 12, fontWeight: 600 }}>{r.rank === 1 && r.return_pct > 0 ? "👑" : r.rank <= 3 && r.qualified ? ["🥇", "🥈", "🥉"][r.rank - 1] : String(r.rank).padStart(2, "0")}</span>
        <span className={`av ${r.is_you ? "you" : ""}`}>{r.handle[0].toUpperCase()}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis" }}>{r.is_you ? "You" : `@${r.handle}`}
            {r.status === "blown" && <span className="chip-status" style={{ background: "#333", color: "#ccc" }}>💀 REKT</span>}
            {r.status === "locked" && <span className="chip-status" style={{ background: "rgba(255,125,139,.12)", color: "var(--red)" }}>🔒</span>}
            {r.funded && <span className="chip-status" style={{ background: "rgba(242,202,115,.15)", color: "var(--gold)" }}>🏆 FUNDED</span>}</div>
          <div className="muted" style={{ fontSize: 10, marginTop: 3 }}>{r.qualified ? `${r.trades} ${r.trades === 1 ? "trade" : "trades"}` : `${r.trading_days}/5 days · ${r.trades} ${r.trades === 1 ? "trade" : "trades"}`}</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div className={`mono ${r.return_pct >= 0 ? "lime" : "red"}`} style={{ fontSize: 14, fontWeight: 600 }}>{r.return_pct >= 0 ? "+" : ""}{r.return_pct.toFixed(2)}%</div>
          <div className="mono muted" style={{ fontSize: 9 }}>{money(r.equity, 0)}</div>
        </div>
      </div>
      {!last && <div className="sep" />}
    </div>
  );
}

// ---------- Squad chat ----------
export function EmojiBar({ onSent, compact }: { onSent?: (err: string | null) => void; compact?: boolean }) {
  const [cool, setCool] = useState(false);
  async function send(e: string) {
    if (cool) return;
    setCool(true); setTimeout(() => setCool(false), 700);
    onSent?.(await game.sendMessage(e, "emoji"));
  }
  return (
    <div className={`emoji-bar ${compact ? "compact" : ""}`} data-testid="emoji-bar">
      {EMOJIS.map((e) => <button key={e} onClick={() => send(e)} aria-label={`Send ${e}`} disabled={cool}>{e}</button>)}
    </div>
  );
}

export function ChatCard() {
  const st = useGame();
  const [text, setText] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    void game.refreshChat();
    const t = setInterval(() => { if (!document.hidden) void game.refreshChat(); }, 3000);
    return () => clearInterval(t);
  }, [st.squadId]);
  useEffect(() => { const el = box.current; if (el) el.scrollTop = el.scrollHeight; }, [st.chat.length]);
  async function send() {
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true); setErr(null);
    const e = await game.sendMessage(body, "text");
    setBusy(false);
    if (e) setErr(e); else setText("");
  }
  return (
    <div className="panel stack" style={{ gap: 12 }} data-testid="chat">
      <Eyebrow>Squad chat</Eyebrow>
      <div className="chat-log" ref={box} aria-live="polite">
        {st.chat.length === 0 && <div className="muted" style={{ fontSize: 12, margin: "auto" }}>No chat yet. Drop an emoji, break the silence.</div>}
        {st.chat.map((m) => m.kind === "emoji" ? (
          <div key={m.id} className={`msg emoji ${m.is_you ? "you" : ""}`} data-testid="chat-msg"><span className="who">{m.is_you ? "You" : `@${m.handle}`}</span><span className="big">{m.body}</span></div>
        ) : (
          <div key={m.id} className={`msg ${m.is_you ? "you" : ""}`} data-testid="chat-msg"><span className="who">{m.is_you ? "You" : `@${m.handle}`} · {ago(m.at)}</span><span>{m.body}</span></div>
        ))}
      </div>
      <EmojiBar onSent={(e) => setErr(e)} />
      <form className="row" style={{ gap: 8 }} onSubmit={(e) => { e.preventDefault(); void send(); }}>
        <input className="field" style={{ flex: 1, height: 44 }} placeholder="Say something…" maxLength={140} value={text} data-testid="chat-input" aria-label="Message your squad"
          onChange={(e) => setText(e.target.value)} />
        <button className="big-btn lime" type="submit" style={{ width: 64, height: 44 }} disabled={busy || !text.trim()} data-testid="chat-send">{busy ? <span className="spinner" /> : "Send"}</button>
      </form>
      {err && <div className="err" data-testid="chat-error">{err}</div>}
    </div>
  );
}

// ---------- Feedback ----------
const KINDS: { id: FeedbackKind; label: string }[] = [
  { id: "bug", label: "🐛 Bug" }, { id: "idea", label: "💡 Idea" }, { id: "love", label: "💚 Love" }, { id: "other", label: "💬 Other" },
];

export function FeedbackSheet({ open, onClose, toast }: { open: boolean; onClose: () => void; toast: (m: string) => void }) {
  const [kind, setKind] = useState<FeedbackKind>("idea");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function send() {
    setBusy(true); setErr(null);
    const e = await game.submitFeedback(kind, msg);
    setBusy(false);
    if (e) { setErr(e); return; }
    setMsg(""); onClose(); toast("Sent. Cheers, that genuinely helps. 🙏");
  }
  return (
    <Sheet open={open} onClose={onClose}>
      <div className="stack" style={{ gap: 16 }}>
        <div className="row between"><Eyebrow>Feedback</Eyebrow><button className="muted" onClick={onClose} aria-label="Close">✕</button></div>
        <h3 className="h3">Tell us what's up.</h3>
        <div className="chips" role="radiogroup" aria-label="Type of feedback">
          {KINDS.map((k) => <button key={k.id} role="radio" aria-checked={kind === k.id} className={`chip lime ${kind === k.id ? "on" : ""}`} onClick={() => setKind(k.id)} data-testid={`fb-${k.id}`}>{k.label}</button>)}
        </div>
        <textarea className="field" rows={5} maxLength={1000} placeholder="Bug, idea, something that felt off, something you loved…" value={msg} onChange={(e) => setMsg(e.target.value)} data-testid="fb-text" aria-label="Your feedback"
          style={{ height: "auto", padding: 14, resize: "none" }} />
        <div className="muted" style={{ fontSize: 10 }}>We'll see your @handle and screen size so we can chase bugs. Nothing else.</div>
        {err && <div className="err" data-testid="fb-error">{err}</div>}
        <Button busy={busy} disabled={msg.trim().length < 3} onClick={send} id="fb-send">Send feedback</Button>
      </div>
    </Sheet>
  );
}
