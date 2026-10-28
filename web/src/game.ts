// The online season, same rules as the iPhone app: the server fills every
// trade and owns every balance; this only mirrors and polls.
import { useSyncExternalStore } from "react";
import { Backend, BackendError } from "./api";
import { isConfigured } from "./config";
import { marketSessionOpen, sessionMarkets, weekendMode } from "./sessions";
import type { Bubble, Candle, Position, ChatMsg, EventItem, EventsFeed, FeedEvent, FeedbackKind, Flash, GlobalBoard, LeaderRow, Lifetime, Market, MyState, Quote, Side, Squad, Trade } from "./types";

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
  /** The timeframes the chart's one timeframe button cycles through (picked on the You tab). */
  frames: number[];
  market: Market;
  clockOffset: number;
  freshBackupCode: string | null;
  bubbles: Bubble[];
  bubbleScope: string | null;
  lifetime: Lifetime | null;
  global: GlobalBoard | null;
  chat: ChatMsg[];
  /** The newest squad message from someone else, popped over whatever screen you're on. */
  chatPop: ChatMsg | null;
  /** Squad chat sheet is open (so pop-ups stay quiet). */
  chatOpen: boolean;
  /** Squad messages from others since you last opened the chat (the badge on the header button). */
  chatUnread: number;
  events: EventsFeed | null;
  flash: Flash | null;
  qty: number;
  /** Server-confirmed SL/TP; never display an unsaved level as protection. */
  brackets: Record<string, Bracket>;
  bracketSaving: string | null;
  /** Spam taps waiting to be sent (ticket 15). */
  pending: { side: Side; count: number; reduce?: boolean } | null;
  /** What tapping the opposite button does while you hold a position: open a hedge or take a partial. */
  opposite: "hedge" | "partial";
}
export interface Bracket { sl?: number; tp?: number }
export function bracketsOf(positions: Position[]): Record<string, Bracket> {
  return Object.fromEntries(positions.filter(p => p.stop_loss != null || p.take_profit != null).map(p => [p.id, { ...(p.stop_loss != null ? { sl: p.stop_loss } : {}), ...(p.take_profit != null ? { tp: p.take_profit } : {}) }]));
}
/** Same market + same side = one stack: size-weighted avg entry, total size, id = oldest leg's id.
 *  A hedge (other side) is its own stack. Brackets and closes apply to the whole stack. */
export interface Stack { merged: Position; ids: string[] }
export function stacksOf(positions: Position[]): Stack[] {
  const groups = new Map<string, Position[]>();
  for (const p of positions) { const k = `${p.market}|${p.side}`; groups.set(k, [...(groups.get(k) ?? []), p]); }
  return [...groups.values()].map((legs) => {
    legs = [...legs].sort((a, b) => Date.parse(a.opened_at) - Date.parse(b.opened_at));
    const qty = legs.reduce((s, p) => s + p.quantity, 0);
    const avg = legs.reduce((s, p) => s + p.entry_price * p.quantity, 0) / Math.max(1, qty);
    return { merged: { ...legs[0], quantity: qty, entry_price: avg }, ids: legs.map((p) => p.id) };
  });
}
const BRACKET_KEY = "brokie.brackets";
export const TAP_SIZE = 1;

