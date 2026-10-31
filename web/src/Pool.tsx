import { useEffect, useState } from "react";
import { game, useGame } from "./game";
import { Button, Eyebrow, Sheet } from "./ui";
import type { PoolInfo, PoolRow } from "./types";
import { nativeApp } from "./config";

/** The $1 pool. Pay one $1 entry (USDC on Base, or PayID / cash to Sam), your season account
 *  restarts at $100k on HARD MODE, and the pool is split by % return at the end of the season.
 *  Everything here mirrors the server (pool.sql); the app never touches money itself. */
export function PoolCard() {
  const st = useGame();
  const pool = st.pool;
  const [open, setOpen] = useState(false);
  useEffect(() => { if (!nativeApp) void game.refreshPool(); }, []);
  // Paid entries never appear in the iOS app (App Store rules on real-money contests).
  if (!pool || nativeApp) return null;
  const { config, entry, standings } = pool;
  const inPool = pool.tier === "pool" && entry?.status === "paid";
  const me = standings.rows.find((r) => r.is_you);
  const status = inPool ? (me?.eligible ? `In the running · ${fmtUsd(me.payout)} right now` : me?.status === "blown" ? "Account closed · out of the running" : me && !me.qualified ? `Trading ${me.trading_days}/${standings.min_days} days` : "In · need a positive return")
    : entry?.status === "pending" ? (entry.rail === "usdc" ? "Waiting for your 1 USDC" : "Waiting for Sam to confirm") : config.open ? `${fmtUsd(standings.total)} pool · ${standings.entries} in` : "Opens soon";
  return (
    <>
      <button type="button" className={`pool-card ${inPool ? "in" : ""}`} onClick={() => setOpen(true)} data-testid="pool-card">
        <span className="pool-coin" aria-hidden="true">$</span>
        <span className="pool-text"><b>{inPool ? "Hard mode · $1 pool" : "$1 pool"}</b><small>{status}</small></span>
        <span className="pool-chevron" aria-hidden="true">›</span>
      </button>
      <Sheet open={open} onClose={() => setOpen(false)}><PoolSheet pool={pool} onClose={() => setOpen(false)} /></Sheet>
    </>
  );
}

