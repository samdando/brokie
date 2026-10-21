import { useState } from "react";
import { game } from "./game";
import { Button, Eyebrow, Sheet } from "./ui";

export function Onboarding() {
  const [handle, setHandle] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [restore, setRestore] = useState(false);
  async function go() {
    if (handle.length < 3 || busy) return;
    setBusy(true); setErr(null);
    try { await game.claimHandle(handle); } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  }
  return (
    <div className="onboard">
      <div className="wordmark" style={{ fontSize: 44, letterSpacing: -2.4 }}>brokie<i style={{ width: 11, height: 11 }} /></div>
      <h1 style={{ font: "600 30px/1.1 var(--round)", letterSpacing: -1, margin: "28px 0 0" }}>All the market.<br />None of the rent money.</h1>
      <div className="stack" style={{ gap: 12, marginTop: 26 }}>
        <div className="point"><i>📈</i>Real Gold, NAS and ES prices. Fake $10k.</div>
        <div className="point"><i>🏆</i>Fresh stack every Monday. Squad leaderboard.</div>
        <div className="point"><i>🎙</i>Talk trades live with your mates.</div>
      </div>
      <div style={{ flex: 1, minHeight: 40 }} />
      <Eyebrow>Pick your handle</Eyebrow>
      <div className="row" style={{ marginTop: 10, gap: 0, background: "var(--bg)", border: "1px solid var(--line)", borderRadius: 13, paddingLeft: 16 }}>
        <span className="muted" style={{ fontSize: 17 }}>@</span>
        <input className="field" style={{ border: 0, paddingLeft: 2 }} placeholder="chartgremlin" value={handle} maxLength={18} autoCapitalize="none" autoCorrect="off" autoFocus
          onChange={(e) => setHandle(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))} onKeyDown={(e) => e.key === "Enter" && go()} data-testid="onboarding-handle" />
      </div>
      {err ? <div className="err" style={{ marginTop: 8 }} data-testid="onboarding-error">{err}</div> : <div className="muted" style={{ fontSize: 11, marginTop: 8 }}>3–18 letters, numbers or _. No email, no password.</div>}
      <div style={{ marginTop: 16 }}><Button busy={busy} disabled={handle.length < 3} onClick={go} id="onboarding-go">Let's go</Button></div>
      <button className="muted" style={{ fontSize: 12, marginTop: 14 }} onClick={() => setRestore(true)} data-testid="onboarding-restore">New phone? <b>Restore with a backup code</b></button>
      <RestoreSheet open={restore} onClose={() => setRestore(false)} />
    </div>
  );
}

function RestoreSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [handle, setHandle] = useState("");
  const [code, setCode] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Sheet open={open} onClose={onClose}>
      <div className="stack" style={{ gap: 16 }}>
        <Eyebrow>Restore your account</Eyebrow>
        <h3 className="h3" style={{ fontSize: 28 }}>Welcome back.</h3>
        <div className="muted" style={{ fontSize: 13 }}>Enter your handle and the backup code you saved. Your stack, trades and squads come with you.</div>
        <input className="field" placeholder="handle" value={handle} autoCapitalize="none" onChange={(e) => setHandle(e.target.value.toLowerCase())} data-testid="restore-handle" />
        <input className="field code" style={{ fontSize: 18, letterSpacing: 1 }} placeholder="BRK-XXXX-XXXX-XXXX" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} data-testid="restore-code" />
        {err && <div className="err" data-testid="restore-error">{err}</div>}
        <Button busy={busy} disabled={handle.length < 3 || code.replace(/[^A-Z0-9]/g, "").length < 15} id="restore-go" onClick={async () => {
          setBusy(true); setErr(null);
          try { await game.restore(handle, code); onClose(); } catch (e) { setErr((e as Error).message); }
          setBusy(false);
        }}>Restore account</Button>
      </div>
    </Sheet>
  );
}
