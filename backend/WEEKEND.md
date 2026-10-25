# Weekend crypto and additional prediction markets

Crypto stays alongside predictions. BTC, ETH and SOL replace the weekday ticker row from Friday 17:00 to Sunday 18:00 America/New_York. Weekday gold, NAS, ES and US30 remain. Predictions use Kalshi public quotes and a separate token wallet, with per-event Yes/No positions. No real orders or wallets are involved.

## Apply to an existing deployment

1. Run `weekend_markets.sql` and commit it separately (new Postgres enum values).
2. Run `weekend.sql`, then `predictions.sql`, then `prediction_tokens.sql` in that order. Always finish with the token migration; earlier migrations define the legacy paper-dollar functions. The token migration refuses to proceed if any legacy prediction positions or receipts need reconciliation.
3. Deploy `functions/crypto-quotes/index.ts` as `crypto-quotes` and `functions/prediction-quotes/index.ts` as `prediction-quotes`. These check the existing private cron secret themselves, like the existing ingest function. Service keys remain server-side. The original OANDA function is unchanged.
4. Apply `weekend_cron.sql`, `crypto_cron.sql`, `prediction_cron.sql` after deploying the functions. These reuse the existing private ingest URL/cron secret. Keep JWT verification enabled on both functions and store the project's existing legacy anon JWT as `brokie_private.edge_anon_jwt`; the jobs send it in the Authorization header. Do not commit credentials.
5. Verify new quotes, prediction market snapshots, cron responses and `select settle_market_closes();` before publishing the web build.

Do not run test fixtures against production. `repair_bum_market_close.sql` records the guarded repair already applied; it is not a general migration.

## Verification

From `backend/tests`: `npm ci && npm test`. The disposable PGlite database runs the migrations twice and covers session boundaries/DST, historical close marks, pending missing marks, exactly-once settlement, daily receipts/privacy, review ownership, prediction bids/asks/margin, payouts and reopening protection, daily token rewards, duplicate claims/settlement, wallet ownership, and competition isolation. Feed parser checks reject stale/invalid data and tentative outcomes. No live keys or database access are used.

From `web`: `npm ci && npm run build`. To preview fixtures independently of live accounts, start Vite with `VITE_SUPABASE_URL='' VITE_SUPABASE_ANON_KEY='' npm run dev` and open `/tests/weekend-preview.html`.

## Pricing and settlement

Crypto prices come from Coinbase ticker timestamps. New orders require fresh quotes. Flat-at-close settlement uses the last recorded tick/one-minute bar at or before the session deadline, within five minutes. Missing marks remain pending for investigation instead of fabricating a closing price. A database job runs even when no clients or quotes are connected.

Prediction entry uses the chosen outcome ask, exit uses its bid, and only an official finalized/settled outcome produces a final payout. Tentative results stay pending. Open events stay on the feed watchlist until settlement. Each prediction debits its stake from the separate token wallet. The first successful entry or manual exit each trading day earns 1 token, shared across all competition markets and seasons. Automatic exits and prediction trades do not earn rewards. Players who traded earlier on installation day receive that day’s token. Wallets and predictions persist across competition resets and season changes. Prediction balances, positions and receipts never enter competition cash, margin, qualifying days, risk rules or rankings. Stake whole tokens (1–1,000); fractional shares and payouts round down to six decimal places. Tokens have no cash value. Voided/scalar final payouts use the provider's official value.

Today badges use closed P&L in the existing 17:00 New York trading-day boundary; ranks and layout stay unchanged. Private review notes are readable/writable only by the receipt owner.
