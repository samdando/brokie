// Live squad voice for the web app (LiveKit). Joins muted; mic only opens on
// unmute or while holding push-to-talk; leaving the tab mutes you.
import { useSyncExternalStore } from "react";
import { Room, RoomEvent, Track, RemoteTrack, RemoteParticipant } from "livekit-client";
import { game } from "./game";

export type VoiceRoomId = "squad" | "gold" | "indices";
export const ROOMS: { id: VoiceRoomId; title: string; subtitle: string }[] = [
  { id: "squad", title: "Squad lounge", subtitle: "Your friends. Every market." },
  { id: "gold", title: "Gold gang", subtitle: "Talk Gold with your squad." },
  { id: "indices", title: "Index crew", subtitle: "NAS and ES, in good company." },
];

export interface Person { id: string; name: string; you: boolean; speaking: boolean; muted: boolean }
interface VoiceState {
  status: "idle" | "connecting" | "live" | "failed";
  room: VoiceRoomId | null; muted: boolean; deafened: boolean; ptt: boolean; holding: boolean;
  people: Person[]; error: string | null;
}

class Voice {
  state: VoiceState = { status: "idle", room: null, muted: true, deafened: false, ptt: false, holding: false, people: [], error: null };
  private lk: Room | null = null;
  private listeners = new Set<() => void>();
  private generation = 0;
  subscribe = (f: () => void) => { this.listeners.add(f); return () => this.listeners.delete(f); };
  get = () => this.state;
  private set(p: Partial<VoiceState>) { this.state = { ...this.state, ...p }; this.listeners.forEach((l) => l()); }
  get micOn() { const s = this.state; return s.status === "live" && !s.deafened && (s.ptt ? s.holding : !s.muted); }

  async join(room: VoiceRoomId) {
    const token = ++this.generation;
    await this.leave(false);
    this.set({ status: "connecting", room, muted: true, deafened: false, ptt: false, holding: false, people: [], error: null });
    let lk: Room | null = null;
    try {
      const creds = await game.voiceCredentials(room);
      if (token !== this.generation) return;
      lk = new Room({ adaptiveStream: true, dynacast: true });
      lk.on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
        if (track.kind === Track.Kind.Audio) { const el = track.attach(); el.dataset.brokie = "1"; document.body.appendChild(el); }
        this.refresh();
      });
      lk.on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => { track.detach().forEach((el) => el.remove()); this.refresh(); });
      for (const ev of [RoomEvent.ParticipantConnected, RoomEvent.ParticipantDisconnected, RoomEvent.ActiveSpeakersChanged, RoomEvent.TrackMuted, RoomEvent.TrackUnmuted]) {
        lk.on(ev, () => this.refresh());
      }
      lk.on(RoomEvent.Disconnected, () => {
        if (this.lk === lk) { this.lk = null; this.set({ status: "failed", error: "Voice dropped.", people: [] }); }
      });
      // LiveKit can spend ~40 s trying other regions. Give up at 15 s so the button can offer a retry.
      let timer: number | undefined;
      await Promise.race([
        lk.connect(creds.url, creds.token),
        new Promise<never>((_, reject) => { timer = window.setTimeout(() => reject(new Error("Voice is taking too long to connect. Tap to try again.")), 15000); }),
      ]).finally(() => clearTimeout(timer));
      if (token !== this.generation) { await lk.disconnect(); return; }
      await lk.startAudio().catch(() => undefined);
      await lk.localParticipant.setMicrophoneEnabled(false);
      this.lk = lk;
      this.set({ status: "live" });
      this.refresh();
    } catch (e) {
      lk?.disconnect().catch(() => undefined);
      if (token === this.generation) this.set({ status: "failed", error: (e as Error).message, room: null });
    }
  }

  async leave(bump = true) {
    if (bump) this.generation++;
    const lk = this.lk;
    this.lk = null;
    document.querySelectorAll("audio[data-brokie]").forEach((el) => el.remove());
    if (lk) await lk.disconnect();
    if (bump) this.set({ status: "idle", room: null, people: [], muted: true, holding: false, error: null });
  }

  private async applyMic() { try { await this.lk?.localParticipant.setMicrophoneEnabled(this.micOn); } catch (e) { this.set({ error: (e as Error).message, muted: true, holding: false }); } this.refresh(); }
  toggleMute() { if (this.state.deafened || this.state.ptt) return; this.set({ muted: !this.state.muted }); void this.applyMic(); }
  setPTT(on: boolean) { this.set({ ptt: on, muted: true, holding: false }); void this.applyMic(); }
  hold(on: boolean) { if (!this.state.ptt || this.state.deafened) return; this.set({ holding: on }); void this.applyMic(); }
  toggleDeafen() {
    const deafened = !this.state.deafened;
    this.set({ deafened, muted: true, holding: false });
    this.lk?.remoteParticipants.forEach((p: RemoteParticipant) => p.setVolume(deafened ? 0 : 1));
    void this.applyMic();
  }
  suspend() { if (this.state.status === "live") { this.set({ muted: true, holding: false }); void this.applyMic(); } }

  private refresh() {
    const lk = this.lk;
    if (!lk) return;
    const local = lk.localParticipant;
    const people: Person[] = [{ id: local.identity, name: "You", you: true, speaking: this.micOn && local.isSpeaking, muted: !this.micOn }];
    lk.remoteParticipants.forEach((p) => people.push({ id: p.identity, name: p.name || "player", you: false, speaking: p.isSpeaking, muted: !p.isMicrophoneEnabled }));
    this.set({ people });
  }
}

export const voice = new Voice();
export const useVoice = () => useSyncExternalStore(voice.subscribe, voice.get);
document.addEventListener("visibilitychange", () => { if (document.hidden) voice.suspend(); });
