/** Season rank tiers. Pure presentation over data every board already has:
 *  season return, account status, funded and the 5 qualifying trading days.
 *  Iron → Bronze → Silver → Gold → Platinum → Diamond → Legend (funded). */
export type TierId = "iron" | "bronze" | "silver" | "gold" | "platinum" | "diamond" | "legend";
export interface Tier { id: TierId; name: string; icon: string; color: string; min: number }

/** `min` is the season return (%) where the tier starts. Legend needs FUNDED, not just a number. */
export const TIERS: Tier[] = [
  { id: "iron", name: "Iron", icon: "◆", color: "#7D8792", min: -Infinity },
  { id: "bronze", name: "Bronze", icon: "◆", color: "#C98A5B", min: -4 },
  { id: "silver", name: "Silver", icon: "◆", color: "#C9D3DD", min: 0 },
  { id: "gold", name: "Gold", icon: "◆", color: "#F2CA73", min: 3 },
  { id: "platinum", name: "Platinum", icon: "◆", color: "#73E7C3", min: 6 },
  { id: "diamond", name: "Diamond", icon: "◇", color: "#7CC8FF", min: 10 },
  { id: "legend", name: "Legend", icon: "★", color: "#D6FE59", min: Infinity },
];

export interface RankInput { return_pct: number; status?: "active" | "locked" | "blown"; funded?: boolean; qualified?: boolean; trading_days?: number }
export interface Rank { tier: Tier; placing: boolean; days: number; next: Tier | null; toNext: number | null; progress: number }

const byId = (id: TierId) => TIERS.find((t) => t.id === id)!;

export function rankOf(r: RankInput): Rank {
  const days = Math.max(0, Math.min(5, r.trading_days ?? 0));
  const placing = r.qualified === false || (r.qualified == null && r.trading_days != null && r.trading_days < 5);
  const ret = Number.isFinite(r.return_pct) ? r.return_pct : 0;
  let tier: Tier;
  if (r.status === "blown") tier = byId("iron");
  else if (r.funded) tier = byId("legend");
  else tier = [...TIERS].reverse().find((t) => t.id !== "legend" && ret >= t.min)!;
  const i = TIERS.indexOf(tier);
  const next = r.status === "blown" || tier.id === "legend" ? null : TIERS[i + 1];
  // Diamond → Legend is about getting funded (5 days at +10%), not more return.
  const toNext = next && next.id !== "legend" ? Math.max(0, next.min - ret) : null;
  const lo = Number.isFinite(tier.min) ? tier.min : (next?.min ?? 0) - 4;
  const progress = next == null ? 1 : next.id === "legend" ? days / 5 : Math.max(0, Math.min(1, (ret - lo) / (next.min - lo)));
  return { tier, placing, days, next, toNext, progress };
}

/** Small tier chip for leaderboard rows and profiles. Placing ranks are shown faded with the day count. */
export function RankBadge({ r, compact }: { r: RankInput; compact?: boolean }) {
  const k = rankOf(r);
  const label = k.placing ? `${k.tier.name} · placing ${k.days}/5` : k.tier.name;
  return (
    <span className={`rank-badge ${k.placing ? "placing" : ""} ${compact ? "compact" : ""}`} style={{ ["--tier" as string]: k.tier.color }}
      data-testid="rank-badge" data-tier={k.tier.id} title={`${label} rank`} aria-label={`${label} rank`}>
      <i aria-hidden="true">{k.tier.icon}</i>{compact ? null : <span>{k.tier.name}</span>}
    </span>
  );
}

/** Your rank on the You page: tier, progress bar and what the next tier needs. */
export function RankCard({ r }: { r: RankInput }) {
  const k = rankOf(r);
  const need = k.next == null ? (k.tier.id === "legend" ? "Top tier. Hold it to the end of the season." : "Account closed. Use your restart to climb again.")
    : k.next.id === "legend" ? `Get FUNDED for Legend · ${k.days}/5 trading days`
    : `+${(k.toNext ?? 0).toFixed(2)}% more for ${k.next.name}`;
  return (
    <section className="rank-card" style={{ ["--tier" as string]: k.tier.color }} data-testid="rank-card" data-tier={k.tier.id}>
      <div className="rank-card-top">
        <span className="rank-card-icon" aria-hidden="true">{k.tier.icon}</span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="eyebrow">Season rank{k.placing ? ` · placing ${k.days}/5 days` : ""}</div>
          <b>{k.tier.name}</b>
        </div>
        {k.next && <span className="rank-card-next" style={{ ["--next" as string]: k.next.color }}>{k.next.icon} {k.next.name}</span>}
      </div>
      <div className="rank-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(k.progress * 100)} aria-label="Progress to next rank"><i style={{ width: `${Math.round(k.progress * 100)}%` }} /></div>
      <small className="muted">{k.placing ? "Provisional until you've traded 5 days. " : ""}{need}</small>
      <div className="rank-ladder" aria-hidden="true">{TIERS.map((t) => <span key={t.id} className={t.id === k.tier.id ? "on" : ""} style={{ ["--t" as string]: t.color }} title={t.name}>{t.icon}</span>)}</div>
    </section>
  );
}
