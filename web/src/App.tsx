import { useEffect, useState } from "react";
import { game, useGame } from "./game";
import { TradeScreen } from "./Trade";
import { SquadScreen } from "./Squad";
import { LearnScreen } from "./Learn";
import { BackupCodeSheet, YouScreen } from "./You";
import { Onboarding } from "./Onboarding";
import { EventStrip, FlashOverlay } from "./Events";
import { FeedbackSheet } from "./Social";
import { useVoice, voice, ROOMS } from "./voice";
import { Icon, countdown, useNow, useToast } from "./ui";

type Tab = "trade" | "squad" | "learn" | "you";

export function App() {
  const st = useGame();
  const [tab, setTab] = useState<Tab>(() => (new URLSearchParams(location.search).has("join") ? "squad" : "trade"));
  const [toast, setToast] = useToast();
  const now = useNow(30_000);
  const [fb, setFb] = useState(false);
  useEffect(() => { void game.start(); }, []);
  useEffect(() => {
    const onVis = () => game.setActive(!document.hidden);
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);
  useEffect(() => { window.scrollTo(0, 0); }, [tab]);

  if (st.phase === "unconfigured") return <Centered title="Brokie isn't connected yet" body="This build has no server address. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY and rebuild." />;
  if (st.phase === "connecting" && !st.me) return <Centered title="" body="" spinner />;
  if (st.phase === "needsHandle") return <><Onboarding /><BackupCodeSheet /></>;
  if (!st.me) return <Centered title="Can't reach Brokie" body={st.error ?? "Check your connection."} retry />;

  return (
    <>
      <div className="app">
        <div className="header">
          <div className="wordmark">brokie<i /></div>
          <span className="pill-btn" data-testid="season-pill">S{st.me.season_number ?? ""} · {countdown(st.me.season_ends_at, now + st.clockOffset).toUpperCase()} LEFT</span>
          <button className="icon-btn" onClick={() => setFb(true)} aria-label="Send feedback" data-testid="feedback-btn">💬</button>
          <button className="avatar-btn" onClick={() => setTab("you")} aria-label="Your profile">{st.me.handle[0].toUpperCase()}</button>
        </div>
        <EventStrip />
        {st.phase === "failed" && <button className="err panel" style={{ padding: 12, marginBottom: 16, width: "100%", textAlign: "left" }} onClick={() => game.start()}>Connection hiccup: {st.error} · tap to retry</button>}
        {tab === "trade" && <TradeScreen toast={setToast} goSquad={() => setTab("squad")} />}
        {tab === "squad" && <SquadScreen />}
        {tab === "learn" && <LearnScreen />}
        {tab === "you" && <YouScreen toast={setToast} />}
      </div>
      {tab !== "squad" && <MiniBar onOpen={() => setTab("squad")} />}
      <nav className="tabs"><div className="tabs-inner">
        {(["trade", "squad", "learn", "you"] as Tab[]).map((t) => (
          <button key={t} className={`tab ${tab === t ? "on" : ""}`} onClick={() => setTab(t)} data-testid={`tab-${t}`}>{Icon[t]}{t[0].toUpperCase() + t.slice(1)}</button>
        ))}
      </div></nav>
      {toast && <div className="toast" data-testid="toast">{toast}</div>}
      <FlashOverlay />
      <FeedbackSheet open={fb} onClose={() => setFb(false)} toast={setToast} />
      <BackupCodeSheet />
    </>
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