const SQUAD_KEY = "brokie.squad";
const MARKET_KEY = "brokie.market";
const QTY_KEY = "brokie.qty";
const FRAMES_KEY = "brokie.frames";
const FRAME_KEY = "brokie.frame";
/** Every timeframe the chart can show (the server builds them from 1m / 1h / 1D bars). */
export const FRAME_OPTIONS: { s: number; l: string }[] = [
  { s: 60, l: "1m" }, { s: 300, l: "5m" }, { s: 900, l: "15m" }, { s: 1800, l: "30m" },
  { s: 3600, l: "1h" }, { s: 14400, l: "4h" }, { s: 86400, l: "1D" },
];
export const DEFAULT_FRAMES = [60, 300, 900];
export const frameLabel = (s: number) => FRAME_OPTIONS.find((f) => f.s === s)?.l ?? `${Math.round(s / 60)}m`;
const readFrames = (): number[] => {
  try {
    const v = JSON.parse(read(FRAMES_KEY) ?? "null");
    const ok = Array.isArray(v) ? FRAME_OPTIONS.map((f) => f.s).filter((x) => v.includes(x)) : [];
    return ok.length ? ok : DEFAULT_FRAMES;
  } catch { return DEFAULT_FRAMES; }
};
/** Starts on the highest timeframe you picked unless you were on another one last time. */
const readFrame = (frames: number[]): number => { const v = Number(read(FRAME_KEY)); return frames.includes(v) ? v : frames[frames.length - 1]; };
const OPPOSITE_KEY = "brokie.opposite";
const SEEN_KEY = "brokie.seen";
const SEASON_KEY = "brokie.lastSeason";
export const QTY_CHOICES = [1, 5, 10];
export const EMOJIS = ["🔥", "💀", "🚀", "📈", "📉", "😂", "🫡", "💎", "🤡", "🙏", "👀", "🐂", "🐻"];
export const clampQty = (n: unknown) => { const v = Math.round(Number(n)); return Number.isFinite(v) ? ([1, 10, 100].includes(v) ? v : 1) : 1; };
const read = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k: string, v: string | null) => { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch { /* ignore */ } };

