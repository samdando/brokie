# brokie — product and launch notes

Working concept: a social paper-trading game where friends learn Gold, Nasdaq-100 and S&P 500 by trading play money, sharing their calls, and competing in private leagues. The tone is playful; the balance and performance history should be clear and honest.

## The game worth building

Give everyone the same fresh virtual balance each season. A player chooses a market, makes a long or short call, watches their open position, and closes it to lock in a result. The payoff is a shareable trade card, a place on the friend leaderboard, and a short explanation of what happened.

- **Markets:** three focused markets with a price chart and plain-language trade controls.
- **Squads:** invite-only friend groups, a weekly leaderboard, reactions, and trade cards. Start with preset reactions before unrestricted chat.
- **Learning:** explain long/short, points, size, open versus realized P&L, and why the same price move produces a different result at different sizes. Reward completing lessons and keeping a journal, not just taking more trades.
- **Competition:** equal starting balances, consistent sizing rules, and transparent resets. Show return and drawdown together so one oversized lucky trade does not tell the whole story.
- **Rewards:** profile badges and cosmetics. No deposits, withdrawals, cash-out, transferable tokens, paid trading balance, or prizes of monetary value in this concept.

Use the fast feed and communal excitement as the inspiration. Give the game its own identity and artwork.

## What the local prototype means

The native SwiftUI prototype includes synthetic market movement, a persistent local paper account starting at $10,000, long/short trades, open and realized P&L, trade history, a locally named squad with demo rivals, and three interactive quiz lessons. Its prices are not a real market feed; example players are not connected accounts. A moving chart alone must never be labeled live market data. Keep the simulated-price disclosure visible.

Local balances can validate the interaction, but cannot support a trustworthy shared leaderboard. Real friends, cross-device accounts, licensed market data, server-side fills, moderation, and App Store release infrastructure are separate production work.

## The prototype's contracts

The prototype interprets the brief as futures, using the smaller micro contracts and their actual point multipliers. “NAS” can also mean a broker's CFD label, so confirm the intended market family before buying a production data subscription. Gold, NAS, and ES are friendly app labels; the order's contract codes are MGC, MNQ, and MES.

