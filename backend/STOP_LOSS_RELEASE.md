# Server stop-loss release · 28 October 2026

Status: prepared and tested locally; production migration and web deployment pending.

## Diagnosis

The previous web app kept SL/TP in `brokie.brackets` localStorage and called `closeStack()` only while the trading screen was mounted. Backgrounding, closing the app or switching screens could leave a stop unexecuted. There was no server record of the requested stop level.

The feed runs `ingest_quotes`; this migration processes confirmed SL/TP on each accepted newer quote before account loss checks. Each stack leg gets a receipt at the observed fill price, with `stop_loss` / `take_profit` reason and trigger price. Quotes, gaps and feed availability still determine execution. A price gap can legitimately cause a loss beyond the trigger.

All stack legs are updated atomically; added size inherits protection, and partial closes keep the remaining leg protected. The server journals edits and fills in the private `bracket_audit` table. No cash correction is made without evidence.

## Production accounts

At inspection, `fukotrades` and `jaoushai` were daily-locked with trading_day 2026-10-27 while trading_today() was 2026-10-28. Both were flat with no overdue settlement and cash above the maximum-loss floor:

- fukotrades: cash 95735.00, max-loss floor 92000.00.
- jaoushai: cash 127989.75, max-loss floor 123961.49.

A guarded SELECT calling `enforce_rules` for expired flat daily locks was submitted through Supabase. The Mac locked before its result could be verified. Do not claim the unlock succeeded until the live rows are checked. No reset or cash credit was submitted.

The new cron task refreshes expired daily locks every minute, including accounts with no open positions. Same-day daily locks and season failures remain enforced.

The user was asked for Fuko's missed-stop market, trigger price and approximate time. No answer yet. Those details or a device record are necessary for a defensible historical correction.

## Deployment order

1. Unlock the Mac and use the already signed-in Supabase SQL Editor for project `nchvildidonrzoipktjw`.
2. Verify account statuses and inspect current `ingest_quotes` / `my_state` before migration. The migration has guarded source patches and runs transactionally.
3. Apply `backend/server_brackets.sql` in full. Verify its functions, position columns, private audit table, cron job, and fresh quotes. Do not create test trades in production.
4. Verify `fukotrades` / `jaoushai` are active and their balances match the recorded balances, allowing only legitimate intervening trades.
5. Push the prepared web release to main, wait for GitHub Pages, and check the public assets/cache version.
6. Ask existing players to reopen the app. Valid device-only stops migrate when that device reconnects. Failed migrations produce a review warning and never appear as confirmed stops.

## Verification

- `npm --prefix backend/tests test` includes new `server-brackets.mjs`.
- `node web/tests/bracket-sync.cjs`
- `npm --prefix web run build`
- Local Vite + Playwright: `server-protection.cjs`, `mobile-polish.cjs`, `workspace-layout.cjs`, `ui-smoke.cjs`.

The tests use disposable SQL databases and synthetic browser accounts. Public production balances are not used as fixtures for transactions.
