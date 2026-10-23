import { ReactNode, useEffect, useRef, useState } from "react";

export const money = (n: number, d = 2) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: d, maximumFractionDigits: d });
export const signedMoney = (n: number) => (n >= 0 ? "+" : "−") + money(Math.abs(n));
export const px = (n: number, d = 2) => n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });

export function countdown(endISO?: string, now = Date.now()) {
  if (!endISO) return "—";
  const s = Math.max(0, Math.floor((Date.parse(endISO) - now) / 1000));
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${Math.max(1, m)}m`;
}

export function ago(iso: string, now = Date.now()) {
  const s = Math.max(0, Math.floor((now - Date.parse(iso)) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function Sheet({ open, onClose, children, locked }: { open: boolean; onClose: () => void; children: ReactNode; locked?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);
  if (!open) return null;
  return (
    <>
      <div className="scrim" onClick={locked ? undefined : onClose} />
      <div className="sheet" role="dialog" aria-modal="true"><div className="grab" />{children}</div>
    </>
  );
}

export function Button({ children, onClick, busy, disabled, variant = "lime", id }:
  { children: ReactNode; onClick?: () => void; busy?: boolean; disabled?: boolean; variant?: "lime" | "short" | "ghost"; id?: string }) {
  return (
    <button className={`big-btn ${variant}`} onClick={onClick} disabled={disabled || busy} data-testid={id}>
      {busy ? <span className="spinner" /> : children}
    </button>
  );
}

export function Eyebrow({ children }: { children: ReactNode }) { return <div className="eyebrow">{children}</div>; }

export function useToast(): [string | null, (m: string) => void] {
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => { if (!msg) return; const t = setTimeout(() => setMsg(null), 3000); return () => clearTimeout(t); }, [msg]);
  return [msg, setMsg];
}

export function useNow(ms = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(t); }, [ms]);
  return now;
}

export const Icon = {
  trade: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3v18h18"/><path d="m7 15 4-4 3 3 5-6"/></svg>,
  squad: <svg viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="8" r="3.5"/><circle cx="17" cy="9" r="2.8"/><path d="M2.5 19c.6-3.6 3.3-5.5 6.5-5.5s5.9 1.9 6.5 5.5z"/><path d="M15.8 13.6c2.9-.2 5.1 1.4 5.7 4.4h-4.6c-.2-1.8-.6-3.2-1.1-4.4z"/></svg>,
  chat: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"><path d="M4 6a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3h-6.5L6 21v-4.2A3 3 0 0 1 4 14z"/></svg>,
  learn: <svg viewBox="0 0 24 24" fill="currentColor"><path d="M13 2 4 14h6l-1 8 9-12h-6z"/></svg>,
  you: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="9.5"/><circle cx="12" cy="10" r="3.2"/><path d="M6.5 18.5c1.3-2.3 3.2-3.4 5.5-3.4s4.2 1.1 5.5 3.4"/></svg>,
};

/** One-time hints: each shows for the first few app opens, and goes for good once the player has
 *  done the thing it explains. */
const HINT_OPENS = 3;
const opens = (() => { try { const n = Number(localStorage.getItem("brokie.opens") ?? 0) + 1; localStorage.setItem("brokie.opens", String(n)); return n; } catch { return 1; } })();
export function hintOn(key: string): boolean { try { return opens <= HINT_OPENS && localStorage.getItem(`brokie.hint.${key}`) !== "done"; } catch { return false; } }
export function hintDone(key: string) { try { localStorage.setItem(`brokie.hint.${key}`, "done"); } catch { /* */ } }

/** The next 5pm New York (US futures session close), when Brokie's trading day rolls over. */
export function nextSessionOpen(now = Date.now()): Date {
  const parts = (at: Date) => Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "numeric", day: "numeric", timeZoneName: "shortOffset" })
    .formatToParts(at).map((p) => [p.type, p.value]));
  for (let add = 0; add < 3; add++) {
    const p = parts(new Date(now + add * 86_400_000));
    const off = Number(String(p.timeZoneName).replace("GMT", "")) || -5;
    const at = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), 17 - off);
    if (at > now) return new Date(at);
  }
  return new Date(now + 86_400_000);
}
export const sessionOpenLabel = (now = Date.now()) =>
  nextSessionOpen(now).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }).replace(":00", "");

/** Show the exact latest value immediately; animate only its presentation. */
export function TickValue({ value, children }: { value: number | null; children: ReactNode }) {
  const node = useRef<HTMLSpanElement>(null);
  const previous = useRef(value);
  useEffect(() => {
    const changed = previous.current !== value;
    previous.current = value;
    if (!changed || !node.current) return;
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (preference.matches) return;
    const animation = node.current.animate([
      { opacity: .65, transform: "translateY(3px)" },
      { opacity: 1, transform: "translateY(0)" },
    ], { duration: 280, easing: "cubic-bezier(.2,.8,.2,1)" });
    const stop = () => { if (preference.matches) animation.cancel(); };
    preference.addEventListener("change", stop);
    return () => { animation.cancel(); preference.removeEventListener("change", stop); };
  }, [value]);
  return <span className="tick-value" ref={node}>{children}</span>;
}
