import { useLayoutEffect, useRef, useState } from "react";
/** Shared TradingView-style tape: swipe to browse, tap or use arrows to select. */
export function SelectionRail({ label, value, options, onChange, disabled = false, testId, itemPrefix }: {
  label: string; value: number; options: { value: number; label: string }[]; onChange: (value: number) => void; disabled?: boolean; testId: string; itemPrefix: string;
}) {
  const rail = useRef<HTMLDivElement>(null), buttons = useRef(new Map<number, HTMLButtonElement>());
  const [indicator, setIndicator] = useState({ left: 0, width: 0 });
  const drag = useRef<{ x: number; scroll: number; moved: boolean } | null>(null);
  const values = options.map(o => o.value).join(",");
  useLayoutEffect(() => {
    const el = rail.current, selected = buttons.current.get(value);
    if (!el || !selected) return;
    const update = () => { setIndicator({ left: selected.offsetLeft, width: selected.offsetWidth }); };
    update();
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollTo({ left: selected.offsetLeft - (el.clientWidth - selected.offsetWidth) / 2, behavior: reduce ? "auto" : "smooth" });
    const ro = new ResizeObserver(update); ro.observe(el); return () => ro.disconnect();
  }, [value, values]);
  return <div ref={rail} className="selection-rail hscroll" role="group" aria-label={label} data-testid={testId}
    onPointerDown={e => { if (e.pointerType === "mouse" && e.button === 0) drag.current = { x: e.clientX, scroll: e.currentTarget.scrollLeft, moved: false }; }}
    onPointerMove={e => { const d = drag.current; if (!d || e.pointerType !== "mouse" || e.buttons !== 1) return; const dx = e.clientX - d.x; if (Math.abs(dx) > 5) { d.moved = true; e.currentTarget.scrollLeft = d.scroll - dx; } }}
    onPointerLeave={() => { drag.current = null; }}
    onClickCapture={e => { if (drag.current?.moved) { e.preventDefault(); e.stopPropagation(); } drag.current = null; }}>
    <span className="rail-indicator" aria-hidden="true" style={{ width: indicator.width, transform: `translateX(${indicator.left}px)` }} />
    {options.map((o, index) => <button ref={el => { if (el) buttons.current.set(o.value, el); else buttons.current.delete(o.value); }} key={o.value} type="button" className={`rail-option ${value === o.value ? "selected" : ""}`} disabled={disabled} aria-pressed={value === o.value} data-testid={`${itemPrefix}-${o.value}`} onClick={() => onChange(o.value)}
      onKeyDown={e => { if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return; e.preventDefault(); const i = e.key === "Home" ? 0 : e.key === "End" ? options.length - 1 : Math.max(0, Math.min(options.length - 1, index + (e.key === "ArrowRight" ? 1 : -1))); onChange(options[i].value); buttons.current.get(options[i].value)?.focus({ preventScroll: true }); }}>{o.label}</button>)}
  </div>;
}
