import { PlayerLink } from "./Profiles";
import "./squad.css";
import { useEffect, useState } from "react";
import { game, useGame } from "./game";
import { ROOMS, useVoice, voice } from "./voice";
import { Button, Eyebrow, Sheet, countdown, money, signedMoney, useNow } from "./ui";
import { Pit } from "./Trade";
import { ChatCard, GlobalBoard } from "./Social";

export function SquadScreen({ toast }: { toast: (message: string) => void }) {
  const st = useGame();
  const [chatOpen, setChatOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [view, setView] = useState<"squad" | "global">(() => { try { return localStorage.getItem("brokie.board") === "global" ? "global" : "squad"; } catch { return "squad"; } });
  const pick = (v: "squad" | "global") => { setView(v); try { localStorage.setItem("brokie.board", v); } catch { /* ignore */ } };
  const squad = game.squad;
  useEffect(() => {
    if (!squad || chatOpen) return;
    void game.refreshChat();
    const timer = setInterval(() => { if (!document.hidden) void game.refreshChat(); }, 15_000);
    return () => clearInterval(timer);
  }, [squad?.id, chatOpen]);
  return (
    <div className="stack" style={{ gap: 24 }}>
      <div><h1 className="title">{squad ? "Your squad." : "Good friends.\nQuestionable trades."}</h1><div className="muted" style={{ fontSize: 13 }}>Bragging rights are the only payout.</div></div>
      <div className="seg" role="tablist" aria-label="Leaderboard">
        <button role="tab" aria-selected={view === "squad"} className={view === "squad" ? "on" : ""} onClick={() => pick("squad")} data-testid="seg-squad">My squad</button>
        <button role="tab" aria-selected={view === "global"} className={view === "global" ? "on" : ""} onClick={() => pick("global")} data-testid="seg-global">🌍 Global</button>
      </div>
      {view === "global" ? <GlobalBoard /> : st.squads.length === 0 ? <SquadStarter /> : (
        <>
          <div className="hscroll">
            {st.squads.map((s) => <button key={s.id} className={`squad-chip ${s.id === squad?.id ? "on" : ""}`} onClick={() => game.selectSquad(s.id)}>{s.name}</button>)}
            <button className="squad-chip add" onClick={() => setAdding(true)}>+ Squad</button>
          </div>
          {squad && <SquadCard />}
          {squad && <Leaderboard />}
          {squad && <button className="panel row between chat-preview" onClick={() => setChatOpen(true)}><span><b>Squad chat</b><span className="muted">{st.chat[st.chat.length - 1]?.body || "Drop a message to your mates."}</span></span><span className="lime">Open →</span></button>}
          {squad && <VoiceCard />}
          {squad && <Pit full goSquad={() => setChatOpen(true)} toast={toast} />}
          <Sheet open={chatOpen} onClose={() => setChatOpen(false)}><button className="text-action lime" onClick={() => setChatOpen(false)}>Done</button><ChatCard key={st.squadId} /></Sheet>
        </>
      )}
      <Sheet open={adding} onClose={() => setAdding(false)}><SquadStarter onDone={() => setAdding(false)} /></Sheet>
    </div>
  );
}

/** Shares the real invitation for a squad: native share sheet, else clipboard. */
export async function shareInvite(squad: { invite_code: string }): Promise<"shared" | "copied" | "cancelled" | "failed"> {
  const link = `${location.origin}${location.pathname}?join=${squad.invite_code}`;
  const text = `Join my squad on Brokie 📈 Paper-trade Gold, NAS & ES with real prices and fake money. Code: ${squad.invite_code}`;
  if (navigator.share) {
    try { await navigator.share({ title: "Brokie", text, url: link }); return "shared"; }
    catch (e) { if ((e as Error).name === "AbortError") return "cancelled"; /* else fall through to copy */ }
  }
  try { await navigator.clipboard.writeText(`${text}\n${link}`); return "copied"; } catch { return "failed"; }
}

function SquadCard() {
  const squad = game.squad!;
  const [options, setOptions] = useState(false);
  const [copied, setCopied] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  async function invite() {
    const r = await shareInvite(squad);
    if (r === "cancelled") return;
    setNote(r === "failed" ? "Couldn't copy. Send the code above instead." : null);
    if (r === "copied") { setCopied(true); setTimeout(() => setCopied(false), 2000); }
  }
  return (
    <div className="squad-summary">
      <div className="row between"><div><h2 className="h2" data-testid="squad-title">{squad.name}</h2><span className="muted">{squad.member_count} players</span></div><button className="text-action lime" onClick={() => setOptions(true)}>Invite / manage ↗</button></div>
      <Sheet open={options} onClose={() => setOptions(false)}>
        <div className="stack"><div className="row between"><h3 className="h3">{squad.name}</h3><button className="text-action" onClick={() => setOptions(false)}>Done</button></div>
        <div><Eyebrow>Invite code</Eyebrow><div className="code" data-testid="invite-code">{squad.invite_code}</div></div>
        <Button onClick={invite}>{copied ? "Copied ✓" : "Invite friends ↗"}</Button>
        {note && <div className="err" role="status">{note}</div>}
        <button className="text-action red" onClick={() => { setOptions(false); setConfirm(true); }}>Leave squad</button></div>
      </Sheet>
      <Sheet open={confirm} onClose={() => setConfirm(false)}>
        <div className="stack" style={{ gap: 16 }}>
          <h3 className="h3">Leave {squad.name}?</h3><div className="muted" style={{ fontSize: 13 }}>You can rejoin any time with the invite code.</div>
          <Button variant="short" onClick={async () => { setConfirm(false); await game.leaveSquad(squad.id); }}>Leave squad</Button>
          <Button variant="ghost" onClick={() => setConfirm(false)}>Stay</Button>
        </div>
      </Sheet>
    </div>
  );
}

export function SquadStarter({ onDone }: { onDone?: () => void }) {
  const [name, setName] = useState("");
  const [code, setCode] = useState(() => new URLSearchParams(location.search).get("join")?.toUpperCase().slice(0, 6) ?? "");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  async function run(kind: string, work: () => Promise<void>) {
    setBusy(kind); setErr(null);
    try { await work(); onDone?.(); if (kind === "join") history.replaceState(null, "", location.pathname); } catch (e) { setErr((e as Error).message); }
    setBusy(null);
  }
  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="panel stack" style={{ gap: 14 }}>
        <Eyebrow>Got a code?</Eyebrow><h3 className="h3">Join your mates.</h3>
        <input className="field code" placeholder="ABC123" value={code} maxLength={6} data-testid="join-code"
          onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6))} />
        <Button busy={busy === "join"} disabled={code.length !== 6} onClick={() => run("join", () => game.joinSquad(code))} id="join-squad">Join squad</Button>
      </div>
      <div className="panel stack" style={{ gap: 14 }}>
        <Eyebrow>Start a squad</Eyebrow><h3 className="h3">Name the group chat.</h3>
        <input className="field" placeholder="The rent money club" value={name} maxLength={32} onChange={(e) => setName(e.target.value)} data-testid="new-squad-name" />
        <Button busy={busy === "create"} disabled={!name.trim()} onClick={() => run("create", () => game.createSquad(name.trim()))} id="create-squad">Create squad</Button>
      </div>
      {err && <div className="err" data-testid="squad-error">{err}</div>}
    </div>
  );
}

