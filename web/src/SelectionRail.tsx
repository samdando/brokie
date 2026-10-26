import { useEffect, useLayoutEffect, useRef, useState } from "react";
/** Vertical snap wheel shared by intervals and micro size. */
export function SelectionRail({ label, value, options, onChange, disabled = false, testId, itemPrefix }: {
  label: string; value: number; options: { value: number; label: string }[]; onChange: (value: number) => void; disabled?: boolean; testId: string; itemPrefix: string;
}) {
  const rail = useRef<HTMLDivElement>(null);
  const latest = useRef({ value, options, onChange, disabled });
  latest.current = { value, options, onChange, disabled };
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const drag = useRef<{ y: number; scroll: number } | null>(null);
  const [position, setPosition] = useState(Math.max(0, options.findIndex(o => o.value === value)));
  const values = options.map(o => o.value).join(",");
  const settle = () => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      if (!rail.current || drag.current) return;
      const s = latest.current;
      const i = Math.max(0, Math.min(s.options.length - 1, Math.round(rail.current.scrollTop / 32)));
      if (!s.disabled && s.options[i] && s.options[i].value !== s.value) s.onChange(s.options[i].value);
    }, 160);
  };
  useLayoutEffect(() => {
    clearTimeout(timer.current);
    const i = Math.max(0, options.findIndex(o => o.value === value));
    if (rail.current) rail.current.scrollTop = i * 32;
    setPosition(i);
  }, [value, values, disabled]);
  useEffect(() => () => { clearTimeout(timer.current); }, []);
  return <div className={`selection-wheel ${disabled ? "disabled" : ""}`}>
    <div ref={rail} className="wheel-scroll" role="spinbutton" tabIndex={disabled ? -1 : 0} aria-label={label} aria-valuemin={options[0]?.value} aria-valuemax={options[options.length - 1]?.value} aria-valuenow={value} aria-valuetext={options.find(o => o.value === value)?.label} aria-disabled={disabled} data-testid={testId}
      onScroll={e => { setPosition(e.currentTarget.scrollTop / 32); settle(); }}
      onPointerDown={e => { e.stopPropagation(); if (!disabled && e.pointerType === "mouse" && e.button === 0) { drag.current = { y: e.clientY, scroll: e.currentTarget.scrollTop }; e.currentTarget.setPointerCapture(e.pointerId); e.currentTarget.focus({ preventScroll: true }); } }}
      onPointerMove={e => { const d = drag.current; if (!d || disabled) return; e.currentTarget.scrollTop = d.scroll - (e.clientY - d.y); }}
      onPointerUp={() => { drag.current = null; settle(); }}
      onPointerCancel={() => { drag.current = null; settle(); }}
      onKeyDown={e => {
        if (disabled || !["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
        e.preventDefault(); e.stopPropagation();
        const index = options.findIndex(o => o.value === value);
        const i = e.key === "Home" ? 0 : e.key === "End" ? options.length - 1 : Math.max(0, Math.min(options.length - 1, index + (["ArrowDown", "ArrowRight"].includes(e.key) ? 1 : -1)));
        onChange(options[i].value);
      }}>
      {options.map((o, i) => <div key={o.value} className={`wheel-value ${value === o.value ? "selected" : ""}`} aria-hidden="true" data-testid={`${itemPrefix}-${o.value}`} style={{ opacity: Math.max(.12, 1 - Math.abs(position - i) * .65), transform: `scale(${Math.max(.8, 1 - Math.abs(position - i) * .13)})` }}>{o.label}</div>)}
    </div>
    <span className="wheel-guides" aria-hidden="true" />
  </div>;
}
