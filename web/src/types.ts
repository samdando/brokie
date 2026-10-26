export type Market = "gold" | "nas" | "es" | "us30" | "btc" | "eth" | "sol" | "prediction";
export type Side = "long" | "short";

export const MARKETS: Record<Market, { title: string; subtitle: string; symbol: string; pointValue: number; tick: number; color: string }> = {
  gold: { title: "Gold", subtitle: "Micro Gold", symbol: "MGC", pointValue: 10, tick: 0.1, color: "#F2CA73" },
  nas: { title: "NAS", subtitle: "Micro Nasdaq-100", symbol: "MNQ", pointValue: 2, tick: 0.25, color: "#D6FE59" },
  es: { title: "ES", subtitle: "Micro S&P 500", symbol: "MES", pointValue: 5, tick: 0.25, color: "#B5A0FE" },
  us30: { title: "US30", subtitle: "Micro Dow", symbol: "MYM", pointValue: 0.5, tick: 1, color: "#7CC8FF" },
  prediction: { title: "Prediction", subtitle: "Yes / No paper contracts", symbol: "KALSHI", pointValue: 1, tick: 0.0001, color: "#7CC8FF" },
  btc: { title: "BTC", subtitle: "Paper Bitcoin · 0.01 BTC / micro", symbol: "BTC-USD", pointValue: 0.01, tick: 0.01, color: "#F2A94B" },
  eth: { title: "ETH", subtitle: "Paper Ethereum · 0.1 ETH / micro", symbol: "ETH-USD", pointValue: 0.1, tick: 0.01, color: "#B5A0FE" },
  sol: { title: "SOL", subtitle: "Paper Solana · 1 SOL / micro", symbol: "SOL-USD", pointValue: 1, tick: 0.01, color: "#73E7C3" },
};
/** Decimal places worth showing for a market's price (the Dow trades in whole points). */
export const digits = (m: Market) => (MARKETS[m].tick >= 1 ? 0 : 2);

export interface PredictionFields { prediction_id?: string; prediction_outcome?: "yes" | "no"; prediction_question?: string; mark_price?: number }
export interface Position extends PredictionFields { id: string; market: Market; side: Side; quantity: number; entry_price: number; opened_at: string }
export interface Trade extends PredictionFields {
  id: string; market: Market; side: Side; quantity: number; entry_price: number; exit_price: number;
  pnl: number; opened_at?: string; closed_at: string; reason: string;
}
export interface Quote { market: Market; price: number; quoted_at: string }
export interface Rules {
  status: "active" | "locked" | "blown"; start_balance: number; peak_equity: number; day_start_equity: number;
  daily_loss_amount?: number | null; daily_loss_pct: number; max_dd_pct: number; daily_floor: number; drawdown_floor: number; target: number;
  /** "eod": the max loss floor sits under your best end-of-day balance (dd_base). "trailing": under the intraday peak. */
  dd_mode?: "eod" | "trailing"; dd_base?: number;
  /** Funded = +10% target AND the qualifying trading days. target_hit = reached +10% at some point this season. */
  funded: boolean; target_hit?: boolean; resets_used: number; trading_days: number; qualify_days: number; equity: number;
}
export interface MyState {
  handle: string; season: string; season_number?: number; rules?: Rules; season_ends_at: string; server_time: string; cash: number;
  protection_credit: number; liquidations: number; has_backup_code?: boolean;
  positions: Position[]; trades: Trade[]; quotes: Quote[];
}
export interface Squad { id: string; name: string; invite_code: string; owner_id: string; member_count: number }
export interface LeaderRow {
  today_pnl?: number;
  handle: string; is_you: boolean; equity: number; return_pct: number; trades: number; worst_trade: number; open_positions: number;
  status?: "active" | "locked" | "blown"; funded?: boolean; target_hit?: boolean; resets_used?: number; trading_days?: number; qualified?: boolean;
  wins?: number; losses?: number;
}
export interface Bubble extends PredictionFields {
  state: "open" | "closed"; id: string; handle: string; is_you: boolean; side: Side; quantity: number; entry_price: number;
  exit_price: number | null; pnl: number | null; reason: string | null; at: string; opened_at: string;
  size_pct: number | null; dd_floor: number | null; equity: number | null;
}
export interface Lifetime {
  handle: string; total_trades: number; win_rate: number | null; avg_win: number | null; avg_loss: number | null; best_trade: number | null;
  seasons_played: number; seasons_blown: number; seasons_funded: number; max_drawdown: number;
  seasons: { season: string; number: number; return_pct: number; status: string; funded: boolean }[];
}
export interface FeedEvent {
  kind: "opened" | "closed" | "rekt" | "funded"; id: string; handle: string; is_you: boolean; market: Market; side: Side;
  quantity: number; price: number; pnl: number | null; reason: string | null; at: string;
}
export interface GlobalRow {
  today_pnl?: number;
  rank: number; handle: string; is_you: boolean; equity: number; return_pct: number; status: "active" | "locked" | "blown";
  funded: boolean; qualified: boolean; trading_days: number; trades: number; show_global?: boolean;
}
export interface GlobalBoard { rows: GlobalRow[]; me: GlobalRow | null; players: number; season: string }
export interface ChatMsg { id: number; handle: string; is_you: boolean; kind: "text" | "emoji"; body: string; at: string }
export type FeedbackKind = "bug" | "idea" | "love" | "other";
export interface EventItem {
  id: string; kind: "econ" | "news" | "season" | "session"; impact: "low" | "med" | "high"; title: string; body: string | null;
  market: Market | null; at: string; phase?: "soon" | "live"; ends_at?: string;
}
export interface EventsFeed { active: EventItem[]; upcoming: EventItem[]; server_time: string }
export interface Flash { key: string; tone: "lime" | "red" | "gold"; title: string; sub: string }
export interface Candle { index: number; open: number; high: number; low: number; close: number }

export const direction = (s: Side) => (s === "long" ? 1 : -1);
export const pnlOf = (p: Position, mark: number) => ((p.market === "prediction" ? p.mark_price ?? p.entry_price : mark) - p.entry_price) * MARKETS[p.market].pointValue * p.quantity * direction(p.side);

export interface SharedReceipt { handle: string; trade: Trade; candles?: Candle[]; bucket_seconds?: number }
