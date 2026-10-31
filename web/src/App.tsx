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
import { Icon, useToast } from "./ui";
import { usePageSwipe } from "./pageSwipe";

type Tab = "trade" | "chat" | "squad" | "learn" | "you";
const TAB_ORDER: Tab[] = ["trade", "chat", "squad", "learn", "you"];

export function App() {
  const st = useGame();
  const [tab, setTab] = useState<Tab>(() => (new URLSearchParams(location.search).has("join") ? "squad" : "trade"));
  const [previous, setPrevious] = useState<Tab | null>(null);
  const [slide, setSlide] = useState(1);
  const current = useRef(tab);
  const [deck, setDeck] = useState<HTMLElement | null>(null);
  const [peek, setPeek] = useState<Tab | null>(null);
  const navigate = (next: Tab, instant = false) => {
    if (next === current.current) return;
    setSlide(TAB_ORDER.indexOf(next) > TAB_ORDER.indexOf(current.current) ? 1 : -1);
    game.setChatOpen(next === "chat");
    setPeek(null);
    setPrevious(instant ? null : current.current); current.current = next; setTab(next);
  };
  useEffect(() => { if (!previous) return; const t = setTimeout(() => setPrevious(null), 300); return () => clearTimeout(t); }, [tab, previous]);
  const neighbour = (step: 1 | -1) => TAB_ORDER[TAB_ORDER.indexOf(current.current) + step] ?? null;
  usePageSwipe(deck, {
    canGo: (step) => !!neighbour(step),
    onPeek: (step) => setPeek(step ? neighbour(step) : null),
    onCommit: (step) => { const next = neighbour(step); if (!next) return; setReviewHistory(false); navigate(next, true); },
  });
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
          <div className="page-map" aria-label="App pages">{TAB_ORDER.map((t, i) => <button type="button" key={t} aria-label={`Go to ${t}`} aria-current={t === tab ? "page" : undefined} onClick={() => { setReviewHistory(false); navigate(t); }}><i/>{t === tab ? <span>{t === "you" ? "You" : t[0].toUpperCase() + t.slice(1)}</span> : null}{i === TAB_ORDER.indexOf(tab) + 1 && <small aria-hidden="true">→</small>}</button>)}</div>
          <button className="avatar-btn" onClick={() => navigate("you")} aria-label="Your profile"><Avatar handle={st.me.handle} /></button>
        </div>
        {st.phase === "failed" && <button className="err panel" style={{ padding: 12, marginBottom: 16, width: "100%", textAlign: "left" }} onClick={() => game.start()}>Connection hiccup: {st.error} · tap to retry</button>}
        <main ref={setDeck} className="page-stage swipe-deck" data-testid="page-deck" style={{ ["--slide" as string]: slide }}>
          {TAB_ORDER.filter(t => t === tab || t === previous || t === peek).map(t => <div key={t} data-page-role={t === tab ? "current" : t === peek ? "peek" : "previous"} className={`page-screen ${t === tab ? previous ? "entering" : "" : t === previous ? "leaving" : "peeking"}`} style={t === peek && t !== tab ? { transform: `translate3d(${TAB_ORDER.indexOf(t) > TAB_ORDER.indexOf(tab) ? 100 : -100}%,0,0)` } : undefined} ref={el => { if (el) el.toggleAttribute("inert", t !== tab); }} aria-hidden={t !== tab || undefined}>
            {t === "trade" && <TradeScreen toast={setToast} goSquad={() => navigate("squad")} goHistory={() => { setReviewHistory(true); navigate("you"); }} />}
            {t === "chat" && <div className="chat-page secondary-screen" data-testid="chat-page">
              <div className="page-heading"><span className="eyebrow">Chat</span><h1>Your people.<br/>Your market.</h1></div>
              {game.squad ? <>{st.squads.length > 1 && <div className="hscroll">{st.squads.map(s => <button key={s.id} className={`squad-chip ${s.id === game.squad?.id ? "on" : ""}`} onClick={() => game.selectSquad(s.id)}>{s.name}</button>)}</div>}<ChatCard key={game.squad.id}/></> : <div className="quiet-empty stack" style={{ gap: 12 }}><span aria-hidden="true">↗</span><b>Bring the group together.</b><div className="muted">Your squad gets a place for setups, reactions, and everything between trades.</div><button className="big-btn lime" onClick={() => navigate("squad")}>Go to Squad</button></div>}
            </div>}
            {t === "squad" && <SquadScreen toast={setToast} />}
            {t === "learn" && <LearnScreen goTrade={() => navigate("trade")} />}
            {t === "you" && <YouScreen toast={setToast} onFeedback={() => setFb(true)} />}
          </div>)}
        </main>
      </div>
      {tab !== "squad" && <MiniBar onOpen={() => navigate("squad")} />}
      <nav className="tabs"><div className="tabs-inner">
        {(["trade", "chat", "squad", "learn", "you"] as const).map((t) => t === "chat" ? (
          // Chat participates in the same swipe order as the other main pages.
          <button key={t} className={`tab chat-btn ${tab === "chat" ? "on" : ""}`} aria-current={tab === "chat" ? "page" : undefined} onClick={() => { setReviewHistory(false); navigate("chat"); }} data-testid="chat-btn"
            aria-label={st.chatUnread ? `Squad chat, ${st.chatUnread} new` : "Squad chat"}>
            <span className="tab-ico">{Icon.chat}{st.chatUnread > 0 && <span className="chat-badge" data-testid="chat-badge">{st.chatUnread > 9 ? "9+" : st.chatUnread}</span>}</span>Chat
          </button>
        ) : (
          <button key={t} className={`tab ${tab === t ? "on" : ""}`} aria-current={tab === t ? "page" : undefined} onClick={() => { setReviewHistory(false); navigate(t); }} data-testid={`tab-${t}`}>{Icon[t]}{t[0].toUpperCase() + t.slice(1)}</button>
        ))}
      </div></nav>
      {toast && <div className="toast" role="status" data-testid="toast">{toast}</div>}
      <ChatPop onOpen={() => navigate("chat")} />
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
