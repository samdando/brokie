import { useEffect, useMemo, useRef, useState } from "react";
import { game } from "./game";
import { sessionCountdown, sessionEvents, type SessionEvent } from "./sessions";
import type { Market } from "./types";
import { useNow } from "./ui";
export function SessionClock({ market }: { market: Market }) {
  const now = useNow(1000) + game.state.clockOffset;
  const events = useMemo(() => sessionEvents(now, market), [Math.floor(now / 1000), market]);
  const prev = useRef<SessionEvent[]>([]), seen = useRef(new Set<string>());
  const [alert, setAlert] = useState<SessionEvent | null>(null);
  useEffect(() => {
    const crossed = prev.current.filter(e => now >= e.at && now - e.at < 10000);
    const imminent = events.filter(e => e.at - now <= 60000);
    const event = [...crossed, ...imminent].find(e => !seen.current.has(`${e.id}:${e.at}:${now >= e.at ? "now" : "soon"}`));
    if (event) { seen.current.add(`${event.id}:${event.at}:${now >= event.at ? "now" : "soon"}`); setAlert(event); }
    prev.current = events;
  }, [now, events]);
  useEffect(() => { if (!alert) return; const t = setTimeout(() => setAlert(null), 6500); return () => clearTimeout(t); }, [alert]);
  const close = events[0], next = events.slice(1).sort((a, b) => a.at - b.at)[0];
  const cell = (e: SessionEvent) => <span className={e.at - now <= 60000 ? "session-urgent" : ""}><small>{e.label} in</small><b>{sessionCountdown(e.at - now)}</b></span>;
  return <section className="session-clock" data-testid="session-clock" aria-label="Market and session countdowns">
    <div className="session-primary">{cell(close)}{cell(next)}</div>
    <details><summary>Session countdowns</summary><div className="session-grid">{events.slice(1).map(e => <div key={e.id}>{cell(e)}</div>)}</div><p>Regular liquidity sessions, adjusted for daylight saving. Holidays and feed interruptions may change availability. Countdown uses Brokie’s session rules.</p></details>
    {alert && <div key={`${alert.id}:${alert.at}`} className={`session-alert ${alert.kind}`} role="status" data-testid="session-alert"><i aria-hidden="true"/><span aria-hidden="true">{alert.kind === "close" ? "◷" : "↗"}</span><div><small>THE FLOOR IS MOVING</small><b>{alert.label}{now < alert.at ? " in " + sessionCountdown(alert.at - now) : " · now"}</b></div><button aria-label="Dismiss session alert" onClick={() => setAlert(null)}>✕</button></div>}
  </section>;
}
