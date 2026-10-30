import { Avatar, usePlayerAccent } from "./Avatar";
import { TodayPnl } from "./TodayPnl";
import { PlayerLink } from "./Profiles";
import { useEffect, useRef, useState } from "react";
import { EMOJIS, game, useGame } from "./game";
import type { ChatMsg, FeedbackKind } from "./types";
import { Button, Eyebrow, Sheet, money } from "./ui";

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
      <div className="muted" style={{ fontSize: 10, marginTop: 12 }}>Ranked by season return, qualified players first. Other ranks are provisional until 5 trading days.</div>
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
      <div className={`lb-row ${r.is_you ? "you" : ""} ${r.status === "blown" ? "rekt" : ""} ${r.funded ? "funded" : ""}`} data-testid="global-row" style={{ filter: r.status === "blown" ? "grayscale(.8)" : undefined }}>
        <span className="mono muted" style={{ width: 26, fontSize: 12, fontWeight: 600 }}>{String(r.rank).padStart(2, "0")}</span>
        <Avatar handle={r.handle} className={r.is_you ? "you" : ""} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis" }}><PlayerLink handle={r.handle}>{r.is_you ? "You" : `@${r.handle}`}</PlayerLink> <TodayPnl value={r.today_pnl} />
            {r.status === "blown" ? <span className="chip-status">Account closed</span> : r.status === "locked" ? <span className="chip-status">Daily limit</span> : r.funded && <span className="chip-status lime">Funded</span>}</div>
          <div className="muted" style={{ fontSize: 10, marginTop: 3 }}>{r.qualified ? `${r.trades} ${r.trades === 1 ? "trade" : "trades"}` : `Qualifying · ${r.trading_days}/5 days · ${r.trades} ${r.trades === 1 ? "trade" : "trades"}`}</div>
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
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [unread, setUnread] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const lastSent = useRef(false);
  const jump = () => { const el = box.current; if (el) el.scrollTop = el.scrollHeight; atBottom.current = true; setUnread(false); };
  useEffect(() => {
    void game.refreshChat();
    const t = setInterval(() => { if (!document.hidden) void game.refreshChat(); }, 3000);
    return () => clearInterval(t);
  }, [st.squadId]);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => { if (atBottom.current) jump(); });
    ro.observe(el); return () => ro.disconnect();
  }, []);
  const latestId = st.chat[st.chat.length - 1]?.id;
  useEffect(() => {
    if (atBottom.current || lastSent.current) { jump(); lastSent.current = false; }
    else setUnread(true);
  }, [latestId]);
  async function send() {
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true); setErr(null); lastSent.current = true;
    const e = await game.sendMessage(body, "text");
    setBusy(false);
    if (e) { setErr(e); lastSent.current = false; } else { setText(""); jump(); }
  }
  return (
    <div className="chat-room" data-testid="chat">
      <header className="chat-heading"><span className="chat-room-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M5 5h14v11H9l-4 3Z"/></svg></span><div><h2>{game.squad?.name ?? "Squad chat"}</h2><small>{game.squad?.member_count ?? 0} members · Your trading circle</small></div></header>
      <div className="chat-log" ref={box} role="log" aria-label="Squad messages" aria-live="polite" onScroll={() => { const el = box.current; if (el) { atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48; if (atBottom.current) setUnread(false); } }}>
        {st.chat.length === 0 && <div className="chat-empty"><div className="chat-empty-faces" aria-hidden="true">{st.leaderboard.slice(0,3).map(p=><Avatar key={p.handle} handle={p.handle}/>)}</div><b>A market worth talking about.</b><small>Drop a setup, celebrate a close,<br />or just say you're here.</small></div>}
        {st.chat.map((m, i) => {
          const prev = st.chat[i - 1], next = st.chat[i + 1];
          const day = new Date(m.at).toLocaleDateString();
          const newDay = !prev || new Date(prev.at).toLocaleDateString() !== day;
          const grouped = !newDay && prev.handle === m.handle && Date.parse(m.at) - Date.parse(prev.at) < 300000;
          const end = !next || next.handle !== m.handle || Date.parse(next.at) - Date.parse(m.at) >= 300000 || new Date(next.at).toLocaleDateString() !== day;
          return <div key={m.id} className="chat-entry">
            {newDay && <div className="chat-day"><span>{day === new Date().toLocaleDateString() ? "Today" : new Date(m.at).toLocaleDateString([], { day: "numeric", month: "short" })}</span></div>}
            <MessageRow message={m} grouped={grouped} end={end} />
          </div>;
        })}
      </div>
      {unread && <button className="chat-new" onClick={jump}>New messages ↓</button>}
      <div className="chat-composer">
        {emojiOpen && <EmojiBar onSent={e => { setErr(e); if (!e) jump(); }} />}
        <form onSubmit={e => { e.preventDefault(); void send(); }}>
          <button className="chat-react" type="button" aria-label="Emoji reactions" aria-expanded={emojiOpen} onClick={() => setEmojiOpen(!emojiOpen)}>☺</button>
          <input className="field" placeholder="Message the squad…" maxLength={140} value={text} data-testid="chat-input" aria-label="Message your squad" onChange={e => setText(e.target.value)} />
          <button className="chat-send" type="submit" disabled={busy || !text.trim()} data-testid="chat-send" aria-label="Send message">{busy ? <span className="spinner" /> : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true"><path d="M12 19V5m-6 6 6-6 6 6" /></svg>}</button>
        </form>
        {err && <div className="err" role="alert" data-testid="chat-error">{err}</div>}
      </div>
    </div>
  );
}

function MessageRow({ message:m, grouped, end }: { message: ChatMsg; grouped: boolean; end: boolean }) {
  const accent = usePlayerAccent(m.handle);
  return <div className={`message-row ${m.is_you ? "mine" : ""} ${grouped ? "grouped" : ""}`} style={{ ["--player-accent" as string]: accent }}>
    {!m.is_you && <div className="message-avatar">{!grouped && <Avatar handle={m.handle} />}</div>}
    <div className="message-content">
      {!grouped && !m.is_you && <PlayerLink handle={m.handle}>@{m.handle}</PlayerLink>}
      <div className={`msg ${m.kind === "emoji" ? "emoji" : ""} ${m.is_you ? "you" : ""}`} data-testid="chat-msg"><span className={m.kind === "emoji" ? "big" : "message-body"}>{m.body}</span></div>
      {end && <time className="message-time" dateTime={m.at}>{new Date(m.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</time>}
    </div>
  </div>;
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
