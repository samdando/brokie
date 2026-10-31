import { useEffect, useRef } from "react";

/** Set by anything that owns the current finger (e.g. the chart once a hold-to-trade is armed),
 *  so a sideways slide doesn't also flip the page. */
export const swipeGuard = { owned: false };

/** Where a page swipe must never start: text entry, sliders, side-scrolling rails and open sheets. */
const BLOCK = "input, textarea, select, [role='slider'], .hscroll, .selection-wheel, .sheet, .no-page-swipe, .quantity-selector, .focus-size, .cash-out, .spam-btn, .bracket, .tc, .trade-dock, .pos-card, .tm, .bub, .cluster";
const SETTLE_MS = 240;
const EASE = "cubic-bezier(.2,.8,.2,1)";

interface Gesture { x: number; y: number; at: number; locked: boolean; width: number; dx: number; id: number; step: 1 | -1 | 0; lastX: number; lastAt: number; vx: number }
export interface SwipeHandlers {
  /** Is there a page in that direction? */
  canGo: (step: 1 | -1) => boolean;
  /** Mount (or unmount with 0) the neighbouring page so it can slide in. */
  onPeek: (step: 1 | -1 | 0) => void;
  /** The swipe landed: switch pages without any extra animation. */
  onCommit: (step: 1 | -1) => void;
}

/** Snapchat-style page swipes. The pages follow the finger 1:1 with GPU transforms written straight
 *  to the DOM (no React re-render per frame), then settle with a short eased slide.
 *  Touch uses native listeners (iOS needs a non-passive touchmove); mouse/pen use pointer events. */
export function usePageSwipe(el: HTMLElement | null, handlers: SwipeHandlers) {
  const h = useRef(handlers); h.current = handlers;
  const g = useRef<Gesture | null>(null);
  const swallow = useRef(false);
  const settling = useRef(false);
  useEffect(() => {
    if (!el) return;
    const pages = () => ({
      cur: el.querySelector<HTMLElement>('[data-page-role="current"]'),
      peek: el.querySelector<HTMLElement>('[data-page-role="peek"]'),
    });
    const place = (node: HTMLElement | null, x: number, animate: boolean) => {
      if (!node) return;
      node.style.transition = animate ? `transform ${SETTLE_MS}ms ${EASE}` : "none";
      node.style.transform = `translate3d(${x}px,0,0)`;
    };
    const clear = (node: HTMLElement | null) => { if (node) { node.style.transition = ""; node.style.transform = ""; } };

    const begin = (x: number, y: number, target: EventTarget | null, id: number) => {
      swallow.current = false;
      const t = target as HTMLElement | null;
      if (settling.current || !t || t.closest(BLOCK) || document.querySelector(".sheet, .chart-fullscreen")) { g.current = null; return; }
      g.current = { x, y, at: performance.now(), locked: false, width: el.clientWidth || innerWidth, dx: 0, id, step: 0, lastX: x, lastAt: performance.now(), vx: 0 };
    };
    /** Returns true while the gesture is a page swipe (caller then prevents scrolling). */
    const move = (x: number, y: number) => {
      const s = g.current; if (!s) return false;
      if (swipeGuard.owned) { cancel(); return false; }
      const dx = x - s.x, dy = y - s.y;
      if (!s.locked) {
        if (Math.hypot(dx, dy) < 10) return false;
        if (Math.abs(dx) < Math.abs(dy) * 1.2) { g.current = null; return false; }
        s.locked = true; swallow.current = true; el.classList.add("dragging");
      }
      const now = performance.now();
      s.vx = (x - s.lastX) / Math.max(1, now - s.lastAt) * .6 + s.vx * .4; s.lastX = x; s.lastAt = now;
      s.dx = dx;
      const step: 1 | -1 = dx < 0 ? 1 : -1;
      const can = h.current.canGo(step);
      if (step !== s.step) { s.step = step; h.current.onPeek(can ? step : 0); }
      const shift = can ? Math.max(-s.width, Math.min(s.width, dx)) : dx * .18;   // rubber band at the ends
      const { cur, peek } = pages();
      place(cur, shift, false);
      if (can) place(peek, shift + step * s.width, false);
      return true;
    };
    const end = () => {
      const s = g.current; g.current = null; if (!s || !s.locked) return;
      const step: 1 | -1 = s.dx < 0 ? 1 : -1;
      const can = h.current.canGo(step);
      const flick = Math.abs(s.vx) > .35 && Math.sign(s.vx) === Math.sign(s.dx);
      const go = can && (Math.abs(s.dx) > s.width * .3 || (flick && Math.abs(s.dx) > 24));
      const { cur, peek } = pages();
      settling.current = true;
      if (go) { place(cur, -step * s.width, true); place(peek, 0, true); }
      else { place(cur, 0, true); if (peek) place(peek, step * s.width, true); }
      setTimeout(() => {
        settling.current = false; el.classList.remove("dragging");
        if (go) h.current.onCommit(step); else h.current.onPeek(0);
        // Let React swap roles first, then drop the inline transforms.
        requestAnimationFrame(() => { el.querySelectorAll<HTMLElement>(".page-screen").forEach(clear); });
      }, SETTLE_MS);
    };
    const cancel = () => {
      const s = g.current; g.current = null; if (!s?.locked) return;
      const { cur, peek } = pages();
      place(cur, 0, true); if (peek && s.step) place(peek, s.step * s.width, true);
      settling.current = true;
      setTimeout(() => { settling.current = false; el.classList.remove("dragging"); h.current.onPeek(0); el.querySelectorAll<HTMLElement>(".page-screen").forEach(clear); }, SETTLE_MS);
    };

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
