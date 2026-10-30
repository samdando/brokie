# Trading floor verification

Start an isolated preview from `web` with `VITE_SUPABASE_URL='' VITE_SUPABASE_ANON_KEY='' npm run dev -- --host 127.0.0.1`. Browser tests use synthetic accounts, block external requests and never execute live orders. They require Playwright and Chrome. Set `PLAYWRIGHT_MODULE` or `CHROME_PATH` when using a bundled runtime; `BASE_URL` selects a different local preview port. Restart the dev server after source edits before running fixtures, so Vite does not create differently versioned game-store imports.

- `node tests/social-floor.cjs`: main phone/fullscreen chart fit at 320/393/430px; balanced BUY/SELL; progressive account/risk; real squad activity and user-triggered reactions without opening chat; 1/10/100 size selection; Crypto charts and closed-session controls without prediction requests; optional feedback preferences; confirmed/rejected closes; empty/locked states; five-tab navigation. Saves `/tmp/brokie-social-*.png` previews.
- `node tests/pages-polish.cjs`: responsive Squad, Chat, Learn, You, profiles and onboarding; invitations, global-board visibility, messages/reactions, lesson progress and next lesson, receipt expansion and notes, cosmetic purchases, settings and empty states. Saves `/tmp/brokie-pages-*.png` previews.
- `node tests/chart-history.cjs`: opt-in history, compact entry pictures and individual side arrows, selected-only exact connectors, offscreen clipping, 200 overlapping fills and quiet-player access, complete group lists, saturated 600-fill layout, touch spacing, phone/fullscreen views and request-window races.
- `node tests/clean-floor.cjs`: size selection and timeframe keyboard input, batched 10/100 orders, pointer cancellation, Futures/Crypto navigation, saved profile colors and feedback preferences, DST/session-close notices, reduced motion and phone widths.
- `node tests/hold-smoke.cjs`: tap/hold batching, the five-orders-per-ten-seconds limit, release remainder, refusals and SELL. Takes about a minute.
- `node tests/upgrade-smoke.cjs`: fullscreen pan/zoom/manual price range, Live reset, navigation transitions, squad statistics and avatar purchases.
- `node tests/trading-summary.cjs`: account-wide P&L, hedges, missing/stale quotes and separate prediction tokens.

Run `npm run build` from `web` for the production artifact. The existing bundle-size warning is unchanged.

Run `npm test` from `backend/tests` for the complete disposable database and feed suite: token contracts and wallet isolation, cosmetic purchases, session boundaries and recorded closes, risk limits, server brackets and uncapped squad chart history. These checks never use production keys or databases. For chart-history rollout, apply `backend/chart_history.sql` after the existing Predictions/risk migrations before deploying a build to a database that does not already have it.

The other historical UI scripts predate the current progressive-disclosure layout. The checks above are the current floor regression set. Physical iOS gestures, microphone, audio and native haptics require device verification.
