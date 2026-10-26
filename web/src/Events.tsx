import { useEffect } from "react";
import { game, useGame } from "./game";
import { MARKETS } from "./types";
import type { EventItem } from "./types";
import { useNow } from "./ui";

const impactTone = (e: EventItem) => (e.kind === "session" ? "lime" : e.impact === "high" ? "red" : e.impact === "med" ? "gold" : "lime");

function until(iso: string, now: number) {
  const s = Math.max(0, Math.round((Date.parse(iso) - now) / 1000));
  const m = Math.floor(s / 60);
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : m > 0 ? `${m}m ${String(s % 60).padStart(2, "0")}s` : `${s}s`;
}

/** Live + countdown events (CPI, FOMC, session opens). Sits under the header. */
export function EventStrip({ compact = false }: { compact?: boolean }) {
  const st = useGame();
  const now = useNow(1000) + st.clockOffset;
  const items = st.events?.active ?? [];
  if (items.length === 0) return null;
  return (
    <div className={`event-strip ${compact ? "compact-events" : ""}`} data-testid="event-strip">
      {items.map((e) => {
        const live = (e.phase ?? "live") === "live" || Date.parse(e.at) <= now;
        return (
          <div key={e.id} className={`event ${impactTone(e)} ${live ? "live" : "soon"}`} data-testid="event">
            <span className="pulse" aria-hidden="true" />
            <div style={{ flex: 1, minWidth: 0 }}>
              <b>{e.title}{e.market ? ` · ${MARKETS[e.market].title}` : ""}</b>
              <div className="sub">{live ? (e.kind === "session" ? "Open now" : "LIVE · expect big moves") : `in ${until(e.at, now)}`}{e.body ? ` · ${e.body}` : ""}</div>
            </div>
            {e.impact === "high" && e.kind !== "session" && <span className="tag">HIGH IMPACT</span>}
          </div>
        );
      })}
    </div>
  );
}

/** Full-screen colour flash + banner when an event lands. Never blocks taps. */
export function FlashOverlay() {
  const st = useGame();
  const f = st.flash;
  useEffect(() => {
    if (!f) return;
    const t = setTimeout(() => game.dismissFlash(), 6000);
    return () => clearTimeout(t);
  }, [f?.key]);
  if (!f) return null;
  return (
    <>
      <div key={f.key} className={`flash ${f.tone}`} aria-hidden="true" data-testid="flash" />
      <button key={f.key + "b"} className={`flash-banner ${f.tone}`} onClick={() => game.dismissFlash()} role="alert" data-testid="flash-banner">
        <b>{f.title}</b><span>{f.sub}</span>
      </button>
    </>
  );
}
