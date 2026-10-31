# Brokie visual reference · 31 October 2026

Reviewed the supplied five screenshots, [Setup Rush's website](https://setuprush.com/), its [play screen](https://setuprush.com/play), and [documentation](https://setuprush.com/docs/). The current public website describes recorded crypto candles with simulated trades. The supplied screenshots show a dark chart, white/red candles, a compact P&L panel, market-structure boxes, pattern callouts and direct trading controls.

Following the user's clarification, this implementation carries those chart and interface ideas into Brokie's existing paper-trading product. Brokie retains its accounts, contract sizing, season risk rules, server orders, stop loss/take profit, squad activity, voice, chat, learning and receipts.

Implemented:

- Charcoal surfaces, white/red candles, an orange market-lens accent, compact controls and clear buy/sell colours.
- EMA 20/50, Bollinger 20/2, confirmed swing breaks (BOS/CHoCH), liquidity sweeps, unfilled three-candle fair value gaps and five closed-candle pattern reads. Clean, Structure and Momentum presets persist locally.
- A page deck in Trade → Chat → Squad → Learn → You order. Horizontal gestures follow the pointer; short gestures return, vertical gestures scroll, content cards can swipe without opening, and tabs remain available. Chat is now a page and retains unread handling.
- The P&L bar remains the explicit swipe-to-close surface. Fullscreen reserves chart gestures for navigation within the chart. Order controls, form inputs, sheets, trade markers and size/timeframe rails do not trigger page swipes.
- A chart recreation fix that reloads complete candle history instead of tweening one candle into an empty series.

All overlays use chart data and closed candles. Pivots require two later closed candles. Gap detection excludes missing buckets, and fully filled gaps are removed. Candle reads cover bullish/bearish engulfing, hammer, shooting star and doji. The feed does not provide volume in its candle model, so this change does not fabricate a volume indicator.

Validation: production TypeScript/Vite build; `npm run test:indicators`; local browser checks of all five page swipes, reverse navigation, short-swipe cancellation, indicator presets/persistence and fullscreen gesture isolation. Repeated fullscreen exits and chart/order/nav fit checked at 320×568, 393×852 and 430×932. Browser touch-event injection is unsupported in this browser; physical iPhone gestures remain to be checked on device.

`web/tests/terminal-preview.html` is a local-only Vite preview with synthetic data and mocked operations. It does not connect to accounts or send orders/messages. Start Vite with empty Supabase build variables and open that route to inspect it. The production build continues to use the existing server candles and trading API.

Changes are local. The native app loads the hosted web floor, so it receives this interface after the web build is published through the existing release flow.

## Ranks and 1 USDC play (Claude, 31 October 2026)

- **Season rank tiers** (`web/src/rank.tsx`): Iron (below −4%) → Bronze (−4%) → Silver (0%) → Gold (+3%) → Platinum (+6%) → Diamond (+10%) → Legend (FUNDED). A blown account shows Iron. Ranks are provisional ("placing n/5", faded) until the 5 qualifying trading days. Badges show on squad and global leaderboard rows and on player profiles; the You page has a rank card with progress, the next tier and the full ladder. Computed in the app from data the boards already return, so no database change. `npm run test:rank` covers the maths.
- **1 USDC play** (`web/src/UsdcPlay.tsx`): a quiet "1 USDC play · Season 2 test" disclosure on the You page. It moves no money and connects no wallet; everything stays paper. The opt-in switch saves locally and sends a `submit_feedback` note ("1 USDC play: count me in…") so the test list can be read from the `feedback` table. Any real-money version needs legal advice first (Australian online gambling and financial-product rules).
