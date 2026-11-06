import { Avatar } from "./Avatar";
import { ClubFloor, type FloorView } from "./ClubFloor";
import { pnlOf } from "./types";
import { useEffect, useState } from "react";
import { game, useGame } from "./game";
import { TradeScreen } from "./Trade";
import { BackupCodeSheet, YouScreen } from "./You";
import { Onboarding } from "./Onboarding";
import { Profiles } from "./Profiles";
import { SharedTradePage } from "./SharedTrade";
import { RushHost, RushPage } from "./Rush";
import { FlashOverlay } from "./Events";
import { FeedbackSheet } from "./Social";

import { useVoice, voice, ROOMS } from "./voice";
import { Icon, money, useToast } from "./ui";

type Tab = "trade" | "squad" | "you";
const TAB_ORDER: Tab[] = ["trade", "squad", "you"];

export function App() {
  const st = useGame();
  const [tab, setTab] = useState<Tab>(() => (new URLSearchParams(location.search).has("join") ? "squad" : "trade"));
  const [floorView, setFloorView] = useState<FloorView>("trades");
  const [toast, setToast] = useToast();
  const navigate = (next: Tab) => {
    setToast(null);
    setTab(next);
  };
  const openFloor = (view: FloorView = "trades") => { setFloorView(view); navigate("squad"); };
  useEffect(() => { game.setChatOpen(tab === "squad" && floorView === "chat"); }, [tab, floorView]);
  useEffect(() => {
    const lock = () => {
      const orientation = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
      void orientation?.lock?.("portrait-primary").catch(() => {});
    };
    lock(); document.addEventListener("pointerdown", lock, { once: true });
    return () => document.removeEventListener("pointerdown", lock);
  }, []);
  const [fb, setFb] = useState(false);
  const [reviewHistory, setReviewHistory] = useState(false);
  const sharedToken = new URLSearchParams(location.search).get("trade");
  const rushSeed = new URLSearchParams(location.search).get("rush");
  useEffect(() => { if (!sharedToken && !rushSeed) void game.start(); }, [sharedToken, rushSeed]);
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
  if (rushSeed) return <RushPage seed={rushSeed} />;

  if (st.phase === "unconfigured") return <Centered title="Brokie isn't connected yet" body="This build has no server address. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY and rebuild." />;
  if (st.phase === "connecting" && !st.me) return <Centered title="" body="" spinner />;
  if (st.phase === "needsHandle") return <><Onboarding /><BackupCodeSheet /></>;
  if (!st.me) return <Centered title="Can't reach Brokie" body={st.error ?? "Check your connection."} retry />;

  return (
    <Profiles>
      <div className={`clubhouse-root clubhouse-${tab}`}>
      <div className={`app app-${tab}`}>
        <div className="header">
          <div className="wordmark">brokie<i /></div>
          <button className="club-balance" onClick={() => navigate("you")} aria-label="Your paper account"><span>Paper equity</span><b>{money(st.me.cash + st.me.positions.reduce((sum,p) => sum + (p.market === "prediction" ? pnlOf(p,0) : game.quote(p.market) ? pnlOf(p,game.quote(p.market)!.price) : 0),0))}</b></button>
        </div>
        {st.phase === "failed" && <button className="err panel" style={{ padding: 12, marginBottom: 16, width: "100%", textAlign: "left" }} onClick={() => game.start()}>Connection hiccup: {st.error} · tap to retry</button>}
        <main className="page-stage" data-testid="page-deck">
          {TAB_ORDER.filter(t => t === tab).map(t => <div key={t} data-page-role="current" className="page-screen">
            {t === "trade" && <TradeScreen toast={setToast} goSquad={() => openFloor("trades")} goHistory={() => { setReviewHistory(true); navigate("you"); }} />}
            {t === "squad" && <ClubFloor view={floorView} onView={setFloorView} toast={setToast} />}
            {t === "you" && <YouScreen toast={setToast} onFeedback={() => setFb(true)} />}
          </div>)}
        </main>
      </div>
      {tab !== "squad" && <MiniBar onOpen={() => openFloor("board")} />}
      <nav className="tabs"><div className="tabs-inner">
        {TAB_ORDER.map(t => <button key={t} className={`tab ${tab === t ? "on" : ""}`} aria-current={tab === t ? "page" : undefined} onClick={() => { setReviewHistory(false); navigate(t); }} data-testid={`tab-${t}`} aria-label={t === "squad" && st.chatUnread ? `The floor, ${st.chatUnread} new messages` : undefined}>{Icon[t]}<span>{t === "squad" ? "The floor" : t === "you" ? "You" : "Trade"}</span>{t === "squad" && st.chatUnread > 0 && <i className="club-unread" aria-label={`${st.chatUnread} unread messages`}>{st.chatUnread > 9 ? "9+" : st.chatUnread}</i>}</button>)}
      </div></nav>
      {toast && <div className="toast" role="status" data-testid="toast">{toast}</div>}
      <ChatPop onOpen={() => openFloor("chat")} />
      <FlashOverlay />
      <FeedbackSheet open={fb} onClose={() => setFb(false)} toast={setToast} />
      <BackupCodeSheet />
      <RushHost />
      </div>
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
