import { CSSProperties, useEffect, useSyncExternalStore } from "react";
import { game } from "./game";
type Look = { symbol: string | null; color: string | null };
let looks: Record<string, Look> = {};
const listeners = new Set<() => void>(), pending = new Set<string>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const fetched = new Map<string, number>();
let timer: ReturnType<typeof setTimeout> | undefined;
export function refreshAvatars() { fetched.clear(); looks = {}; listeners.forEach(f => f()); }
function load(handle: string) {
  if (Date.now() - (fetched.get(handle) ?? 0) < 15000) return;
  pending.add(handle);
  if (timer) return;
  timer = setTimeout(async () => {
    timer = undefined;
    const handles = [...pending].slice(0, 100); handles.forEach(h => pending.delete(h));
    try {
      const data = await game.api.rpc<Record<string, Look>>("player_avatars", { p_handles: handles });
      handles.forEach(h => fetched.set(h, Date.now()));
      looks = { ...looks, ...data }; listeners.forEach(f => f());
    } catch { /* Free identities stay available if cosmetics cannot load. */ }
  }, 40);
}
function usePlayerLook(handle: string) {
  const look = useSyncExternalStore(subscribe, () => looks[handle]);
  useEffect(() => { load(handle); const t = setInterval(() => load(handle), 20000); return () => clearInterval(t); }, [handle, look]);
  return look;
}
const fallbackAccent = (handle: string) => {
  const hash = [...handle.toLowerCase()].reduce((h,c)=>(h*31+c.charCodeAt(0))>>>0,7);
  return `hsl(${hash % 360} 65% 72%)`;
};
/** Reuse a mate's chosen identity colour for social details as well as their face. */
export function usePlayerAccent(handle: string) { return usePlayerLook(handle)?.color ?? fallbackAccent(handle); }

export function Avatar({ handle, className = "", style, symbol, color }: { handle: string; className?: string; style?: CSSProperties; symbol?: string; color?: string }) {
  const look = usePlayerLook(handle), accent = color ?? look?.color ?? fallbackAccent(handle);
  return <span className={`av player-avatar ${className}`} aria-label={`${handle}'s avatar`} style={{ ["--player-accent" as string]: accent, background: `linear-gradient(145deg, color-mix(in srgb, ${accent} 32%, #17212C), color-mix(in srgb, ${accent} 12%, #101A25))`, color: accent, border: `1px solid color-mix(in srgb, ${accent} 70%, #466073)`, ...style }}>{symbol ?? look?.symbol ?? handle[0]?.toUpperCase()}</span>;
}
