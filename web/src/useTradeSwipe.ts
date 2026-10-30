import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

/** The lower preview is a close surface. Fullscreen keeps chart gestures intact. */
export function useTradeSwipe({ enabled, fullscreen, revision, onCommit }: { enabled: boolean; fullscreen: boolean; revision: string; onCommit: () => void }) {
  const [distance, setDistance] = useState(0);
  const active = useRef<(() => void) | null>(null);
  const swallowClick = useRef(false);
  const latest = useRef(onCommit); latest.current = onCommit;
  useEffect(() => () => active.current?.(), []);
  useEffect(() => { active.current?.(); }, [enabled, fullscreen, revision]);
  function down(e: ReactPointerEvent<HTMLDivElement>) {
    swallowClick.current = false;
    if (active.current) { active.current(); return; }
    if (!enabled || e.button !== 0 || !e.isPrimary) return;
    const target = e.target as HTMLElement, status = target.closest(".trade-dock .dock-status");
    if (target.closest(".sheet,.scrim,.execution-options,.spam-pad,.bracket,.tc,[data-testid='bracket-grip'],input,textarea,a,select")) return;
    if (target.closest("button") && !status) return;
    if (fullscreen ? !status : !status && e.clientY < window.innerHeight / 2) return;
    const root = e.currentTarget, id = e.pointerId, startX = e.clientX, startY = e.clientY;
    const threshold = Math.min(145, root.clientWidth * .38);
    let x = 0, locked: boolean | null = null, armed = false;
    const commit = latest.current;
    const cleanup = () => {
      window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel); window.removeEventListener("pointerdown", other);
      window.removeEventListener("blur", cancel); document.removeEventListener("visibilitychange", cancel);
      if (root.hasPointerCapture(id)) root.releasePointerCapture(id);
      active.current = null; setDistance(0);
    };
    const swallow = () => { swallowClick.current = true; };
    const cancel = () => { if (locked) swallow(); cleanup(); };
    const other = (ev: PointerEvent) => { if (ev.pointerId !== id) cancel(); };
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== id) return;
      const dx = ev.clientX - startX, dy = ev.clientY - startY;
      if (locked === null && Math.hypot(dx, dy) > 10) {
        locked = dx > Math.abs(dy) * 1.5;
        if (!locked) { cleanup(); return; }
        root.setPointerCapture(id);
      }
      if (!locked) return;
      ev.preventDefault(); x = Math.max(0, dx); armed = x >= threshold;
      setDistance(Math.min(1, x / threshold));
    };
    const up = (ev: PointerEvent) => {
      if (ev.pointerId !== id) return;
      const shouldCommit = locked && armed;
      if (locked) swallow();
      cleanup(); if (shouldCommit) commit();
    };
    active.current = cancel;
    window.addEventListener("pointermove", move, { passive: false }); window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel); window.addEventListener("pointerdown", other);
    window.addEventListener("blur", cancel); document.addEventListener("visibilitychange", cancel);
  }
  return { distance, onPointerDownCapture: down, onClickCapture: (e: React.MouseEvent) => { if (swallowClick.current) { swallowClick.current = false; e.preventDefault(); e.stopPropagation(); } } };
}
