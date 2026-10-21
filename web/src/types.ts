export type Market = "gold" | "nas" | "es";
export type Side = "long" | "short";

export const MARKETS: Record<Market, { title: string; subtitle: string; symbol: string; pointValue: number; tick: number; color: string }> = {
  gold: { title: "Gold", subtitle: "Micro Gold", symbol: "MGC", pointValue: 10, tick: 0.1, color: "#F2CA73" },
  nas: { title: "NAS", subtitle: "Micro Nasdaq-100", symbol: "MNQ", pointValue: 2, tick: 0.25, color: "#D6FE59" },
  es: { title: "ES", subtitle: "Micro S&P 500", symbol: "MES", pointValue: 5, tick: 0.25, color: "#B5A0FE" },
};

export interface Position { id: string; market: Market; side: Side; quantity: number; entry_price: number; opened_at: string }
export interface Trade {
  id: string; market: Market; side: Side; quantity: number; entry_price: number; exit_price: number;
  pnl: number; closed_at: string; reason: string;
}
export interface Quote { market: Market; price: number; quoted_at: string }
export interface MyState {
  handle: string; season: string; season_ends_at: string; server_time: string; cash: number;
  protection_credit: number; liquidations: number; has_backup_code?: boolean;
  positions: Position[]; trades: Trade[]; quotes: Quote[];
}
export interface Squad { id: string; name: string; invite_code: string; owner_id: string; member_count: number }
export interface LeaderRow {
  handle: string; is_you: boolean; equity: number; return_pct: number; trades: number; worst_trade: number; open_positions: number;
}
export interface FeedEvent {
  kind: "opened" | "closed"; id: string; handle: string; is_you: boolean; market: Market; side: Side;
  quantity: number; price: number; pnl: number | null; reason: string | null; at: string;
}
export interface Candle { index: number; open: number; high: number; low: number; close: number }

export const direction = (s: Side) => (s === "long" ? 1 : -1);
export const pnlOf = (p: Position, mark: number) => (mark - p.entry_price) * MARKETS[p.market].pointValue * p.quantity * direction(p.side);
