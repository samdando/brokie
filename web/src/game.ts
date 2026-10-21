// The online season, same rules as the iPhone app: the server fills every
// trade and owns every balance; this only mirrors and polls.
import { useSyncExternalStore } from "react";
import { Backend, BackendError } from "./api";
import { isConfigured } from "./config";
import type { Bubble, Candle, FeedEvent, LeaderRow, Lifetime, Market, MyState, Side, Squad, Trade } from "./types";

export type Phase = "unconfigured" | "connecting" | "needsHandle" | "ready" | "failed";

export interface GameState {
  phase: Phase;
  error: string | null;
  me: MyState | null;
  squads: Squad[];
  squadId: string | null;
  leaderboard: LeaderRow[];
  feed: FeedEvent[];
  candles: Partial<Record<Market, Candle[]>>;
  candleSeconds: number;
  market: Market;
  clockOffset: number;
  freshBackupCode: string | null;
  bubbles: Bubble[];
  lifetime: Lifetime | null;
}

const SQUAD_KEY = "brokie.squad";
const MARKET_KEY = "brokie.market";
const read = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k: string, v: string | null) => { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch { /* ignore */ } };

export class Game {
  api = new Backend();
  state: GameState = {
    phase: isConfigured ? "connecting" : "unconfigured", error: null, me: null, squads: [], squadId: read(SQUAD_KEY),
    leaderboard: [], feed: [], candles: {}, candleSeconds: 60, market: (read(MARKET_KEY) as Market) || "nas",
    clockOffset: 0, freshBackupCode: null, bubbles: [], lifetime: null,
  };
  private listeners = new Set<() => void>();
  private timer: number | null = null;
  private beat = 0;

  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => this.listeners.delete(fn); };
  get = () => this.state;
  private set(patch: Partial<GameState>) { this.state = { ...this.state, ...patch }; this.listeners.forEach((l) => l()); }

  get squad(): Squad | null { return this.state.squads.find((s) => s.id === this.state.squadId) ?? this.state.squads[0] ?? null; }
  now() { return Date.now() + this.state.clockOffset; }
  quote(m: Market) { return this.state.me?.quotes.find((q) => q.market === m) ?? null; }
  isOpen(m: Market) { const q = this.quote(m); return !!q && this.now() - Date.parse(q.quoted_at) < 45_000; }

  async start() {
    if (!isConfigured || this.state.phase === "ready") return;
    this.set({ phase: "connecting", error: null });
    try {
      await this.api.ensureSession();
      await this.refreshState();
      this.set({ phase: "ready" });
      await this.refreshSquads();
      this.loop();
    } catch (e) {
      if (e instanceof BackendError && e.needsHandle) this.set({ phase: "needsHandle" });
      else this.set({ phase: "failed", error: (e as Error).message });
    }
  }

  setActive(active: boolean) {
    if (!active) { if (this.timer) window.clearTimeout(this.timer); this.timer = null; return; }
    if (this.state.phase === "ready") this.loop(); else if (this.state.phase === "failed") void this.start();
  }

  private loop() {
    if (this.timer) window.clearTimeout(this.timer);
    const tick = async () => {
      try { await this.refreshState(); } catch { /* keep going */ }
      if (this.beat % 3 === 0) { await this.refreshBoard(); await this.refreshCandles(); }
      if (this.beat % 12 === 0) await this.refreshSquads();
      this.beat++;
      this.timer = window.setTimeout(tick, 5000);
    };
    this.beat = 0;
    void tick();
  }

  async refreshState() {
    const me = await this.api.rpc<MyState>("my_state");
    this.set({ me, clockOffset: Date.parse(me.server_time) - Date.now() });
  }

  async claimHandle(handle: string) {
    await this.api.rpc("claim_handle", { p_handle: handle });
    await this.refreshState();
    if (this.state.phase !== "ready") { this.set({ phase: "ready" }); await this.refreshSquads(); this.loop(); }
  }

  async restore(handle: string, code: string) {
    await this.api.ensureSession();
    const r = await this.api.rpc<{ ok: boolean; error?: string; code?: string }>("restore_account", { p_handle: handle, p_code: code });
    if (!r.ok) throw new BackendError(r.error ?? "Couldn't restore that account.");
    await this.refreshState();
    this.set({ freshBackupCode: r.code ?? null });
    if (this.state.phase !== "ready") { this.set({ phase: "ready" }); await this.refreshSquads(); this.loop(); }
  }

  async issueBackupCode() {
    const r = await this.api.rpc<{ code: string }>("issue_backup_code");
    this.set({ freshBackupCode: r.code, me: this.state.me ? { ...this.state.me, has_backup_code: true } : null });
  }
  dismissBackupCode() { this.set({ freshBackupCode: null }); }

  async open(side: Side, quantity: number): Promise<string | null> {
    try {
      await this.api.rpc("open_position", { p_market: this.state.market, p_side: side, p_quantity: quantity });
      await this.refreshState();
      void this.refreshBoard();
      return null;
    } catch (e) { return (e as Error).message; }
  }

  async close(id: string): Promise<{ pnl?: number; error?: string }> {
    try {
      const t = await this.api.rpc<Trade>("close_position", { p_id: id });
      await this.refreshState();
      void this.refreshBoard();
      return { pnl: t.pnl };
    } catch (e) { return { error: (e as Error).message }; }
  }

  async refreshSquads() {
    try {
      const squads = await this.api.rpc<Squad[]>("my_squads");
      const keep = squads.some((s) => s.id === this.state.squadId) ? this.state.squadId : squads[0]?.id ?? null;
      this.set({ squads });
      if (keep !== this.state.squadId) this.selectSquad(keep); else if (keep && this.state.leaderboard.length === 0) void this.refreshBoard();
    } catch { /* offline blip */ }
  }

  selectSquad(id: string | null) {
    write(SQUAD_KEY, id);
    this.set({ squadId: id, leaderboard: [], feed: [] });
    void this.refreshBoard();
  }

  async createSquad(name: string) {
    const s = await this.api.rpc<Squad>("create_squad", { p_name: name });
    await this.refreshSquads();
    this.selectSquad(s.id);
  }
  async joinSquad(code: string) {
    const s = await this.api.rpc<Squad>("join_squad", { p_code: code });
    await this.refreshSquads();
    this.selectSquad(s.id);
  }
  async leaveSquad(id: string) {
    await this.api.rpc("leave_squad", { p_squad: id });
    if (this.state.squadId === id) this.selectSquad(null);
    await this.refreshSquads();
  }

  async refreshBoard() {
    const squad = this.squad;
    if (!squad) return;
    try {
      const [leaderboard, feed] = await Promise.all([
        this.api.rpc<LeaderRow[]>("squad_leaderboard", { p_squad: squad.id }),
        this.api.rpc<FeedEvent[]>("squad_feed", { p_squad: squad.id, p_limit: 30 }),
      ]);
      if (this.squad?.id === squad.id) this.set({ leaderboard, feed });
    } catch { /* keep last */ }
  }

  setMarket(m: Market) { write(MARKET_KEY, m); this.set({ market: m, bubbles: [] }); void this.refreshCandles(m); void this.refreshBubbles(); }

  async refreshBubbles() {
    if (this.state.phase !== "ready") return;
    const market = this.state.market;
    try {
      const bubbles = await this.api.rpc<Bubble[]>("chart_bubbles", { p_market: market, p_squad: this.squad?.id ?? null });
      if (this.state.market === market) this.set({ bubbles });
    } catch { /* keep last */ }
  }

  async buyBack() { await this.api.rpc("buy_back"); await this.refreshState(); }
  async refreshLifetime() { try { this.set({ lifetime: await this.api.rpc<Lifetime>("lifetime_stats") }); } catch { /* */ } }
  setCandleSeconds(s: number) { this.set({ candleSeconds: s }); void this.refreshCandles(); }

  async refreshCandles(m: Market = this.state.market) {
    try {
      const bars = await this.api.rpc<Candle[]>("candles", { p_market: m, p_bucket_seconds: this.state.candleSeconds, p_limit: 60 });
      this.set({ candles: { ...this.state.candles, [m]: bars } });
    } catch { /* keep last */ }
  }

  /** Server candles with the live quote folded into the newest bar. */
  liveCandles(m: Market): Candle[] {
    const bars = this.state.candles[m] ?? [];
    const q = this.quote(m);
    if (!q) return bars;
    const size = this.state.candleSeconds;
    const bucket = Math.floor(this.now() / 1000 / size);
    const last = bars[bars.length - 1];
    if (last && last.index === bucket) {
      return [...bars.slice(0, -1), { ...last, high: Math.max(last.high, q.price), low: Math.min(last.low, q.price), close: q.price }];
    }
    if (last && last.index > bucket) return bars;
    const open = last?.close ?? q.price;
    return [...bars, { index: bucket, open, high: Math.max(open, q.price), low: Math.min(open, q.price), close: q.price }];
  }

  async voiceCredentials(room: string) {
    const squad = this.squad;
    if (!squad) throw new BackendError("Join a squad to use voice.");
    return this.api.fn<{ url: string; token: string; room: string }>("voice-token", { squadId: squad.id, room });
  }
}

export const game = new Game();
export function useGame(): GameState { return useSyncExternalStore(game.subscribe, game.get); }
