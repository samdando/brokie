import { nativeApp } from "./config";
export type Effect = "soft" | "quiet";
export function readEffect(): Effect { try { return localStorage.getItem("brokie.effect") === "quiet" ? "quiet" : "soft"; } catch { return "soft"; } }
export function saveEffect(effect: Effect) { try { localStorage.setItem("brokie.effect", effect); } catch { /* private mode */ } }
/** Touch feedback: opt-in on the web, on by default in the iOS app (real Taptic Engine haptics). */
export function hapticsOn() { try { const v = localStorage.getItem("brokie.haptics"); return v === "on" || (v == null && nativeApp); } catch { return nativeApp; } }
export function haptic(pattern: number | number[] = 8) { try { if (hapticsOn()) navigator.vibrate?.(pattern); } catch { /* Unsupported or disabled. */ } }
let audio: AudioContext | undefined, last = 0;
/** Both audio and haptics are opt-in. No remote media or background playback. */
export function orderEffect(effect: Effect, preview = false) {
  let enabled = false; try { enabled = localStorage.getItem("brokie.sound") === "on"; } catch { /* */ }
  if ((!enabled && !preview) || effect === "quiet" || performance.now()-last < 140) return;
  last=performance.now();
  try {
    audio ??= new AudioContext(); void audio.resume();
    const t=audio.currentTime,duration=.09,gain=audio.createGain(),osc=audio.createOscillator();
    gain.gain.setValueAtTime(.035,t);gain.gain.exponentialRampToValueAtTime(.001,t+duration);gain.connect(audio.destination);
    osc.type="sine";osc.frequency.setValueAtTime(440,t);osc.frequency.exponentialRampToValueAtTime(550,t+duration);osc.connect(gain);osc.start(t);osc.stop(t+duration);
  } catch { /* Visual confirmation remains available. */ }
}
