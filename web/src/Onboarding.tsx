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
    <div className="onboard welcome-screen">
      <div className="wordmark" style={{ fontSize: 44, letterSpacing: -2.4 }}>brokie<i style={{ width: 11, height: 11 }} /></div>
      <div className="welcome-art" aria-hidden="true"><svg viewBox="0 0 320 115" fill="none"><path d="M0 89h320M0 49h320" stroke="currentColor" strokeOpacity=".15"/><path d="m0 96 23-9 19 5 20-29 22 10 20-25 21 7 20-21 23 9 17-22 21 9 22-17 22 6 22-13 22 3 26-5" stroke="currentColor" strokeWidth="1.5"/><circle cx="126" cy="54" r="15" fill="#172B27" stroke="currentColor" strokeOpacity=".6"/><path d="m121 56 5-5 5 5m-5-5v9" stroke="currentColor"/><circle cx="229" cy="14" r="13" fill="#2A202C" stroke="#D7A3AC" strokeOpacity=".6"/><path d="m225 12 4 4 4-4m-4-4v8" stroke="#D7A3AC"/></svg><span>Good trades. Better company.</span></div>
      <h1>Take a position.<br />Bring your mates.</h1>
      <p className="welcome-intro">Real markets. A pretend $100k.<br />Your group chat, with a trading floor.</p>
      <div className="welcome-facts">
        <span>Gold · Nasdaq · S&amp;P · Dow</span><span>8-week prop challenge</span>
      </div>
      <div style={{ flex: 1, minHeight: 28 }} />
      <Eyebrow>Pick your handle</Eyebrow>
      <div className="row" style={{ marginTop: 10, gap: 0, background: "var(--bg)", border: "1px solid var(--line)", borderRadius: 13, paddingLeft: 16 }}>
        <span className="muted" style={{ fontSize: 17 }}>@</span>
        <input className="field" style={{ border: 0, paddingLeft: 2 }} placeholder="yourhandle" aria-label="Your handle" value={handle} maxLength={18} autoCapitalize="none" autoCorrect="off"
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
        <input className="field" placeholder="handle" value={handle} autoCapitalize="none" onChange={(e) => setHandle(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 18))} data-testid="restore-handle" autoCorrect="off" spellCheck={false} inputMode="text" />
        <input className="field code" style={{ fontSize: 18, letterSpacing: 1 }} placeholder="BRK-XXXX-XXXX-XXXX" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} data-testid="restore-code" autoCapitalize="characters" autoCorrect="off" spellCheck={false} />
        <div className="muted" style={{ fontSize: 11 }}>Type your handle without the @. The code is the BRK-… one from You → Backup code. Spaces and dashes don't matter.</div>
        {err && <div className="err" data-testid="restore-error">{err}</div>}
        <Button busy={busy} disabled={handle.length < 3 || code.replace(/[^A-Z0-9]/g, "").length < 6} id="restore-go" onClick={async () => {
          setBusy(true); setErr(null);
          try { await game.restore(handle, code); onClose(); } catch (e) { setErr((e as Error).message); }
          setBusy(false);
        }}>Restore account</Button>
      </div>
    </Sheet>
  );
}