function VoiceCard() {
  const [moreRooms, setMoreRooms] = useState(false);
  const v = useVoice();
  const joined = v.status === "live" || v.status === "connecting";
  const status = v.status === "connecting" ? "Connecting…" : v.deafened ? "Deafened · mic muted" : voice.micOn ? "Mic on" : "Mic muted";
  return (
    <div className="panel stack" style={{ gap: 16, border: joined ? "1px solid rgba(214,254,89,.35)" : undefined }}>
      <Eyebrow>Voice</Eyebrow>
      {!joined ? (
        <>
          <div className="muted" style={{ fontSize: 12 }}>Join the call. Your mic starts muted.</div>
          {(moreRooms ? ROOMS : ROOMS.slice(0, 1)).map((r) => (
            <button key={r.id} className="row" style={{ background: "var(--bg)", borderRadius: 13, padding: 12, textAlign: "left" }} onClick={() => voice.join(r.id)} data-testid={`voice-join-${r.id}`}>
              <span className="badge-sq" style={{ background: "rgba(214,254,89,.1)", color: "var(--lime)" }}>🎙</span>
              <div style={{ flex: 1 }}><b style={{ fontSize: 13 }}>{r.title}</b><div className="muted" style={{ fontSize: 11 }}>{r.subtitle}</div></div>
              <span className="mono lime" style={{ fontSize: 9, fontWeight: 800 }}>JOIN</span>
            </button>
          ))}
          <button className="text-action muted" onClick={() => setMoreRooms(!moreRooms)} aria-expanded={moreRooms}>{moreRooms ? "Fewer rooms" : "More voice rooms"}</button>
        </>
      ) : (
        <>
          <div><h3 className="h3">{ROOMS.find((r) => r.id === v.room)?.title}</h3>
            <div className="row muted" style={{ fontSize: 11, marginTop: 4, gap: 6 }}><span className="dot" style={{ width: 6, height: 6, ["--c" as string]: voice.micOn ? "var(--lime)" : "var(--muted)" }} />{status}</div></div>
          <div className="hscroll" style={{ gap: 14 }}>
            {v.people.map((p) => (
              <div className="bubble" key={p.id}>
                <span className={`av ${p.you ? "you" : ""} ${p.speaking ? "speaking" : ""}`}>{p.name[0]?.toUpperCase()}{p.muted && <span className="mic-off">🔇</span>}</span>
                <span style={{ maxWidth: 62, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</span>
              </div>
            ))}
            {v.people.length === 1 && <div className="muted" style={{ fontSize: 11, alignSelf: "center" }}>Waiting for your mates…</div>}
          </div>
          <div className="chips">
            <button className={`chip lime ${!v.ptt ? "on" : ""}`} style={{ flex: 1, height: 32 }} onClick={() => voice.setPTT(false)}>Open mic</button>
            <button className={`chip lime ${v.ptt ? "on" : ""}`} style={{ flex: 1, height: 32 }} onClick={() => voice.setPTT(true)}>Push to talk</button>
          </div>
          {v.ptt && (
            <button className={`ptt ${v.holding ? "on" : ""}`} onPointerDown={() => voice.hold(true)} onPointerUp={() => voice.hold(false)} onPointerLeave={() => voice.hold(false)} onPointerCancel={() => voice.hold(false)} onContextMenu={(e) => e.preventDefault()}>
              {v.deafened ? "Undeafen to talk" : v.holding ? "Talking…" : "Hold to talk"}
            </button>
          )}
          <div className="voice-ctrls">
            {!v.ptt && <button className={!v.muted ? "on" : ""} onClick={() => voice.toggleMute()} disabled={v.deafened}>{v.muted ? "🔇" : "🎙"}<span>{v.muted ? "Unmute" : "Mute"}</span></button>}
            <button className={v.deafened ? "on" : ""} onClick={() => voice.toggleDeafen()}>{v.deafened ? "🔕" : "🔊"}<span>{v.deafened ? "Undeafen" : "Deafen"}</span></button>
            <button className="leave" onClick={() => voice.leave()}>📞<span>Leave</span></button>
          </div>
        </>
      )}
      {v.error && <div className="err">{v.error}</div>}
    </div>
  );
}

function Leaderboard() {
  const st = useGame();
  const now = useNow(30_000);
  return (
    <div>
      <div className="row between" style={{ marginBottom: 12 }}><h2 className="h2">Season {st.me?.season_number ?? ""}</h2>
        <span className="eyebrow" style={{ fontSize: 8 }}>Ends in {countdown(st.me?.season_ends_at, now + st.clockOffset)}</span></div>
      {st.leaderboard.length === 0 && <div style={{ textAlign: "center", padding: 30 }}><span className="spinner lime" /></div>}
      {st.leaderboard.map((r, i) => (
        <div key={r.handle}>
          <div className={`lb-row ${r.is_you ? "you" : ""}`} data-testid="leader-row" style={{ filter: r.status === "blown" ? "grayscale(.8)" : undefined }}>
            <span className="mono muted" style={{ width: 22, fontSize: 12, fontWeight: 600 }}>{i === 0 && r.return_pct > 0 ? "👑" : String(i + 1).padStart(2, "0")}</span>
            <span className={`av ${r.is_you ? "you" : ""}`}>{r.handle[0].toUpperCase()}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}><PlayerLink handle={r.handle} /> {r.open_positions > 0 && <span className="dot" style={{ width: 5, height: 5, verticalAlign: "middle" }} />}
                {r.status === "blown" && <span className="chip-status" style={{ background: "#333", color: "#ccc" }} data-testid="rekt-chip">💀 REKT</span>}
                {r.status === "locked" && <span className="chip-status" style={{ background: "rgba(255,125,139,.12)", color: "var(--red)" }}>🔒 LOCKED</span>}
                {r.funded && <span className="chip-status" style={{ background: "rgba(242,202,115,.15)", color: "var(--gold)" }}>🏆 TARGET HIT</span>}
                {(r.resets_used ?? 0) > 0 && r.status !== "blown" && <span className="chip-status" style={{ background: "var(--line)", color: "var(--muted)" }}>BUY-BACK</span>}</div>
              <div className="muted" style={{ fontSize: 10, marginTop: 3 }}>{r.qualified === false ? `Qualifying · ${r.trading_days ?? 0}/5 days · ` : ""}{r.trades === 0 ? (r.open_positions > 0 ? "In a trade" : "No trades yet") : `${r.trades} ${r.trades === 1 ? "trade" : "trades"} · lowest trade ${signedMoney(r.worst_trade)}`}</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div className={`mono ${r.return_pct >= 0 ? "lime" : "red"}`} style={{ fontSize: 14, fontWeight: 600 }}>{r.return_pct >= 0 ? "+" : ""}{r.return_pct.toFixed(2)}%</div>
              <div className="mono muted" style={{ fontSize: 9 }}>{money(r.equity, 0)}</div>
            </div>
          </div>
          {i < st.leaderboard.length - 1 && <div className="sep" />}
        </div>
      ))}
      <div className="muted" style={{ fontSize: 10, marginTop: 12 }}>Qualified players rank first; other ranks are provisional until 5 trading days. The +10% target earns a game badge, not funding or cash. See Trade for your current risk limits.</div>
    </div>
  );
}