| App label | Micro contract / larger counterpart | P&L per point per contract | Minimum tick |
|---|---|---|---|
| Gold | Micro Gold **MGC** / Gold **GC** | **$10**: 10 troy ounces × $1/ounce | 0.10 = $1. [CME metals specifications](https://www.cmegroup.com/trading/metals/files/metals-prod-guide-2023.pdf) |
| NAS | Micro E-mini Nasdaq-100 **MNQ** / E-mini **NQ** | **$2** | 0.25 = $0.50. [CME Micro E-mini specifications](https://www.cmegroup.com/trading/equity-index/files/cme-micro-e-mini-futures-fact-card.pdf) |
| ES | Micro E-mini S&P 500 **MES** / E-mini **ES** | **$5** | 0.25 = $1.25. [CME MES specifications](https://www.cmegroup.com/markets/equities/sp/micro-e-mini-sandp-500.contractSpecs.html) |

P&L is `(exit price − entry price) × point multiplier × contracts × direction`, with direction +1 for long and −1 for short. Open P&L uses the current synthetic price instead of an exit price.

The engine reserves a fixed **$1,000 of practice margin per contract** across all three markets. That is a game rule, not a current exchange or broker requirement. Fills are instant, with **no fees, spread, or slippage**. If account equity reaches zero, all positions close and the balance is floored at zero. These simplifications mean the prototype does not reproduce real-account buying power or execution. A realistic mode would additionally need live margin rules, bid/ask fills, costs, trading sessions, expiries, and rollover.

## From demo to live-market beta

1. **License the feed.** Obtain a commercial quote for mobile redistribution and the game's calculated values. CME distinguishes display, distribution, non-display, and derived-data uses; a personal subscription is not proof of redistribution rights. CME offers direct APIs and a directory of authorized distributors. Confirm the specific rights and reporting obligations with the provider before integrating. [CME licensing](https://www.cmegroup.com/market-data/license-data.html), [connection options](https://www.cmegroup.com/market-data/connect-data.html), [licensed distributors](https://www.cmegroup.com/market-data/license-data/licensed-market-data-distributors.html).
2. **Make the server authoritative.** Ingest timestamped ticks into one market service. Accept orders on the server, apply one published fill rule, and record an immutable order/position/balance ledger. Reject duplicate requests and stale quotes. Never trust a client-supplied fill price or score.
3. **Handle real market conditions.** Display quote age and live/delayed status. Pause fills during stale feeds or closed sessions, recover cleanly after reconnects, and identify the contract month. Specify how season boundaries and contract rolls affect open positions.
4. **Connect private squads.** Add accounts, revocable invitation links, group membership, and server-calculated leaderboards. Make trade sharing opt-in. Begin with a small TestFlight group and measure whether friends return for a second session.
5. **Ship the learning loop.** Add a short trade recap and journal prompt. Test whether players can explain open P&L, realized P&L, and position size after using it; do not treat more trades as evidence of learning.

## Real prices for the Brokie chart

The chart is our own (Swift Charts), so it doesn't depend on any charting vendor. What it needs is a quote source the app is allowed to show.

- **Don't scrape TradingView, LuxAlgo, or broker sites.** LuxAlgo sells indicators that run on TradingView; neither provides a price feed licensed for reuse, and scraping breaks their terms on top of CME's redistribution rules for MGC/MNQ/MES data. An app found doing it risks takedown.
- **The plug-in point already exists.** A feed adapter calls `engine.connectLiveFeed(provider:)`, then `engine.ingestLiveQuote(market:price:timestamp:)` for each tick. The engine refuses quotes older than 10 seconds or dated in the future, pauses the synthetic ticker while live, and the chart badge switches from SIMULATED to LIVE · PROVIDER. `disconnectLiveFeed()` returns to simulation.
- **Put the provider behind your own server.** The app should connect to a Brokie quote service (WebSocket) rather than holding a provider API key. That service is also where the authoritative fills from step 2 above belong.
- **Pick the market family first.** Real futures (MGC/MNQ/MES) need a CME-licensed distributor with mobile display rights. If spot gold and index CFDs or ETF proxies are acceptable for a game, licensing options and cost may differ; confirm display and redistribution rights in writing with whichever provider you choose.
- Candles are currently grouped by tick count (4/10/20 ticks ≈ 6/15/30 s in the simulator). With a live feed, switch `CandleFrame` to time buckets so bars line up with wall-clock minutes.

## Voice rooms

`VoiceSession` is a tested state machine (join muted, mute/deafen, push-to-talk, background auto-mute, room switching, dropped-connection handling) behind the `VoiceTransport` protocol. The shipped `PreviewVoiceTransport` touches no microphone or network, and the room members are labeled demo players.

To go live:

1. Choose a real-time audio provider (for example a WebRTC SFU such as LiveKit, or Agora) and implement `VoiceTransport` with its SDK. The transport must connect with the mic off and only report remote participants for the current room.
2. Issue short-lived room tokens from the Brokie backend, scoped to squad membership, so only invited friends can join a squad's room.
3. Add `NSMicrophoneUsageDescription` (for example "Brokie uses the microphone so you can talk with your squad in voice rooms."), configure `AVAudioSession` for voice chat, and decide whether to enable the `audio` background mode. If you do, keep `suspendMicrophone()` behaviour honest in the UI.
4. Update `PrivacyInfo.xcprivacy` and the App Store privacy answers for audio data, and add per-user mute, block, and report controls in voice rooms. Live voice between users is user-generated content under Apple's guidelines, and it affects the age rating.

## App Store work specific to this app

The prototype includes `Brokie/PrivacyInfo.xcprivacy`, declaring no tracking or collected data and the UserDefaults reason **CA92.1** for its own local preferences and practice state. Apple requires declarations for covered APIs; CA92.1 applies to defaults available only to the app. Bundle this file in the app target and revisit its declarations when adding network features or SDKs. It does not replace an accessible privacy policy or App Store privacy answers. [Apple required-reason API guidance](https://developer.apple.com/documentation/bundleresources/describing-use-of-required-reason-api), [approved UserDefaults reason](https://developer.apple.com/documentation/bundleresources/app-privacy-configuration/nsprivacyaccessedapitypes/nsprivacyaccessedapitypereasons).

For a social release, add content filtering, reporting, blocking, and a reachable support contact. Include an accessible privacy policy and in-app account deletion if accounts can be created. Submit accurate screenshots and review notes that explain virtual balances and the absence of real-money transactions. These requirements come from Apple's user-content, privacy, and metadata rules. [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/).

Complete the age-rating questionnaire according to the actual features and content, including social capabilities, contests, and any applicable simulated-gambling classification. Do not assume a rating from the “paper trading” name. [Apple age-rating setup](https://developer.apple.com/help/app-store-connect/manage-app-information/set-an-app-age-rating).

Before submission, prepare an Apple Developer account, signing and bundle identifier, app icon, device screenshots, support/privacy URLs, App Store metadata, and an accessible review account or demo path. Run on physical iPhones and test offline recovery, backgrounding, large text, screen-reader labels, and repeated order taps. This prototype is not an App Store submission or an approval guarantee.

Product success test: a new player understands the first trade in under a minute, can tell that all value is virtual, and voluntarily brings a friend back for another session.

Sources checked 21 October 2026. Working name and brand availability have not been cleared.
