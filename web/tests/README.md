# Mobile UI smoke check

Start `npm run dev -- --host 127.0.0.1` from `web`, then run `node tests/ui-smoke.cjs` in another terminal. The check requires Playwright and Chrome; `PLAYWRIGHT_MODULE` can point to an existing Playwright installation. It uses a fresh browser profile, an unconfigured development build and synthetic account state. Run without production environment variables.

Checks 320, 393 and 430 pixel widths, horizontal overflow, Buy/Sell placement, risk disclosure, chart info, squad management and chat, grouped feed expansion, completed lessons, disabled trading during lockout, history navigation, receipt details, lifetime stats and browser exceptions. Screenshots are written to `/tmp/brokie-*.png`.

This is a UI regression check, not a live backend, order execution, microphone or physical iOS Safari test.
