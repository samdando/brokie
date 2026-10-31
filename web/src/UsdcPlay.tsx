import { useState } from "react";
import { game } from "./game";

const KEY = "brokie.usdc1";

/** "1 USDC play" lives quietly on the You page until the Season 2 test.
 *  Nothing here moves money or connects a wallet: Brokie stays paper.
 *  Opting in records interest locally and drops a note in feedback so Sam knows who's testing. */
export function UsdcPlay() {
  const [on, setOn] = useState(() => { try { return localStorage.getItem(KEY) === "in"; } catch { return false; } });
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  async function toggle() {
    const next = !on;
    setBusy(true); setNote(null);
    const err = await game.submitFeedback("idea", next ? "1 USDC play: count me in for the Season 2 test" : "1 USDC play: opted out of the Season 2 test");
    setBusy(false);
    if (err) { setNote("Couldn't save that. Try again in a moment."); return; }
    setOn(next);
    try { localStorage.setItem(KEY, next ? "in" : "out"); } catch { /* ignore */ }
  }
  return (
    <details className="quiet-disclosure usdc-play" data-testid="usdc-play">
      <summary><span>1 USDC play</span><small>{on ? "You're on the test list" : "Season 2 test"} <span aria-hidden="true">⌄</span></small></summary>
      <div className="stack" style={{ gap: 12 }}>
        <p className="muted" style={{ fontSize: 12, margin: 0 }}>A 1 USDC buy-in mode, whenever you want it, alongside the free paper season. It's being tested before Season 2. Right now nothing is charged and no wallet is connected: every trade is still paper.</p>
        <div className="row between" style={{ gap: 12 }}>
          <b style={{ fontSize: 13 }}>Count me in for the test</b>
          <button className={`switch ${on ? "on" : ""}`} role="switch" aria-checked={on} aria-label="Count me in for the 1 USDC test" data-testid="usdc-optin" disabled={busy} onClick={toggle}><i /></button>
        </div>
        {note && <div className="err" role="status">{note}</div>}
      </div>
    </details>
  );
}
