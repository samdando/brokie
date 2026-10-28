# Brokie release path · 28 October 2026

## Server stops and trading polish (0.3.3)

The production server migration is applied; the web release is ready for publishing. Apply `backend/server_brackets.sql` before publishing this web build. The migration makes SL/TP server-owned and processes accepted quotes before risk checks, records stop settings/fills, and schedules daily unlocks for flat locked accounts. The client shows only confirmed protection, migrates valid device-only levels, and provides explicit SL/TP editing on each position. Stops fill at the observed crossing quote, not a guaranteed trigger price. Invalid old levels are flagged for review. See `backend/STOP_LOSS_RELEASE.md` for deployment and account verification.

The interface reduces glow and spacing, adds protection status to position cards and shows a daily-reset countdown. Build, isolated SQL checks and browser regression tests cover the new flow.

## Current live release

The current redesign is live at https://samdando.github.io/brokie/. The Xcode app now opens this same interface in a WebKit client with native haptics, microphone prompting, external-link handling and retry UI. Its Native account button retains the original SwiftUI client and its keychain login. The web floor uses its own saved session; existing native players can use a backup code to restore their account there. Native credentials are never injected into the hosted page. UI tests keep using isolated native practice mode.

## App Store assessment

A paper-trading game with nonredeemable tokens is a plausible submission candidate; approval is Apple's decision. Keep tokens earned/free, nontransferable and without cash or prize redemption. Declare simulated gambling accurately in the age questionnaire. Apple's [age-rating definitions](https://developer.apple.com/help/app-store-connect/reference/app-information/age-ratings-values-and-definitions/) distinguish simulated gambling from wagers with redeemable currency.

[Apple's review rules](https://developer.apple.com/app-store/review/guidelines/) cover contests (5.3), digital purchases (3.1.1), account deletion (5.1.1), user content moderation (1.2) and minimum app functionality (4.2). Real-money gambling requires licensing and geographical restrictions; do not introduce cash-out or purchasable betting credit as a cosmetic extension. A thin website wrapper can face minimum-functionality rejection.

[Enroll with Apple](https://developer.apple.com/programs/enroll/): use your own Apple Account with two-factor authentication. Choose individual or organisation based on the entity publishing the product; organisations need verification. [Membership](https://developer.apple.com/help/account/membership/program-enrollment) is USD 99/year, with local pricing shown at checkout. Enrollment, legal acceptance and payment have not been performed.

Before submission, bring the chosen iOS client up to parity, verify physical-device audio/gestures/background behavior, supply a privacy policy/support URL and data disclosures, implement account deletion and squad chat reporting/blocking/moderation, and prepare screenshots and review access. These release features were not added in the trading-screen redesign.

## Fastest release: your own domain and installed web app

The web app already has a manifest, icons, portrait mode and service worker. Build `web/` with the existing public Supabase environment variables, upload `dist/` to HTTPS static hosting, then point a domain you own to that host. Domain purchase and DNS changes have not been made.

On iPhone, open the domain in Safari and follow [Apple's Add to Home Screen instructions](https://support.apple.com/guide/iphone/open-as-web-app-iphea86e5236/ios). Friends can use the same domain on Android or desktop. This ships the web design directly and does not require an App Store submission.

## Server release

The live database has `backend/clean_floor.sql` applied (8 players received the grant, 4 free avatars, current-season loss rules unchanged). For another environment, apply it after the existing token/avatar/weekend migrations. It grants existing and new players five starter tokens exactly once, adds four free avatars and profile colours, permits orders up to 100 micros within existing margin/session/rate checks, and schedules the fixed USD 2,000 daily loss allowance for accounts in seasons after the rollout season. Earned balances and current-season loss rules are preserved. The 8% maximum loss rule can still be reached first.

The finance discovery update is deployed to the existing `prediction-quotes` edge function; `backend/deploy/prediction-quotes.ts` is its source. It fetches S&P 500, Nasdaq, Dow, gold, Treasury and BTC/ETH series from Kalshi and reserves room per underlying. S&P 500 and Nasdaq qualifying contracts were verified against the public feed; gold, Dow and Treasury can be empty when there are no liquid contracts. Existing held sports positions continue to refresh and settle. New discovery and the browse UI focus on finance. Provider subtitles preserve exact strike/target information. These are token-based Yes/No event contracts, not brokerage options.

The mobile interface uses vertical snap wheels for timeframe and 1/10/100 micros, including native finger scrolling in fullscreen. The normal chart is a locked preview; pan, pinch, wheel and axis scaling are enabled only in fullscreen. The expand/collapse control sits in the chart’s top-right corner with a 44px touch target. Fullscreen includes the same order controls and fits chart height to the available space. US flag badges identify 100/500/30, with a gold bar for gold. Glowing avatar rings show open long/short positions; closed exits are visible by default, remember the History toggle preference and are thinned at dense overlaps. Chat groups consecutive messages, shows avatars/time dividers, preserves the reading position on new messages and keeps the composer separate from the scrolling log.

The trading dock keeps account-wide unrealised USD P&L above Buy/Sell, alongside selected-market long/short exposure. Tapping it opens position management in normal or fullscreen mode. Missing quotes show a dash; stale quotes are labelled. Open positions precede compact account equity and season progress, with risk details expandable and a compact flat state. Fullscreen sizing uses layout heights so its entrance animation cannot push order controls off-screen.

Only relative countdowns are displayed, without local-clock times or timezone labels. Session countdowns use Brokie's current 17:00 New York weekday flat-at-close / Sunday 18:00 crypto rules. Sydney, Tokyo, London and New York opens are reference liquidity sessions, with named time zones and daylight saving; they are not an exchange holiday calendar. Alerts animate while the trading screen is open. They do not run when the web app is backgrounded or closed.

## Verification

- `cd web && npm run build`
- `node web/tests/trading-summary.cjs` and `web/tests/workspace-layout.cjs` (synthetic P&L, missing/stale quotes, compact layout and fullscreen positions)
- `node backend/tests/clean-floor.mjs` and `node backend/tests/weekend.mjs`
- `node backend/tests/feeds.cjs`
- Local Vite server, then `web/tests/mobile-polish.cjs`, `timeframes-smoke.cjs`, `clean-floor.cjs`, `ui-smoke.cjs`, `hold-smoke.cjs`, `upgrade-smoke.cjs` with Playwright/Chrome.

The iPhone Simulator Debug build passed, and the installed client was launched and visually verified on iPhone 16 Pro (iOS 18.3). Signing and App Store submission have not been performed. Both the repository project and the Desktop root project have the new client.

The browser tests use synthetic accounts and intercepted requests, not live order execution. The SQL checks use a disposable PostgreSQL-compatible PGlite database. Bundle size has the existing Vite warning.
