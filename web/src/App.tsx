import { useEffect, useState } from "react";
import { game, useGame } from "./game";
import { TradeScreen } from "./Trade";
import { SquadScreen } from "./Squad";
import { LearnScreen } from "./Learn";
import { BackupCodeSheet, YouScreen } from "./You";
import { Onboarding } from "./Onboarding";
import { Profiles } from "./Profiles";
import { SharedTradePage } from "./SharedTrade";
import { EventStrip, FlashOverlay } from "./Events";
import { ChatCard, FeedbackSheet } from "./Social";
import { avatarColor } from "./Bubbles";
import { useVoice, voice, ROOMS } from "./voice";
import { Icon, Sheet, useNow, useToast } from "./ui";

type Tab = "trade" | "squad" | "learn" | "you";

export function App() {
  const st = useGame();
  const [tab, setTab] = useState<Tab>(() => (new URLSearchParams(location.search).has("join") ? "squad" : "trade"));
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
      <div className="app">
        <div className="header">
          <div className="wordmark">brokie<i /></div>
          <SeasonTimer number={st.me.season_number ?? 1} end={st.me.season_ends_at} offset={st.clockOffset} />
          <button className="avatar-btn" onClick={() => setTab("you")} aria-label="Your profile">{st.me.handle[0].toUpperCase()}</button>
        </div>
        <EventStrip />
        {st.phase === "failed" && <button className="err panel" style={{ padding: 12, marginBottom: 16, width: "100%", textAlign: "left" }} onClick={() => game.start()}>Connection hiccup: {st.error} · tap to retry</button>}
        {tab === "trade" && <TradeScreen toast={setToast} goSquad={() => setTab("squad")} goHistory={() => { setReviewHistory(true); setTab("you"); }} />}
        {tab === "squad" && <SquadScreen toast={setToast} />}
        {tab === "learn" && <LearnScreen goTrade={() => setTab("trade")} />}
        {tab === "you" && <YouScreen toast={setToast} onFeedback={() => setFb(true)} />}
      </div>
      {tab !== "squad" && <MiniBar onOpen={() => setTab("squad")} />}
      <nav className="tabs"><div className="tabs-inner">
        {(["trade", "chat", "squad", "learn", "you"] as const).map((t) => t === "chat" ? (
          // Chat opens over whatever screen you're on, so the chart stays put underneath.
          <button key={t} className={`tab chat-btn ${st.chatOpen ? "on" : ""}`} onClick={() => game.setChatOpen(true)} data-testid="chat-btn"
            aria-label={st.chatUnread ? `Squad chat, ${st.chatUnread} new` : "Squad chat"}>
            <span className="tab-ico">{Icon.chat}{st.chatUnread > 0 && <span className="chat-badge" data-testid="chat-badge">{st.chatUnread > 9 ? "9+" : st.chatUnread}</span>}</span>Chat
          </button>
        ) : (
          <button key={t} className={`tab ${tab === t && !st.chatOpen ? "on" : ""}`} onClick={() => { game.setChatOpen(false); setReviewHistory(false); setTab(t); }} data-testid={`tab-${t}`}>{Icon[t]}{t[0].toUpperCase() + t.slice(1)}</button>
        ))}
      </div></nav>
      {toast && <div className="toast" role="status" data-testid="toast">{toast}</div>}
      <ChatPop onOpen={() => game.setChatOpen(true)} />
      <Sheet open={st.chatOpen} onClose={() => game.setChatOpen(false)}>
        <button className="text-action lime" onClick={() => game.setChatOpen(false)}>Done</button>
        {game.squad ? <>
          {st.squads.length > 1 && <div className="hscroll">{st.squads.map((s) => <button key={s.id} className={`squad-chip ${s.id === game.squad?.id ? "on" : ""}`} onClick={() => game.selectSquad(s.id)}>{s.name}</button>)}</div>}
          <ChatCard key={game.squad.id} />
        </> : <div className="panel stack" style={{ gap: 12 }}>
          <b>No squad yet</b>
          <div className="muted" style={{ fontSize: 13 }}>Chat is for your squad. Start one or join with an invite code.</div>
          <button className="big-btn lime" onClick={() => { game.setChatOpen(false); setReviewHistory(false); setTab("squad"); }}>Go to Squad</button>
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
      <span className="chat-pop-av" style={{ background: avatarColor(pop.handle) }} aria-hidden="true">{pop.handle[0]?.toUpperCase()}</span>
      <span className="chat-pop-text"><b>@{pop.handle}</b><span className={pop.kind === "emoji" ? "chat-pop-emoji" : ""}>{pop.body}</span></span>
      <span className="chat-pop-x" role="presentation" onClick={(e) => { e.stopPropagation(); game.dismissChatPop(); }}>✕</span>
    </button>
  );
}

/** Ticks on its own so the rest of the app doesn't re-render every second. */
function SeasonTimer({ number, end, offset }: { number: number; end: string; offset: number }) {
  const now = useNow(1000) + offset;
  const remaining = Math.max(0, Date.parse(end) - now);
  const minutes = Math.ceil(remaining / 60000);
  const progress = Math.max(0, Math.min(100, (1 - remaining / (56 * 86400000)) * 100));
  return <div className="season-timer" data-testid="season-pill" title={`Season ${number} · 8 weeks · ends Monday 00:00 Brisbane`}>
    <span><span className="season-word">Season </span><span className="season-short">S</span>{number} · <span className="season-digits">{Math.floor(minutes / 1440)}d {String(Math.floor(minutes / 60) % 24).padStart(2, "0")}h {String(minutes % 60).padStart(2, "0")}m</span> left</span>
    <div className="season-progress" role="progressbar" aria-label="Season elapsed" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress)}><i style={{ width: `${progress}%` }} /></div>
  </div>;
}
