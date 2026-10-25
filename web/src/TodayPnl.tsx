import { signedMoney } from "./ui";
export function TodayPnl({ value }: { value?: number }) {
  return <span className={`today-pnl ${value == null || value === 0 ? "muted" : value > 0 ? "lime" : "red"}`} title="Closed-trade P&L this session. Resets at 5pm New York." data-testid="today-pnl">Today {value == null ? "—" : signedMoney(value)}</span>;
}