export class Game {
  api = new Backend();
  state: GameState = {
    phase: isConfigured ? "connecting" : "unconfigured", error: null, me: null, squads: [], squadId: read(SQUAD_KEY),
    leaderboard: [], feed: [], candles: {}, candleSeconds: readFrame(readFrames()), frames: readFrames(), market: (read(MARKET_KEY) as Market) || "nas",
    clockOffset: 0, freshBackupCode: null, bubbles: [], bubbleScope: null, lifetime: null,
    global: null, chat: [], chatPop: null, chatOpen: false, chatUnread: 0, events: null, flash: null, qty: clampQty(read(QTY_KEY) ?? 1),
    brackets: {}, bracketSaving: null, pending: null,
    opposite: read(OPPOSITE_KEY) === "hedge" ? "hedge" : "partial",   // partials by default; hedging is opt-in
  };
  private seen = new Set<string>(((): string[] => { try { return JSON.parse(read(SEEN_KEY) ?? "[]"); } catch { return []; } })());
  private submitting = false;
  private chatSeen = new Map<string, number>();
  private bubbleRequest = 0;
  private listeners = new Set<() => void>();
  private timer: number | null = null;
  private quoteTimer: number | null = null;
  private beat = 0;
  private frameDirection = -1;
  private lastWeekend: boolean | null = null;

  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => this.listeners.delete(fn); };
  get = () => this.state;
  private set(patch: Partial<GameState>) { this.state = { ...this.state, ...patch }; this.listeners.forEach((l) => l()); }

  get squad(): Squad | null { return this.state.squads.find((s) => s.id === this.state.squadId) ?? this.state.squads[0] ?? null; }
  now() { return Date.now() + this.state.clockOffset; }
  quote(m: Market) { return this.state.me?.quotes.find((q) => q.market === m) ?? null; }
  isOpen(m: Market) { const q = this.quote(m); const age = q ? this.now() - Date.parse(q.quoted_at) : Infinity; return marketSessionOpen(m, this.now()) && age >= -5000 && age < 45_000; }

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
    if (!active) {
      if (this.timer) window.clearTimeout(this.timer);
      if (this.quoteTimer) window.clearTimeout(this.quoteTimer);
      this.timer = this.quoteTimer = null; return;
    }
    if (this.state.phase === "ready") this.loop(); else if (this.state.phase === "failed") void this.start();
  }

  private loop() {
    if (this.timer) window.clearTimeout(this.timer);
    const tick = async () => {
      // All at once rather than one after another, so a slow call doesn't hold up the rest.
      const jobs: Promise<unknown>[] = [this.refreshState().catch(() => { /* keep going */ }), this.refreshChat()];
      if (this.beat % 3 === 0) jobs.push(this.refreshBoard(), this.refreshCandles());
      if (this.beat % 12 === 0) jobs.push(this.refreshSquads());
      if (this.beat % 6 === 0) jobs.push(this.refreshEvents());
      await Promise.all(jobs);
      this.beat++;
      this.timer = window.setTimeout(tick, 5000);
    };
    this.beat = 0;
    void tick();
    this.quoteLoop();
  }

  /** Prices on their own fast lane: a tiny read every 1.5 s while the app is on screen,
   *  instead of waiting for the full account refresh every 5 s. */
  private quoteLoop() {
    if (this.quoteTimer) window.clearTimeout(this.quoteTimer);
    const tick = async () => {
      if (!document.hidden && this.state.me) {
        try { this.mergeQuotes(await this.api.select<Quote[]>("quotes?select=market,price,quoted_at")); } catch { /* next beat */ }
      }
      this.quoteTimer = window.setTimeout(tick, 1500);
    };
    void tick();
  }

  /** Keep whichever quote is newer per market, so a slower response never rolls a price back. */
  private mergeQuotes(incoming: Quote[]) {
    const me = this.state.me;
    if (!me || !Array.isArray(incoming) || incoming.length === 0) return;
    const merged = newestQuotes(me.quotes, incoming);
    if (merged !== me.quotes) this.set({ me: { ...me, quotes: merged } });
  }

  async refreshState() {
    const bracketRevision = this.bracketRevision;
    const previous = this.state.me;
    const me = await this.api.rpc<MyState>("my_state");
    if (this.state.me) me.quotes = newestQuotes(this.state.me.quotes, me.quotes ?? []);
    this.set({ me, ...(bracketRevision === this.bracketRevision && !this.state.bracketSaving ? { brackets: bracketsOf(me.positions) } : {}), clockOffset: Date.parse(me.server_time) - Date.now() });
    if (previous) {
      const known = new Set(previous.trades.map(t => t.id));
      const fills = me.trades.filter(t => !known.has(t.id) && (t.reason === "stop_loss" || t.reason === "take_profit"));
      if (fills.length) this.raise({ key: `bracket:${fills.map(t => t.id).join(":")}`, tone: fills.reduce((n,t) => n+t.pnl,0) >= 0 ? "lime" : "red", title: fills.some(t => t.reason === "stop_loss") ? "Stop loss filled" : "Take profit filled", sub: `${fills.length} fill${fills.length === 1 ? "" : "s"} · check your trade receipts` });
    }
    void this.migrateDeviceBrackets();
    const weekend = weekendMode(this.now());
    if (weekend !== this.lastWeekend) {
      this.lastWeekend = weekend;
      const markets = sessionMarkets(this.now());
      if (this.state.market !== "prediction" && !markets.includes(this.state.market)) this.setMarket(markets[0]);
    }
    this.checkSeason(me);
  }

  private checkSeason(me: MyState) {
    const n = me.season_number;
    if (n == null) return;
    const last = read(SEASON_KEY);
    write(SEASON_KEY, String(n));
    if (last !== null && Number(last) !== n) {
      this.raise({ key: `season:${n}`, tone: "lime", title: `Season ${n} is live`, sub: "Fresh $100k. Everyone's equal again. Go." });
    }
  }

  async claimHandle(handle: string) {
    await this.api.rpc("claim_handle", { p_handle: handle });
    await this.refreshState();
    if (this.state.phase !== "ready") { this.set({ phase: "ready" }); await this.refreshSquads(); this.loop(); }
  }

  async restore(handle: string, code: string) {
    await this.api.ensureSession();
    const r = await this.api.rpc<{ ok: boolean; error?: string; code?: string }>("restore_account", { p_handle: handle, p_code: code });
    if (!r.ok) throw new BackendError(r.error ?? "Couldn't restore that account. Check the handle (no @) and the BRK- code.");
    await this.refreshState();
    this.set({ freshBackupCode: r.code ?? null });
    if (this.state.phase !== "ready") { this.set({ phase: "ready" }); await this.refreshSquads(); this.loop(); }
  }

  async issueBackupCode() {
    const r = await this.api.rpc<{ code: string }>("issue_backup_code");
    this.set({ freshBackupCode: r.code, me: this.state.me ? { ...this.state.me, has_backup_code: true } : null });
  }
  dismissBackupCode() { this.set({ freshBackupCode: null }); }

  setQty(n: number) { const q = clampQty(n); write(QTY_KEY, String(q)); this.set({ qty: q }); }

  private bracketRevision = 0;
  private legacyBracketsChecked = false;
  async setBracket(id: string, b: Bracket) {
    for (const kind of ["sl", "tp"] as const) if (b[kind] != null) await this.saveBracket(id, kind, b[kind]!);
  }
  async clearBracket(id: string, key: keyof Bracket) { await this.saveBracket(id, key, null); }
  private async saveBracket(id: string, kind: keyof Bracket, price: number | null) {
    if (this.state.bracketSaving) throw new BackendError("Wait for your current SL/TP change to save.");
    this.bracketRevision++;
    this.set({ bracketSaving: id });
    try {
      const result = await this.api.rpc<{ positions: Pick<Position, "id" | "stop_loss" | "take_profit">[] }>("set_position_bracket", { p_position: id, p_kind: kind, p_price: price });
      if (!Array.isArray(result?.positions)) throw new BackendError("Stop was not confirmed. Try again.");
      this.removeDeviceBracket(id, kind);
      const me = this.state.me;
      if (me) {
        const positions = me.positions.map(p => ({ ...p, ...result.positions.find(saved => saved.id === p.id) }));
        this.set({ me: { ...me, positions }, brackets: bracketsOf(positions) });
      }
    } finally { this.bracketRevision++; this.set({ bracketSaving: null }); }
  }
  private removeDeviceBracket(id: string, kind?: keyof Bracket) {
    try {
      const legacy = JSON.parse(read(BRACKET_KEY) ?? "{}");
      if (!legacy || typeof legacy !== "object" || Array.isArray(legacy)) { write(BRACKET_KEY, null); return; }
      if (kind && legacy[id] && typeof legacy[id] === "object") {
        delete legacy[id][kind]; if (!Object.keys(legacy[id]).length) delete legacy[id];
      } else delete legacy[id];
      write(BRACKET_KEY, Object.keys(legacy).length ? JSON.stringify(legacy) : null);
    } catch { write(BRACKET_KEY, null); }
  }
  /** Upgrade device-only levels once; crossed or rejected levels are never shown as saved. */
  private async migrateDeviceBrackets() {
    if (this.legacyBracketsChecked || !this.state.me) return;
    this.legacyBracketsChecked = true;
    let legacy: Record<string, Bracket>;
    try { legacy = JSON.parse(read(BRACKET_KEY) ?? "{}"); } catch { write(BRACKET_KEY, null); return; }
    if (!legacy || typeof legacy !== "object" || Array.isArray(legacy)) { write(BRACKET_KEY, null); return; }
    let failed = false;
    for (const [id, b] of Object.entries(legacy)) {
      const p = this.state.me.positions.find(p => p.id === id);
      if (!p) { this.removeDeviceBracket(id); continue; }
      try {
        for (const kind of ["sl", "tp"] as const) if (Number.isFinite(b?.[kind]) && (kind === "sl" ? p.stop_loss : p.take_profit) == null) await this.saveBracket(id, kind, b[kind]!);
        this.removeDeviceBracket(id);
      } catch { failed = true; }
    }
    if (failed) this.raise({ key: "bracket-migration", tone: "red", title: "Review your SL/TP", sub: "An old device-only level could not be saved. Set it again; only confirmed lines are active." });
  }

  // ---- Ticket 15: spam BUY / SELL. Each tap counts instantly; taps are batched ~300ms after the
  // last one into a single open_position call (max 10 micros per order, server rule). The opposite
  // side opens the other leg, i.e. a hedge, exactly like the existing Go long / Go short. ----
  private tapTimer: number | null = null;
  setOpposite(mode: "hedge" | "partial") { write(OPPOSITE_KEY, mode); this.set({ opposite: mode }); }
  /** Micros you hold on this market against `side` (what a partial-mode tap would take off). */
  heldAgainst(side: Side): number {
    return (this.state.me?.positions ?? []).filter((p) => p.market === this.state.market && p.side !== side).reduce((s, p) => s + p.quantity, 0);
  }
  /** True when tapping `side` takes micros off your opposite position instead of opening a hedge. */
  tapReduces(side: Side): boolean {
    const holdsSame = (this.state.me?.positions ?? []).some((p) => p.market === this.state.market && p.side === side);
    return this.state.opposite === "partial" && !holdsSame && this.heldAgainst(side) > 0;
  }
  /** `held`: the button is being held down, so don't start the 300 ms send timer;
   *  letting go calls armTaps, and a full order goes with sendTapsNow. */
  tap(side: Side, onDone: (err: string | null, qty: number, pnl?: number) => void, held = false) {
    const cur = this.state.pending;
    if (cur && cur.side !== side) this.flushTaps(onDone);
    const p = this.state.pending;
    const reduce = this.tapReduces(side);
    const cap = reduce ? this.heldAgainst(side) : 100;
    const count = Math.min(cap, (p && p.side === side ? p.count : 0) + this.state.qty);
    this.set({ pending: { side, count, reduce } });
    if (this.tapTimer) { clearTimeout(this.tapTimer); this.tapTimer = null; }
    if (!held) this.armTaps(onDone);
  }
  /** Send the collected taps 300 ms from now, unless another tap comes first. */
  armTaps(onDone: (err: string | null, qty: number, pnl?: number) => void) {
    if (this.tapTimer) clearTimeout(this.tapTimer);
    this.tapTimer = this.state.pending ? window.setTimeout(() => this.flushTaps(onDone), 300) : null;
  }
  /** Send the collected taps right away (holding a button filled an order). */
  sendTapsNow(onDone: (err: string | null, qty: number, pnl?: number) => void) { this.flushTaps(onDone); }
  /** Forget collected taps without sending them (after the server refused an order mid-hold). */
  dropTaps() { if (this.tapTimer) { clearTimeout(this.tapTimer); this.tapTimer = null; } if (this.state.pending) this.set({ pending: null }); }
  /** Tap orders sent but not answered yet. */
  ordersInFlight = 0;
  private flushTaps(onDone: (err: string | null, qty: number, pnl?: number) => void) {
    if (this.tapTimer) { clearTimeout(this.tapTimer); this.tapTimer = null; }
    const p = this.state.pending; if (!p) return;
    this.set({ pending: null });
    this.ordersInFlight++;
    const send = async () => {
      try {
        while (this.submitting) await new Promise((r) => setTimeout(r, 60));
        if (p.reduce) { const r = await this.reduce(p.side === "long" ? "short" : "long", p.count); this.ordersInFlight--; onDone(r.error ?? null, r.closed ?? 0, r.pnl); return; }
        const err = await this.open(p.side, p.count);
        this.ordersInFlight--;
        onDone(err, p.count);
      } catch (e) { this.ordersInFlight = Math.max(0, this.ordersInFlight - 1); onDone((e as Error).message, 0); }
    };
    void send();
  }

  async open(side: Side, quantity: number): Promise<string | null> {
    if (this.submitting) return "One order at a time.";
    const q = Math.round(quantity);
    if (!Number.isInteger(q) || q < 1 || q > 100) return "Pick 1 to 100 micros.";
    this.submitting = true;
    try {
      await this.api.rpc("open_position", { p_market: this.state.market, p_side: side, p_quantity: q });
      await this.refreshState();
      void this.refreshBoard();
      return null;
    } catch (e) { return (e as Error).message; }
    finally { this.submitting = false; }
  }

  /** Take `quantity` micros off your `side` stack on this market (newest orders first). */
  async reduce(side: Side, quantity: number): Promise<{ closed?: number; pnl?: number; error?: string }> {
    if (this.submitting) return { error: "One order at a time." };
    this.submitting = true;
    try {
      const r = await this.api.rpc<{ closed: number; pnl: number }>("reduce_position", { p_market: this.state.market, p_side: side, p_quantity: quantity });
      await this.refreshState();
      void this.refreshBoard();
      return { closed: r.closed, pnl: Number(r.pnl) };
    } catch (e) {
      const msg = (e as Error).message;
      return { error: /reduce_position|could not find the function|schema cache/i.test(msg) ? "Partials aren't switched on yet. Ask Sam to run the server update." : msg };
    } finally { this.submitting = false; }
  }

  /** Closes every leg of a stack; sums the P&L. Stops at the first error. */
  async closeStack(ids: string[]): Promise<{ pnl?: number; error?: string }> {
    let pnl = 0;
    for (const id of ids) { const r = await this.close(id); if (r.error) return { error: r.error, pnl }; pnl += r.pnl ?? 0; }
    return { pnl };
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
    this.bubbleRequest++;
    this.set({ squadId: id, leaderboard: [], feed: [], chat: [], chatUnread: 0, bubbles: [], bubbleScope: null });
    void this.refreshBubbles();
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

  setMarket(m: Market) { if (m === this.state.market) return; this.bubbleRequest++; write(MARKET_KEY, m); this.set({ market: m, bubbles: [], bubbleScope: null }); void this.refreshCandles(m); void this.refreshBubbles(); }

  async refreshBubbles() {
    if (this.state.phase !== "ready") return;
    const market = this.state.market;
    const squad = this.squad?.id ?? null;
    const request = ++this.bubbleRequest;
    try {
      const bubbles = await this.api.rpc<Bubble[]>("chart_bubbles", { p_market: market, p_squad: squad });
      if (request === this.bubbleRequest && this.state.market === market && this.squad?.id === (squad ?? undefined)) this.set({ bubbles, bubbleScope: `${market}:${squad ?? ""}` });
    } catch { /* keep last */ }
  }

  async buyBack() { await this.api.rpc("buy_back"); await this.refreshState(); }
  async refreshLifetime() { try { this.set({ lifetime: await this.api.rpc<Lifetime>("lifetime_stats") }); } catch { /* */ } }
  setCandleSeconds(s: number) { if (s === this.state.candleSeconds) return; write(FRAME_KEY, String(s)); this.set({ candleSeconds: s }); void this.refreshCandles(); }
  /** Walk down and back up the equipped frames, reversing at each end. */
  frameAfter() {
    const f = this.state.frames, i = f.indexOf(this.state.candleSeconds);
    if (f.length < 2) return f[0];
    const dir = i <= 0 ? 1 : i >= f.length - 1 ? -1 : this.frameDirection;
    return f[Math.max(0, i) + dir];
  }
  nextFrame() {
    const next = this.frameAfter();
    this.frameDirection = next > this.state.candleSeconds ? 1 : -1;
    this.setCandleSeconds(next);
  }
  /** Turn a timeframe on or off in your list (at least one stays on). */
  toggleFrame(s: number) {
    const cur = this.state.frames;
    const next = FRAME_OPTIONS.map((f) => f.s).filter((x) => (x === s ? !cur.includes(s) : cur.includes(x)));
    if (!next.length) return;
    write(FRAMES_KEY, JSON.stringify(next));
    this.set({ frames: next });
    if (!next.includes(this.state.candleSeconds)) this.setCandleSeconds(next[next.length - 1]);
  }

  async refreshCandles(m: Market = this.state.market) {
    try {
      const bars = await this.api.rpc<Candle[]>("candles", { p_market: m, p_bucket_seconds: this.state.candleSeconds, p_limit: 300 });
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


  // ---------- Global board, chat, feedback, events ----------
  async refreshGlobal() {
    try { this.set({ global: await this.api.rpc<GlobalBoard>("global_leaderboard", { p_limit: 50 }) }); } catch { /* keep last */ }
  }
  async setGlobalVisibility(show: boolean) {
    await this.api.rpc("set_global_visibility", { p_show: show });
    await this.refreshGlobal();
  }

  /** Open or close the squad chat sheet; opening clears any pop-up. */
  setChatOpen(open: boolean) { this.set(open ? { chatOpen: true, chatPop: null, chatUnread: 0 } : { chatOpen: false }); }
  dismissChatPop() { this.set({ chatPop: null }); }
  async refreshChat() {
    const squad = this.squad;
    if (!squad) return;
    try {
      const msgs = await this.api.rpc<ChatMsg[]>("squad_chat", { p_squad: squad.id, p_after: 0, p_limit: 50 });
      if (this.squad?.id !== squad.id) return;
      // Pop up messages that arrived since the last look (never the backlog on first load or squad switch).
      const lastSeen = this.chatSeen.get(squad.id);
      const newest = msgs.reduce((m, x) => Math.max(m, x.id), 0);
      const fresh = lastSeen === undefined ? [] : msgs.filter((x) => x.id > lastSeen && !x.is_you);
      this.chatSeen.set(squad.id, Math.max(newest, lastSeen ?? 0));
      const pop = fresh.length && !this.state.chatOpen ? fresh[fresh.length - 1] : null;
      const unread = fresh.length && !this.state.chatOpen ? this.state.chatUnread + fresh.length : this.state.chatUnread;
      this.set(pop ? { chat: msgs, chatPop: pop, chatUnread: unread } : { chat: msgs, chatUnread: unread });
      if (pop) { try { navigator.vibrate?.([15, 60, 15]); } catch { /* */ } }
    } catch { /* keep last */ }
  }
  async sendMessage(body: string, kind: "text" | "emoji" = "text"): Promise<string | null> {
    const squad = this.squad;
    if (!squad) return "Join a squad first.";
    try {
      await this.api.rpc("send_message", { p_squad: squad.id, p_body: body, p_kind: kind });
      void this.refreshChat();
      return null;
    } catch (e) { return (e as Error).message; }
  }

  async submitFeedback(kind: FeedbackKind, message: string): Promise<string | null> {
    try {
      await this.api.rpc("submit_feedback", { p_kind: kind, p_message: message, p_context: `web ${innerWidth}x${innerHeight} S${this.state.me?.season_number ?? ""}` });
      return null;
    } catch (e) { return (e as Error).message; }
  }

  async refreshEvents() {
    try {
      const events = await this.api.rpc<EventsFeed>("events_feed");
      this.set({ events });
      this.alertFor(events);
    } catch { /* keep last */ }
  }

  /** Flash once per event per phase. If several land together, the most important one wins; the strip shows the rest. */
  private alertFor(feed: EventsFeed) {
    const now = this.now();
    const rank = (e: EventItem, phase: string) => (phase === "live" ? 10 : 0) + (e.kind === "session" ? 0 : e.impact === "high" ? 3 : e.impact === "med" ? 2 : 1);
    let best: { score: number; flash: Flash } | null = null;
    for (const e of feed.active) {
      const phase = e.phase ?? "live";
      const key = `${e.id}:${e.at}:${phase}`;
      if (this.seen.has(key)) continue;
      this.seen.add(key);
      const age = now - Date.parse(e.at);
      if (phase === "live" && age > 120_000) continue;   // already underway when you opened the app
      const tone = e.kind === "session" ? "lime" : e.impact === "high" ? "red" : e.impact === "med" ? "gold" : "lime";
      const mins = Math.max(1, Math.round((Date.parse(e.at) - now) / 60_000));
      const flash: Flash = phase === "soon"
        ? { key, tone, title: `${e.title} in ${mins} min`, sub: e.body || "Tighten up. Volatility incoming." }
        : { key, tone, title: e.kind === "session" ? `${e.title}!` : `${e.title} is OUT`, sub: e.body || "Prices can jump. Watch your risk." };
      const score = rank(e, phase);
      if (!best || score > best.score) best = { score, flash };
    }
    write(SEEN_KEY, JSON.stringify([...this.seen].slice(-60)));
    if (best) this.raise(best.flash);
  }

  private raise(f: Flash) {
    this.set({ flash: f });
    try { navigator.vibrate?.([70, 40, 70]); } catch { /* unsupported */ }
  }
  dismissFlash() { this.set({ flash: null }); }

  async voiceCredentials(room: string) {
    const squad = this.squad;
    if (!squad) throw new BackendError("Join a squad to use voice.");
    return this.api.fn<{ url: string; token: string; room: string }>("voice-token", { squadId: squad.id, room });
  }
}

/** Merge two quote lists, keeping the newest per market. Returns `base` itself when nothing changed. */
export function newestQuotes(base: Quote[], incoming: Quote[]): Quote[] {
  let changed = false;
  const out = [...base];
  for (const q of incoming) {
    const i = out.findIndex((x) => x.market === q.market);
    if (i < 0) { out.push(q); changed = true; continue; }
    const cur = out[i];
    if (Date.parse(q.quoted_at) > Date.parse(cur.quoted_at) || (q.quoted_at === cur.quoted_at && q.price !== cur.price)) { out[i] = q; changed = true; }
  }
  return changed ? out : base;
}

export const game = new Game();
export function useGame(): GameState { return useSyncExternalStore(game.subscribe, game.get); }
