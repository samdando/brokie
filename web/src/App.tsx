import { Avatar } from "./Avatar";
import { useEffect, useRef, useState } from "react";
import { game, useGame } from "./game";
import { TradeScreen } from "./Trade";
import { SquadScreen } from "./Squad";
import { LearnScreen } from "./Learn";
import { BackupCodeSheet, YouScreen } from "./You";
import { Onboarding } from "./Onboarding";
import { Profiles } from "./Profiles";
import { SharedTradePage } from "./SharedTrade";
import { FlashOverlay } from "./Events";
import { ChatCard, FeedbackSheet } from "./Social";

import { useVoice, voice, ROOMS } from "./voice";
import { Icon, Sheet, useToast } from "./ui";

type Tab = "trade" | "squad" | "learn" | "you";
const TAB_ORDER: Tab[] = ["trade", "squad", "learn", "you"];

export function App() {
  const st = useGame();
  const [tab, setTab] = useState<Tab>(() => (new URLSearchParams(location.search).has("join") ? "squad" : "trade"));
  const [previous, setPrevious] = useState<Tab | null>(null);
  const [slide, setSlide] = useState(1);
  const current = useRef(tab);
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const navigate = (next: Tab) => {
    if (next === current.current) return;
    setSlide(TAB_ORDER.indexOf(next) > TAB_ORDER.indexOf(current.current) ? 1 : -1);
    setPrevious(current.current); current.current = next; setTab(next);
  };
  useEffect(() => { if (!previous) return; const t = setTimeout(() => setPrevious(null), 360); return () => clearTimeout(t); }, [tab, previous]);
  useEffect(() => {
    const lock = () => {
      const orientation = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
      void orientation?.lock?.("portrait-primary").catch(() => {});
    };
    lock(); document.addEventListener("pointerdown", lock, { once: true });
    return () => document.removeEventListener("pointerdown", lock);
  }, []);
  const [toast, setToast] = useToast();
  const [fb, setFb] = useState(false);
  const [reviewHistory, setReviewHistory] = useState(false);
  const sharedToken = new URLSearchParams(location.search).get("trade");
  useEffect(() => { if (!sharedToken) void game.start(); }, [sharedToken]);
  useEffect(() => {
    const onVis = () => game.setActive(!document.hidden);
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);
  useEffect(() => {
    window.scrollTo(0, 0);
    if (tab === "you" && reviewHistory) {
      const frame = requestAnimationFrame(() => { document.getElementById("receipts")?.scrollIntoView({ block: "start" }); });
      return () => cancelAnimationFrame(frame);
    }
  }, [tab, reviewHistory]);

  if (sharedToken) return <SharedTradePage token={sharedToken} />;

  if (st.phase === "unconfigured") return <Centered title="Brokie isn't connected yet" body="This build has no server address. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY and rebuild." />;
  if (st.phase === "connecting" && !st.me) return <Centered title="" body="" spinner />;
  if (st.phase === "needsHandle") return <><Onboarding /><BackupCodeSheet /></>;
  if (!st.me) return <Centered title="Can't reach Brokie" body={st.error ?? "Check your connection."} retry />;

  return (
    <Profiles>
      <div className={`app app-${tab}`}>
        <div className="header">
          <div className="wordmark">brokie<i /></div>
          <button className="avatar-btn" onClick={() => navigate("you")} aria-label="Your profile"><Avatar handle={st.me.handle} /></button>
        </div>
        {st.phase === "failed" && <button className="err panel" style={{ padding: 12, marginBottom: 16, width: "100%", textAlign: "left" }} onClick={() => game.start()}>Connection hiccup: {st.error} · tap to retry</button>}
        <main className="page-stage" style={{ ["--slide" as string]: slide }}
          onTouchStart={e => {
            const el = e.target as HTMLElement;
            if (e.touches.length !== 1 || el.closest("button, a, input, textarea, .chart-card, .pos-card, .hscroll, .selection-wheel, .sheet")) { swipe.current = null; return; }
            swipe.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
          }}
          onTouchEnd={e => {
            const from = swipe.current; swipe.current = null;
            if (!from || !e.changedTouches[0]) return;
            const dx = e.changedTouches[0].clientX - from.x, dy = e.changedTouches[0].clientY - from.y;
            if (Math.abs(dx) < 70 || Math.abs(dx) < Math.abs(dy) * 1.6) return;
            const next = TAB_ORDER[TAB_ORDER.indexOf(tab) + (dx < 0 ? 1 : -1)];
            if (next) { setReviewHistory(false); navigate(next); }
          }}>
          {TAB_ORDER.filter(t => t === tab || t === previous).map(t => <div key={t} className={`page-screen ${t === tab ? previous ? "entering" : "" : "leaving"}`} ref={el => { if (el) el.toggleAttribute("inert", t !== tab); }} aria-hidden={t !== tab || undefined}>
            {t === "trade" && <TradeScreen toast={setToast} goSquad={() => navigate("squad")} goHistory={() => { setReviewHistory(true); navigate("you"); }} />}
            {t === "squad" && <SquadScreen toast={setToast} />}
            {t === "learn" && <LearnScreen goTrade={() => navigate("trade")} />}
            {t === "you" && <YouScreen toast={setToast} onFeedback={() => setFb(true)} />}
          </div>)}
        </main>
      </div>
      {tab !== "squad" && <MiniBar onOpen={() => navigate("squad")} />}
      <nav className="tabs"><div className="tabs-inner">
        {(["trade", "chat", "squad", "learn", "you"] as const).map((t) => t === "chat" ? (
          // Chat opens over whatever screen you're on, so the chart stays put underneath.
          <button key={t} className={`tab chat-btn ${st.chatOpen ? "on" : ""}`} onClick={() => game.setChatOpen(true)} data-testid="chat-btn"
            aria-label={st.chatUnread ? `Squad chat, ${st.chatUnread} new` : "Squad chat"}>
            <span className="tab-ico">{Icon.chat}{st.chatUnread > 0 && <span className="chat-badge" data-testid="chat-badge">{st.chatUnread > 9 ? "9+" : st.chatUnread}</span>}</span>Chat
          </button>
        ) : (
          <button key={t} className={`tab ${tab === t && !st.chatOpen ? "on" : ""}`} aria-current={tab === t && !st.chatOpen ? "page" : undefined} onClick={() => { game.setChatOpen(false); setReviewHistory(false); navigate(t); }} data-testid={`tab-${t}`}>{Icon[t]}{t[0].toUpperCase() + t.slice(1)}</button>
        ))}
      </div></nav>
      {toast && <div className="toast" role="status" data-testid="toast">{toast}</div>}
      <ChatPop onOpen={() => game.setChatOpen(true)} />
      <Sheet open={st.chatOpen} onClose={() => game.setChatOpen(false)}>
        <button className="chat-close" aria-label="Close squad chat" onClick={() => game.setChatOpen(false)}>✕</button>
        {game.squad ? <>
          {st.squads.length > 1 && <div className="hscroll">{st.squads.map((s) => <button key={s.id} className={`squad-chip ${s.id === game.squad?.id ? "on" : ""}`} onClick={() => game.selectSquad(s.id)}>{s.name}</button>)}</div>}
          <ChatCard key={game.squad.id} />
        </> : <div className="quiet-empty stack" style={{ gap: 12 }}>
          <span aria-hidden="true">↗</span><b>Bring the group together.</b>
          <div className="muted" style={{ fontSize: 13 }}>Your squad gets a place for setups, reactions, and everything between trades.</div>
          <button className="big-btn lime" onClick={() => { game.setChatOpen(false); setReviewHistory(false); navigate("squad"); }}>Go to Squad</button>
        </div>}
      </Sheet>
      <FlashOverlay />
      <FeedbackSheet open={fb} onClose={() => setFb(false)} toast={setToast} />
      <BackupCodeSheet />
    </Profiles>
  );
}

function MiniBar({ onOpen }: { onOpen: () => void }) {
  const v = useVoice();
  if (v.status !== "live" && v.status !== "connecting") return null;
  return (
    <div className="minibar">
      <span className={voice.micOn ? "lime" : "muted"}>{voice.micOn ? "〰" : "🔇"}</span>
      <button style={{ flex: 1, textAlign: "left" }} onClick={onOpen}>
        <b style={{ fontSize: 12 }}>{ROOMS.find((r) => r.id === v.room)?.title}</b>
        <div className="muted" style={{ fontSize: 10 }}>{v.status === "connecting" ? "Connecting…" : voice.micOn ? "Mic on" : "Mic muted"}</div>
      </button>
      {!v.ptt && <button className="round-btn" style={{ background: v.muted ? "var(--bg)" : "var(--lime)", color: v.muted ? "#fff" : "var(--bg)" }} onClick={() => voice.toggleMute()} aria-label="Toggle mute">{v.muted ? "🔇" : "🎙"}</button>}
      <button className="round-btn" style={{ background: "rgba(255,125,139,.12)", color: "var(--red)" }} onClick={() => voice.leave()} aria-label="Leave voice">📞</button>
    </div>
  );
}

function Centered({ title, body, spinner, retry }: { title: string; body: string; spinner?: boolean; retry?: boolean }) {
  return (
    <div className="onboard" style={{ justifyContent: "center", alignItems: "center", textAlign: "center", gap: 14 }}>
      <div className="wordmark" style={{ fontSize: 44 }}>brokie<i style={{ width: 11, height: 11 }} /></div>
      {spinner && <span className="spinner lime" style={{ marginTop: 20 }} />}
      {title && <h2 className="h2" style={{ marginTop: 20 }}>{title}</h2>}
      {body && <div className="muted" style={{ fontSize: 13, maxWidth: 300 }}>{body}</div>}
      {retry && <button className="big-btn lime" style={{ width: 200, marginTop: 10 }} onClick={() => game.start()}>Try again</button>}
    </div>
  );
}

/** A squad message slides in at the top on any screen; tap to open the chat, or it goes after 6 s. */
function ChatPop({ onOpen }: { onOpen: () => void }) {
  const pop = useGame().chatPop;
  useEffect(() => {
    if (!pop) return;
    const t = setTimeout(() => game.dismissChatPop(), 6000);
    return () => clearTimeout(t);
  }, [pop]);
  if (!pop) return null;
  return (
    <button type="button" key={pop.id} className="chat-pop" onClick={onOpen} data-testid="chat-pop" aria-label={`New message from @${pop.handle}: ${pop.body}. Open chat`}>
      <Avatar className="chat-pop-av" handle={pop.handle} />
      <span className="chat-pop-text"><b>@{pop.handle}</b><span className={pop.kind === "emoji" ? "chat-pop-emoji" : ""}>{pop.body}</span></span>
      <span className="chat-pop-x" role="presentation" onClick={(e) => { e.stopPropagation(); game.dismissChatPop(); }}>✕</span>
    </button>
  );
}
