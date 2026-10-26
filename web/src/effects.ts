export const EFFECTS = [{ id: "arcade", label: "Arcade", symbol: "ϟ" }, { id: "gunshot", label: "Gunshot", symbol: "◎" }, { id: "explosive", label: "Explosive", symbol: "✹" }, { id: "quiet", label: "Quiet", symbol: "○" }] as const;
export type Effect = typeof EFFECTS[number]["id"];
export function readEffect(): Effect { try { const s = localStorage.getItem("brokie.effect"); return EFFECTS.some(e => e.id === s) ? s as Effect : "arcade"; } catch { return "arcade"; } }
export function saveEffect(effect: Effect) { try { localStorage.setItem("brokie.effect", effect); } catch { /* private mode */ } }
let audio: AudioContext | undefined, last = 0;
/** Sound is explicitly opt-in; synthesize short effects locally without media requests. */
export function orderEffect(effect: Effect, preview = false) {
  let enabled = false; try { enabled = localStorage.getItem("brokie.sound") === "on"; } catch { /* */ }
  if ((!enabled && !preview) || effect === "quiet" || performance.now() - last < 140) return;
  last = performance.now();
  try {
    audio ??= new AudioContext(); void audio.resume();
    const t = audio.currentTime, duration = effect === "explosive" ? .28 : .12;
    const gain = audio.createGain(); gain.gain.setValueAtTime(.12, t); gain.gain.exponentialRampToValueAtTime(.001, t + duration); gain.connect(audio.destination);
    const osc = audio.createOscillator(); osc.type = effect === "arcade" ? "square" : "sawtooth"; osc.frequency.setValueAtTime(effect === "arcade" ? 520 : effect === "gunshot" ? 170 : 80, t); osc.frequency.exponentialRampToValueAtTime(effect === "arcade" ? 1040 : 25, t + duration); osc.connect(gain); osc.start(t); osc.stop(t + duration);
    if (effect !== "arcade") { const buffer = audio.createBuffer(1, Math.ceil(audio.sampleRate * duration), audio.sampleRate), data = buffer.getChannelData(0); for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1; const noise = audio.createBufferSource(); noise.buffer = buffer; noise.connect(gain); noise.start(t); }
  } catch { /* Audio unavailable: visual feedback remains. */ }
}
