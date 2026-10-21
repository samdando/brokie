# brokie

A native iPhone paper-trading game prototype built with SwiftUI. Trade Gold, NAS, and ES with virtual funds on a custom candle chart, hop into a squad voice room, try a local squad leaderboard, and learn through three short quizzes.

## Online mode (squads, weekly seasons, live prices, live voice)

The app runs offline practice mode until `Brokie/BrokieConfig.swift` has your Supabase URL and key. Follow **SETUP.md** (free, about 20 minutes) to turn on:

- **Handle-only accounts:** anonymous Supabase sign-in plus a unique handle.
- **Squads:** create one or join with a 6-character invite code (share sheet built in). Up to 5 squads each, 20 players per squad.
- **Weekly seasons:** everyone starts Monday 00:00 Brisbane time with $10k. The server fills every order at the latest price, liquidates blown accounts, and settles open trades at the end of the week.
- **Leaderboard:** return % next to worst trade, live open-position dots, and a crown for the leader.
- **The pit:** your squad's opens and closes, with P&L.
- **Live prices:** Gold, NAS100 and US500 from an OANDA practice feed, with 1m/5m/15m candles built on the server.
- **Live voice:** LiveKit rooms per squad, with tokens issued only to squad members.
- **Trade cards:** tap any receipt to share an image of the trade.

Backend code lives in `backend/`: `schema.sql` (tables, rules, functions), `functions/` (edge functions), `deploy/` (paste-ready copies) and `cron.sql`. Run `backend/tests.sql` against a Postgres with `supabase_stub.sql` loaded to re-run the 47 backend checks. `Tests/OnlineTests.swift` runs the app's network code against that database (37 checks).

## Run on an iPhone Simulator

1. Open **Brokie.xcodeproj** in Xcode.
2. Select the **Brokie** scheme and an **iPhone Simulator** running iOS 18 or later.
3. Press **Run** (⌘R).

To run on a physical iPhone, select your developer team under the Brokie target's **Signing & Capabilities**, use a bundle identifier available to your team, and select the connected iPhone. Device installation requires signing.

## Try the game

- Start with $10,000 in virtual funds and choose Gold, NAS, or ES.
- Read the Brokie chart: candles or line, 6s / 15s / 30s candles, a dashed 20-bar average with a "sending it / dumping / chop" read, your entry lines with live P&L, and a price tag. Press and drag the chart to read any bar's open, high, low and close.
- Open a long or short position with one to three micro contracts; watch open P&L and close the trade.
- On Squad, join a voice room (Squad lounge, Gold gang, Index crew). You always join muted. Switch between open mic and push-to-talk, deafen, or leave; a mini bar keeps you in the room on other tabs, and the mic mutes itself when the app leaves the foreground. **This build's voice rooms are a preview: no audio is captured or sent, and the other members are demo players.**
- Check the account and trade history; progress saves locally between launches.
- Name a squad and compare your result with clearly labeled demo rivals.
- Complete the three lessons and quizzes.

The traded micro contracts use MGC $10/point, MNQ $2/point, and MES $5/point. Quotes are synthetic. The fixed $1,000 practice margin per contract, instant fills, and absence of fees and slippage are simplified game rules. See **LAUNCH.md** for the contract sources and production roadmap.

## Current scope

This is a local prototype with no real money, licensed live quotes, live voice audio, connected friends, authentication service, or shared leaderboard backend. Local squad naming does not create an online group. It has not been submitted to the App Store.

Verified on the iPhone 16 Pro simulator (iOS 18.3). The engine passed 103 assertions covering long/short P&L, contract multipliers, buying-power checks, closing, persistence, invalid data, liquidation credits, and ledger reconciliation. A native UI test passed the full flow: buy two Gold micro contracts, close the position, view the receipt, complete a lesson, rename a squad, and relaunch to verify saved progress. These checks do not establish App Store readiness or replace physical-device testing.

Both the simulator Debug build and the unsigned iPhone Release build passed with Xcode 27.1. The release bundle includes the local-preferences privacy manifest. It still requires your signing team and release configuration before device distribution.

Run the UI test with **Product → Test** (⌘U) in Xcode. Tests use an isolated local account. For standalone engine and voice checks, run from this folder:

```sh
mkdir -p /tmp/brokie-tests
swiftc -swift-version 6 -parse-as-library -module-cache-path /tmp/brokie-tests/module-cache Brokie/TradingEngine.swift Tests/EngineTests.swift -o /tmp/brokie-tests/engine-tests
/tmp/brokie-tests/engine-tests
swiftc -swift-version 6 -parse-as-library -module-cache-path /tmp/brokie-tests/module-cache Brokie/VoiceSession.swift Tests/VoiceTests.swift -o /tmp/brokie-tests/voice-tests
/tmp/brokie-tests/voice-tests
```

The engine suite (136 assertions) adds candle OHLC, candle stability as ticks arrive, loading pre-candle saves, and the live-quote boundary (refuses quotes unless a feed is connected, refuses stale or future-dated quotes, pauses the simulator while live). The voice suite (25 assertions) checks that you join muted, deafen and backgrounding cut the mic, push-to-talk only opens the mic while held, switching rooms resets to muted, dropped connections surface an error, and leaving wins over a join that's still connecting.

Core files:

- `Brokie/TradingEngine.swift` — local quotes, positions, P&L, balance and persistence.
- `Brokie/ContentView.swift` — trading, squad, lessons and account screens.
- `Brokie/BrokieChart.swift` — the Swift Charts candle/line chart, entry lines, scrub readout and chart controls.
- `Brokie/VoiceSession.swift` — voice room state machine behind a pluggable `VoiceTransport` (preview transport ships by default).
- `Brokie/VoiceRoomView.swift` — the Squad voice card and the in-call mini bar.
- `Tests/EngineTests.swift` — standalone engine assertions.
- `Tests/VoiceTests.swift` — standalone voice-session assertions with a recording transport.
- `LAUNCH.md` — live-feed, social backend and release work.

No third-party package dependency or API key is needed to run the local prototype.
