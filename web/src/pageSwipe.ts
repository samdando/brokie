import { useEffect, useRef } from "react";

/** Set by anything that owns the current finger (e.g. the chart once a hold-to-trade is armed),
 *  so a sideways slide doesn't also flip the page. */
export const swipeGuard = { owned: false };

/** Where a page swipe must never start: text entry, sliders, side-scrolling rails and open sheets. */
const BLOCK = "input, textarea, select, [role='slider'], .hscroll, .selection-wheel, .sheet, .no-page-swipe, .quantity-selector, .spam-btn, .bracket, .tc, .trade-dock, .pos-card, .tm, .bub, .cluster";

interface Gesture { x: number; y: number; at: number; locked: boolean; width: number; dx: number; id: number }
export interface SwipeHandlers {
  /** Live drag in px (positive = finger moving right), or null when the gesture ends/cancels. */
  onDrag: (dx: number | null, width: number) => void;
  /** Called on a committed swipe: -1 = previous page, +1 = next page. */
  onCommit: (step: 1 | -1, dx: number) => void;
}

/** Snapchat-style page swipes. Touch uses native listeners (iOS needs a non-passive touchmove to
 *  stop the page scrolling once the gesture is clearly sideways); mouse/pen use pointer events. */
export function usePageSwipe(el: HTMLElement | null, handlers: SwipeHandlers) {
  const h = useRef(handlers); h.current = handlers;
  const g = useRef<Gesture | null>(null);
  const swallow = useRef(false);
  useEffect(() => {
    if (!el) return;
    const begin = (x: number, y: number, target: EventTarget | null, id: number) => {
      swallow.current = false;
      const t = target as HTMLElement | null;
      if (!t || t.closest(BLOCK) || document.querySelector(".sheet, .chart-fullscreen")) { g.current = null; return; }
      g.current = { x, y, at: performance.now(), locked: false, width: el.clientWidth || innerWidth, dx: 0, id };
    };
    /** Returns true while the gesture is a page swipe (caller then prevents scrolling). */
    const move = (x: number, y: number) => {
      const s = g.current; if (!s) return false;
      if (swipeGuard.owned) { cancel(); return false; }
      const dx = x - s.x, dy = y - s.y;
      if (!s.locked) {
        if (Math.hypot(dx, dy) < 10) return false;
        if (Math.abs(dx) < Math.abs(dy) * 1.2) { g.current = null; return false; }
        s.locked = true; swallow.current = true;
      }
      s.dx = dx; h.current.onDrag(dx, s.width);
      return true;
    };
    const end = () => {
      const s = g.current; g.current = null; if (!s) return;
      if (!s.locked) return;
      const v = Math.abs(s.dx) / Math.max(1, performance.now() - s.at);
      if (Math.abs(s.dx) > Math.min(90, s.width * .22) || (Math.abs(s.dx) > 30 && v > .45)) h.current.onCommit(s.dx < 0 ? 1 : -1, s.dx);
      h.current.onDrag(null, s.width);
    };
    const cancel = () => { const s = g.current; g.current = null; if (s?.locked) h.current.onDrag(null, s.width); };

    const ts = (e: TouchEvent) => { if (e.touches.length !== 1) { cancel(); return; } const t = e.touches[0]; begin(t.clientX, t.clientY, e.target, t.identifier); };
    const tm = (e: TouchEvent) => { const s = g.current; if (!s) return; const t = Array.from(e.touches).find(t => t.identifier === s.id); if (!t || e.touches.length > 1) { cancel(); return; } if (move(t.clientX, t.clientY) && e.cancelable) e.preventDefault(); };
    const te = () => end();
    const pd = (e: PointerEvent) => { if (e.pointerType === "touch" || !e.isPrimary || e.button !== 0) return; begin(e.clientX, e.clientY, e.target, e.pointerId); };
    const pm = (e: PointerEvent) => { if (e.pointerType === "touch" || g.current?.id !== e.pointerId) return; if (move(e.clientX, e.clientY)) e.preventDefault(); };
    const pu = (e: PointerEvent) => { if (e.pointerType === "touch" || g.current?.id !== e.pointerId) return; end(); };
    const click = (e: MouseEvent) => { if (swallow.current) { swallow.current = false; e.preventDefault(); e.stopPropagation(); } };
    el.addEventListener("touchstart", ts, { passive: true });
    el.addEventListener("touchmove", tm, { passive: false });
    el.addEventListener("touchend", te); el.addEventListener("touchcancel", cancel);
    el.addEventListener("pointerdown", pd); window.addEventListener("pointermove", pm); window.addEventListener("pointerup", pu); window.addEventListener("pointercancel", cancel);
    el.addEventListener("click", click, true);
    window.addEventListener("blur", cancel); document.addEventListener("visibilitychange", cancel);
    return () => {
      el.removeEventListener("touchstart", ts); el.removeEventListener("touchmove", tm); el.removeEventListener("touchend", te); el.removeEventListener("touchcancel", cancel);
      el.removeEventListener("pointerdown", pd); window.removeEventListener("pointermove", pm); window.removeEventListener("pointerup", pu); window.removeEventListener("pointercancel", cancel);
      el.removeEventListener("click", click, true);
      window.removeEventListener("blur", cancel); document.removeEventListener("visibilitychange", cancel);
    };
  }, [el]);
}
