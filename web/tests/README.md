# Trading floor verification

The 31 October focus pass makes Brokie's own canvas chart (`src/ArcadeChart.tsx`, `src/FocusFloor.tsx`) the default Trade page. `node tests/focus-floor.cjs` covers full-screen fit at 320/393/430px, hold top = BUY / bottom = SELL, slide for 1:1 TP/SL saved to the server, taps never trading, hold to cash out, real CDP touch page swipes (chart, content, buttons, back) and vertical scrolls being ignored, and the classic-layout toggle. The older floor tests pin `brokie.layout=classic` with an init script.

The 31 October terminal pass adds `npm run test:indicators` and a local-only `/tests/terminal-preview.html` route with synthetic accounts and mocked operations. Chat is now a page in Trade → Chat → Squad → Learn → You order. Page swipes work over the preview chart and content cards; swipe-to-close is confined to the P&L bar. See `docs/SETUP_RUSH_REFERENCE.md` for the verified browser matrix and remaining device checks.

Start an isolated preview from `web` with `VITE_SUPABASE_URL='' VITE_SUPABASE_ANON_KEY='' npm run dev -- --host 127.0.0.1`. Browser tests use synthetic accounts, block external requests and never execute live orders. They require Playwright and Chrome. Set `PLAYWRIGHT_MODULE` or `CHROME_PATH` when using a bundled runtime; `BASE_URL` selects a different local preview port. Restart the dev server after source edits before running fixtures, so Vite does not create differently versioned game-store imports.

- `node tests/fullscreen-exit.cjs`: repeated fullscreen exits at 320/393/430px without switching tabs, changing viewport heights, safe-area padding, position sheets, preserved scroll/styles and reduced motion; preview and bottom controls remain visible.
- `node tests/eod-floor.cjs`: authoritative fixed EOD allowance/cap, season buffer separated from daily loss room, EOD-only explanation and mobile fit.
- `node tests/trade-exits.cjs`: close gestures, displayed-market scope, cancellations and changed positions, pending/error handling, hedge choice, explicit price/dollar targets and season-status visibility.
- `node tests/protection.cjs`: long/short dollar conversion, stack size, market point values, real tick rounding and invalid targets.
- `node tests/server-protection.cjs` and `node tests/bracket-sync.cjs`: confirmed server saves, failed-save preservation, cancellation, cross-device sync and legacy migration.
- `node tests/social-floor.cjs`: main phone/fullscreen chart fit at 320/393/430px; balanced BUY/SELL; progressive account/risk; real squad activity and user-triggered reactions without opening chat; 1/10/100 size selection; Crypto charts and closed-session controls without prediction requests; optional feedback preferences; confirmed/rejected closes; empty/locked states; five-tab navigation. Saves `/tmp/brokie-social-*.png` previews.
- `node tests/pages-polish.cjs`: responsive Squad, Chat, Learn, You, profiles and onboarding; shared avatar/Chat identity colours update after profile changes; invitations, global-board visibility, messages/reactions, lesson progress and next lesson, receipt expansion and notes, cosmetic purchases, settings and empty states. Saves `/tmp/brokie-pages-*.png` previews.
- `node tests/chart-history.cjs`: opt-in history, compact entry pictures and individual side arrows, selected-only exact connectors, offscreen clipping, 200 overlapping fills and quiet-player access, complete group lists, saturated 600-fill layout, touch spacing, phone/fullscreen views and request-window races.
- `node tests/clean-floor.cjs`: size selection and timeframe keyboard input, batched 10/100 orders, pointer cancellation, Futures/Crypto navigation, saved profile colors and feedback preferences, DST/session-close notices, reduced motion and phone widths.
- `node tests/hold-smoke.cjs`: tap/hold batching, the five-orders-per-ten-seconds limit, release remainder, refusals and SELL. Takes about a minute.
- `node tests/upgrade-smoke.cjs`: fullscreen pan/zoom/manual price range, Live reset, navigation transitions, squad statistics and avatar purchases.
- `node tests/trading-summary.cjs`: account-wide P&L, hedges, missing/stale quotes and separate prediction tokens.

Run `npm run build` from `web` for the production artifact. The existing bundle-size warning is unchanged.

Run `npm test` from `backend/tests` for the complete disposable database and feed suite: token contracts and wallet isolation, cosmetic purchases, session boundaries and recorded closes, risk limits, server brackets, uncapped squad chart history, and the fixed-dollar EOD floor with its starting-balance cap and guarded admin repair. These checks never use production keys or databases. For chart-history rollout, apply `backend/chart_history.sql` after the existing Predictions/risk migrations before deploying a build to a database that does not already have it.

The other historical UI scripts predate the current progressive-disclosure layout. The checks above are the current floor regression set. Physical iOS gestures, microphone, audio and native haptics require device verification.


31 October bracket repair: `node tests/api-timeout.cjs` checks aborts for stalled RPC requests and response bodies. `focus-floor.cjs` also covers hold-preview scale feedback at the bottom edge, delayed/rejected level saves, axis-tag touch dragging, no-op taps, touch cancellations, pinch interruptions, five-second hints and return-to-Trade hints. Restart Vite after source edits before running browser fixtures: importing `/src/game.ts` must use the same module instance as App, without stale HMR timestamps.
