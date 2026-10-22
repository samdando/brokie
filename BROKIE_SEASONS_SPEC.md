# Brokie: Full Build Notes (for an AI dev)

## Context
Brokie is a SwiftUI iPhone app (plus a web build on GitHub Pages) with a Supabase backend, LiveKit voice and OANDA prices (see backend/). It's demo money only. Friends chat and voice chat, and watch each other enter and exit trades live as pump.fun-style bubbles. Keep the existing dark and lime look.

## 1. Fresh account per season
- Seasons last 8 weeks. Everyone starts on the same day with a fresh $100,000 demo account.
- Players can't carry a balance over or top it up.

## 2. Prop-firm rules (enforced server-side in Supabase, not just in the app)
- Max daily loss is 5% of the start-of-day balance. Hitting it closes all positions and locks trading until the next day (pick a timezone and state it).
- Max loss limit (MLL) is 8%, measured from the highest end-of-day balance (session close, 5pm New York), not the intraday peak. Touching it at any time closes all positions and marks the account BLOWN for the season. (Changed 22 Oct 2026 from 10% intraday trailing; trailing stays available as `dd_mode = 'trailing'` for a possible hard mode.)
- Hitting the profit target of +10% earns a "Funded" badge. The player can keep trading and climbing the leaderboard.
- Players need at least 5 trading days to qualify for the season leaderboard. A buy-back resets this: 5 new trading days from the reset.
- Show live meters on the Trade screen for the daily loss left, the drawdown left and progress to the target.

## 3. Blown accounts
- A blown account shows a public "💀 REKT" bubble on the profile and in the squad feed.
- One buy-back reset per season, with a tougher 4% daily loss limit (the 8% MLL is now the same as everyone's) and qualifying starts again. This is a paid hook.

## 4. What resets and what stays
- **Resets each season:** balance, season rank and season badges.
- **Stays forever (lifetime):** win rate, average R, max drawdown, total trades, and seasons passed, blown and funded. Also a season-by-season improvement graph and a trophy shelf of past finishes.

## 5. Clout and leaderboards
- Leaderboards for friends/squad, global, and per instrument (Gold, NAS, ES and others).
- Records like "biggest single-trade gain without a breach", "longest green streak" and "best season return".
- Every record links to the trades that set it, so it's verifiable and can't be faked.

## 6. Money (demo-only, no real-money prizes)
1. **Prop-firm partnerships:** paid referrals, or free or discounted challenges for each season's top traders. The leaderboard acts as a scouting tool.
2. **Season pass (~$5–8 a season):** cosmetics only, like bubble skins, trails, badges, flair and an end-of-season trophy. Nothing that affects trading.
3. **Brokie Pro (~$8 a month):** deeper lifetime stats, an improvement breakdown, a trade journal, private league rooms and extra resets.

## 7. Legal guardrails
- Show "Simulated trading, not financial advice" on every trade screen.
- No real-money prizes tied to P&L, so it doesn't look like gambling.
- Players must be 18+ if any prop-firm offers appear. Check ASIC affiliate rules before signing firm deals.

## Suggested Supabase tables
seasons, season_accounts (user, season, balance, peak, day_start_balance, status: active|locked|blown|funded, resets_used), trades (with season_account_id), lifetime_stats, records, badges.
A scheduled job (cron.sql) handles the daily lock reset and the end-of-season rollover.

## 8. Chart bubbles (THE core feature, like pump.fun)
Everyone's longs and shorts show up live on the chart you're looking at.
- **Bubble:** the trader's avatar in a circle, with a lime ring and ▲ for a long or a red/pink ring and ▼ for a short. Size scales with position size as a % of their account, not dollars. A live P&L tag ("+1.8R" or "-0.6%") sits underneath, and a dotted line shows their stop if they set one.
- **Entry:** the bubble pops in at the exact fill price and time with a bounce, plus a toast ("@jake longed EURUSD"). Friends' bubbles glow brighter.
- **Open:** the bubble rides the price line and pulses with P&L. Within 20% of a drawdown breach, it shakes and the ring flashes.
- **Exits:** a green close pops into lime confetti with the final R ("+3.2R 🚀"). A red close deflates and leaves a ghost dot. REKT cracks the bubble, turns it grey with 💀, and sinks it off the chart. Every exit leaves an entry-to-exit marker for scrollback.
- **Readability:** a filter with Friends (default), Top 10 and Everyone. Nearby bubbles cluster into a pill ("12 ▲ / 5 ▼"), and tapping it fans them out. A live long-vs-short sentiment bar sits on the side. Pinned mates show at full size. Tapping a bubble shows their entry, size, stop and drawdown left, plus a button to join their voice room.
- **MVP cut:** avatar, long or short, live P&L, the three exit animations, friends-only by default and clustering. Sounds, ghosts and trails come in v2.

## 9. Bubble streaming (tech)
- One Supabase Realtime channel per instrument (`chart:EURUSD`), and the app subscribes to whichever chart is open.
- The server-side fill function broadcasts {user id, avatar, side, size, entry, open or close}. The app never broadcasts its own bubbles.
- Live P&L is worked out on each phone from the price feed, not streamed per bubble.
- When a chart opens, the app loads open trades from the database, then switches to the live stream. Presence shows "12 watching."
- Lag target is under 500ms, and under 1s worst case, with the server in the Sydney region. The free-tier Realtime connection cap is fine for 100 users, but a spike would need Pro or batching.

## 10. Cheat-proofing (must-haves)
- All fills happen server-side in an Edge Function at the server's OANDA price. The app never sends a fill price.
- Balance, drawdown and daily loss are calculated server-side, and the app can't write to those tables. Lock them with Row-Level Security (RLS), Supabase's per-row permission rules. **This is the biggest risk:** without RLS, anyone can edit their balance from the browser console.
- Drawdown is checked on open positions in real time (a price listener or job), with automatic closes on a breach.
- Trades can only be added, never edited. Add rate limits, and allow one account per person per season (phone or Apple sign-in).
- Repo is public, so no keys in the code or old commits. Only the Supabase anon key goes in the client.
- Check OANDA practice-API terms for public display, or swap to a licensed feed.

## 11. Costs for the first ~100 users
GitHub Pages is free. The Supabase free tier probably holds, but Pro at $25 a month is recommended because free projects pause. The OANDA practice API is free. LiveKit's free tier covers light voice, and voice is the first cost to grow, so check its limits before launch.

## 12. Season 1 launch plan
- **Weeks −2 to 0:** a waitlist on the web link with squad codes, a countdown ("$100k fake, 8% max loss, one shot"), and the first 100 sign-ups get an "S1 OG" badge.
- **Day 1:** a live voice-room kickoff, with clips of the first bubbles posted.
- **Weeks 1–8:** a weekly leaderboard drop, a "REKT of the week" roast, a week-4 "who's still alive" post, and a live voice-room finale.
- **Videos:** (1) "POV: your mate's bubble is about to breach," (2) "Day X of trying to pass a prop challenge with fake money," and (3) "Rating my friends' trades."
- **Referral:** private leagues need 3+ mates, and a squad of 5 unlocks a squad bubble skin. Each invited friend who survives week 1 gives you a free reset token.
- **Share cards:** every REKT and Funded moment auto-generates a stats card with a Brokie link.

## Ideas for Season 2 (Sam, 22 Oct 2026)
- Let players choose their account size, and rank by percentage gain so every size competes fairly.
- Sizing restrictions per account size.
- Rule choices (e.g. EOD vs intraday trailing drawdown) that could change how a score counts, with harder rules worth more.
