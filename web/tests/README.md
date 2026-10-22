# Mobile UI smoke check

Start `npm run dev -- --host 127.0.0.1` from `web`, then run `node tests/ui-smoke.cjs` in another terminal. The check requires Playwright and Chrome; `PLAYWRIGHT_MODULE` can point to an existing Playwright installation. It uses a fresh browser profile, an unconfigured development build and synthetic account state. Run without production environment variables.

Checks 320, 393 and 430 pixel widths, horizontal overflow, Buy/Sell placement, risk disclosure, chart info, squad management and chat, grouped feed expansion, completed lessons, disabled trading during lockout, history navigation, receipt details, lifetime stats and browser exceptions. Screenshots are written to `/tmp/brokie-*.png`.

This is a UI regression check, not a live backend, order execution, microphone or physical iOS Safari test.

`node tests/motion-smoke.cjs` uses the same local server and Playwright setup. It checks BUY/SELL bursts, rapid taps, keyboard input, exact live-value updates, animation cleanup, combo tiers and expiry, direction/market/order-mode resets, capped and rejected inputs, disabled input, reduced-motion preferences, overflow and controller placement. Order submission is replaced with a local call recorder.

The UI check now covers 8 screen sizes (320×568 up to 1440×900), fullscreen chart scroll lock and restore, the season timer, tap-your-pill entry details, the position pill pinning to the chart edge when zoomed, and W/L on the squad board. Without Chrome installed, point `CHROME_PATH` at any Chromium (e.g. Playwright's headless shell).

Backend rule checks: load `supabase_stub, schema, seasons_v2, v3, partials, trading_day, trade_sharing, rules_v4`, then run `backend/tests_rules_v4.sql` (25 checks: 8% MLL from the end-of-day high, intraday breach, trailing hard mode, buy-back restarting qualifying, W/L, rerunnable migration).