function PoolSheet({ pool, onClose }: { pool: PoolInfo; onClose: () => void }) {
  const { config, entry, standings } = pool;
  const inPool = pool.tier === "pool" && entry?.status === "paid";
  const [rail, setRail] = useState<"usdc" | "payid">(entry?.rail === "payid" ? "payid" : config.usdc_treasury ? "usdc" : "payid");
  const [wallet, setWallet] = useState(entry?.wallet ?? "");
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const copy = async (what: string, text: string) => { try { await navigator.clipboard.writeText(text); setCopied(what); setTimeout(() => setCopied(null), 1500); } catch { setErr("Couldn't copy. Long-press to copy it instead."); } };
  const r = config.rules;
  const rules = <ul className="pool-rules">
    <li><b>{r.daily_loss_pct}%</b> daily loss limit</li>
    <li><b>{r.max_dd_pct}%</b> max loss, trailing your peak intraday</li>
    <li><b>{r.max_qty}</b> micros open at once</li>
    <li><b>No</b> restart. Blow it and your pool run is over</li>
    <li><b>+{r.target_pct}%</b> and {config.min_days} trading days to qualify</li>
  </ul>;
  const act = async (fn: () => Promise<void>) => { setBusy(true); setErr(null); try { await fn(); } catch (e) { setErr((e as Error).message); } setBusy(false); };
  return (
    <div className="stack" style={{ gap: 18 }} data-testid="pool-sheet">
      <div className="row between"><Eyebrow>$1 pool · Season {standings.season_number}</Eyebrow><button className="text-action" onClick={onClose}>Done</button></div>
      <PoolTotal s={standings} />

      {inPool ? <>
        <div className="pool-in"><b>You're in. Hard mode is on.</b><small>Your account restarted at $100k when your entry landed{entry?.paid_at ? ` (${new Date(entry.paid_at).toLocaleDateString()})` : ""}.</small>{rules}</div>
      </> : entry?.status === "pending" ? <>
        {entry.rail === "usdc" ? <div className="pool-step" data-testid="pool-pending">
          <b>Send exactly {config.entry_usd} USDC on Base</b>
          <small>From <span className="mono">{short(entry.wallet!)}</span> to the Brokie treasury. We check the chain every minute; your account restarts on hard mode the moment it lands.{entry.amount != null && entry.amount < config.entry_usd ? ` Got ${entry.amount} so far, need ${config.entry_usd}.` : ""}</small>
          <div className="pool-address mono" data-testid="pool-treasury">{config.usdc_treasury}</div>
          <div className="row" style={{ gap: 8 }}><Button variant="ghost" onClick={() => copy("addr", config.usdc_treasury!)}>{copied === "addr" ? "Copied ✓" : "Copy address"}</Button><Button variant="ghost" onClick={() => copy("amt", String(config.entry_usd))}>{copied === "amt" ? "Copied ✓" : `Copy ${config.entry_usd}`}</Button></div>
          <small className="muted">Base network only. USDC sent on another chain, or from a different wallet, won't be seen.</small>
        </div> : <div className="pool-step" data-testid="pool-pending">
          <b>Pay ${config.entry_usd} to Sam</b>
          <small>PayID <span className="mono">{config.payid}</span> with your handle as the description, or hand it over in person. Sam confirms it and your account restarts on hard mode.</small>
          {config.payid && <Button variant="ghost" onClick={() => copy("payid", config.payid!)}>{copied === "payid" ? "Copied ✓" : "Copy PayID"}</Button>}
        </div>}
        <button className="text-action muted" disabled={busy} onClick={() => act(() => game.leavePool())} data-testid="pool-leave">Changed my mind</button>
      </> : <>
        <div className="stack" style={{ gap: 6 }}><b style={{ fontSize: 15 }}>One $1 entry. One hard-mode account.</b><small className="muted">The pool is split by season return among everyone still standing. Make the most, take the most. Nobody in profit, and it rolls into next season.</small>{rules}</div>
        {config.open ? <>
          <div className="seg" role="radiogroup" aria-label="How to pay">
            {config.usdc_treasury && <button type="button" role="radio" aria-checked={rail === "usdc"} className={`seg-btn ${rail === "usdc" ? "on" : ""}`} onClick={() => setRail("usdc")}>1 USDC on Base</button>}
            {config.payid && <button type="button" role="radio" aria-checked={rail === "payid"} className={`seg-btn ${rail === "payid" ? "on" : ""}`} onClick={() => setRail("payid")}>PayID / cash</button>}
          </div>
          {rail === "usdc" ? <div className="stack" style={{ gap: 8 }}><b style={{ fontSize: 13 }}>The wallet you'll send from</b>
            <input className="field mono" value={wallet} placeholder="0x…" autoCapitalize="none" autoCorrect="off" spellCheck={false} inputMode="text" onChange={(e) => setWallet(e.target.value.trim())} data-testid="pool-wallet" />
            <small className="muted">Base address, 0x + 40 characters. We match your payment by this wallet, so send from it, not from an exchange.</small></div>
            : <small className="muted">You'll get Sam's PayID on the next step. Cash in hand works too.</small>}
          <label className="pool-agree"><input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} data-testid="pool-agree" /><span>I get it: when my entry lands, this season's account <b>restarts at $100k on hard mode</b>, open positions close, and entries aren't refundable.</span></label>
          <Button busy={busy} disabled={!agree || (rail === "usdc" && !/^0x[0-9a-fA-F]{40}$/.test(wallet))} onClick={() => act(() => game.joinPool(rail, rail === "usdc" ? wallet : undefined))} id="pool-join">{rail === "usdc" ? "Next: send 1 USDC" : "Next: pay Sam $1"}</Button>
        </> : <small className="muted">Sam hasn't opened entries yet. Hard mode and the pool go live when he sets a treasury wallet or PayID.</small>}
      </>}
      {err && <div className="err" role="alert">{err}</div>}

      <div className="stack" style={{ gap: 8 }}>
        <div className="row between"><h3 className="h3" style={{ fontSize: 15 }}>Standings</h3><span className="section-caption">{standings.entries} in · {100 - config.house_pct}% paid out</span></div>
        {standings.rows.length === 0 && <small className="muted">Nobody's in yet. First in sets the pace.</small>}
        {standings.rows.map((x) => <StandingRow key={x.handle} x={x} minDays={standings.min_days} />)}
      </div>
      <small className="muted" style={{ fontSize: 10, lineHeight: 1.5 }}>Friends-only test. {config.house_pct}% of entries keeps the lights on. Payouts are sent by hand after the season ends, to the wallet or PayID you entered with. Paper trading only: no real positions are ever opened.</small>
    </div>
  );
}

function PoolTotal({ s }: { s: PoolInfo["standings"] }) {
  return (
    <div className="pool-total" data-testid="pool-total">
      <strong>{fmtUsd(s.total)}</strong>
      <span>in the pool{s.rollover > 0 ? ` · ${fmtUsd(s.rollover)} rolled over` : ""} · {s.entries} {s.entries === 1 ? "entry" : "entries"}</span>
    </div>
  );
}

function StandingRow({ x, minDays }: { x: PoolRow; minDays: number }) {
  const note = x.status === "blown" ? "closed" : !x.qualified ? `${x.trading_days}/${minDays} days` : x.eligible ? `${x.share_pct}%` : "no gain";
  return (
    <div className={`pool-row ${x.eligible ? "eligible" : ""}`} data-testid="pool-row">
      <span className="pool-handle">{x.is_you ? "You" : `@${x.handle}`}</span>
      <span className={`mono ${x.return_pct >= 0 ? "lime" : "red"}`}>{x.return_pct >= 0 ? "+" : ""}{x.return_pct.toFixed(2)}%</span>
      <span className="pool-note muted">{note}</span>
      <span className={`mono pool-payout ${x.eligible ? "lime" : "muted"}`}>{x.eligible ? fmtUsd(x.payout) : "—"}</span>
    </div>
  );
}

/** Small 💵 chip for leaderboard rows of players with a paid entry. */
export function PoolChip({ handle }: { handle: string }) {
  const st = useGame();
  if (nativeApp || !st.pool || !game.poolHandles.has(handle)) return null;
  return <span className="pool-chip" title="In the $1 pool · hard mode" aria-label="In the $1 pool, hard mode" data-testid="pool-chip">$</span>;
}

const fmtUsd = (n: number) => `$${Number(n).toFixed(2)}`;
const short = (w: string) => `${w.slice(0, 6)}…${w.slice(-4)}`;
