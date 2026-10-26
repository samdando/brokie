import { CSSProperties, useEffect, useSyncExternalStore } from "react";
import { game } from "./game";
type Look = { symbol: string | null; color: string | null };
let looks: Record<string, Look> = {};
const listeners = new Set<() => void>(), pending = new Set<string>();
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
export function Avatar({ handle, className = "", style, symbol, color }: { handle: string; className?: string; style?: CSSProperties; symbol?: string; color?: string }) {
  const all = useSyncExternalStore(f => { listeners.add(f); return () => { listeners.delete(f); }; }, () => looks);
  useEffect(() => { load(handle); const t = setInterval(() => load(handle), 20000); return () => clearInterval(t); }, [handle, all]);
  const hash = [...handle.toLowerCase()].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7), hue = hash % 360;
  const look = all[handle];
  return <span className={`av player-avatar ${className}`} aria-label={`${handle}'s avatar`} style={{ background: `linear-gradient(${hash % 180}deg, hsl(${hue} 46% 28%), hsl(${(hue + 55) % 360} 55% 14%))`, color: color ?? look?.color ?? `hsl(${hue} 90% 85%)`, border: `1px solid ${color ?? look?.color ?? `hsl(${hue} 45% 50%)`}`, ...style }}>{symbol ?? look?.symbol ?? handle[0]?.toUpperCase()}</span>;
}
