import { nativeApp } from "./config";
export type Effect = "soft" | "quiet";
export function readEffect(): Effect { try { return localStorage.getItem("brokie.effect") === "quiet" ? "quiet" : "soft"; } catch { return "soft"; } }
export function saveEffect(effect: Effect) { try { localStorage.setItem("brokie.effect", effect); } catch { /* private mode */ } }
/** Touch feedback: opt-in on the web, on by default in the iOS app (real Taptic Engine haptics). */
export function hapticsOn() { try { const v = localStorage.getItem("brokie.haptics"); return v === "on" || (v == null && nativeApp); } catch { return nativeApp; } }
export function haptic(pattern: number | number[] = 8) { try { if (hapticsOn()) navigator.vibrate?.(pattern); } catch { /* Unsupported or disabled. */ } }
// Sound is opt-in on the web. The iOS app starts with it on (written once, so the You toggle shows it and can turn it off).
if (nativeApp) { try { if (localStorage.getItem("brokie.sound") == null) localStorage.setItem("brokie.sound", "on"); } catch { /* private mode */ } }
export function soundOn() { try { const v = localStorage.getItem("brokie.sound"); return v === "on" || (v == null && nativeApp); } catch { return nativeApp; } }
let audio: AudioContext | undefined, last = 0;
/** One short sine note: frequency glide, quick attack, exponential tail. */
function note(ctx: AudioContext, at: number, from: number, to: number, duration: number, volume: number, type: OscillatorType = "sine") {
  const gain = ctx.createGain(), osc = ctx.createOscillator();
  gain.gain.setValueAtTime(.0001, at); gain.gain.exponentialRampToValueAtTime(volume, at + .012); gain.gain.exponentialRampToValueAtTime(.0001, at + duration);
  gain.connect(ctx.destination);
  osc.type = type; osc.frequency.setValueAtTime(from, at); osc.frequency.exponentialRampToValueAtTime(to, at + duration); osc.connect(gain); osc.start(at); osc.stop(at + duration + .02);
}
function play(fn: (ctx: AudioContext, t: number) => void) {
  try { audio ??= new AudioContext(); void audio.resume(); fn(audio, audio.currentTime); } catch { /* Visual confirmation remains available. */ }
}
/** Both audio and haptics are opt-in. No remote media or background playback. */
export function orderEffect(effect: Effect, preview = false) {
  if ((!soundOn() && !preview) || effect === "quiet" || performance.now()-last < 140) return;
  last=performance.now();
  play((ctx, t) => note(ctx, t, 440, 550, .09, .035));
}
/** A closed trade: a short rising two-note chime for a win, one soft low tick for a loss. */
export function resultEffect(pnl: number) {
  if (!soundOn() || readEffect() === "quiet") return;
  last = performance.now();
  play((ctx, t) => {
    if (pnl > 0) { note(ctx, t, 660, 680, .12, .05, "triangle"); note(ctx, t + .1, 988, 1000, .22, .05, "triangle"); }
    else note(ctx, t, 196, 164, .14, .03);
  });
}
/** Target hit / funded: a little three-note arpeggio. */
export function celebrateEffect() {
  if (!soundOn() || readEffect() === "quiet") return;
  play((ctx, t) => { [523, 659, 784, 1047].forEach((f, i) => note(ctx, t + i * .09, f, f * 1.01, .26, .045, "triangle")); });
}
