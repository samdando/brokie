# Brokie online setup — $0, about 20 minutes

You'll make three free accounts and paste a few things into Supabase. Nothing here needs a credit card.

**Secrets stay in Supabase.** Your OANDA token and LiveKit secret only ever go into Supabase's secrets screen, never into the app or a chat. The two things the app needs (Project URL and anon/publishable key) are public by design.

All files mentioned are in `Desktop/Brokie/backend/`.

---

## 1. Supabase (backend)

1. Go to **supabase.com** → Sign up → **New project**. Name `brokie`, region **Sydney**, any database password (save it in your password manager). Plan: **Free**.
2. **Turn on handle-only sign-in:** Authentication → **Sign In / Providers** → turn on **Allow anonymous sign-ins** → Save.
3. **Create the database:** SQL Editor → New query → open `backend/schema.sql`, copy everything, paste, **Run**. You should see "Success. No rows returned".
4. Grab these two from **Project Settings → API** (or **API Keys**) and send them to Claude:
   - **Project URL**: `https://xxxx.supabase.co`
   - **anon public** key (or **publishable** key)

## 2. OANDA (live prices)

1. Go to **oanda.com/au-en** → open a **Demo account** (practice, fake money).
2. Log in to the demo → **My Account → Manage API Access** → **Generate** a token. Copy it.
3. Note your **v20 account ID** (looks like `101-011-12345678-001`), shown on the same page or in the account list.

These prices are for testing with your mates, not a public App Store launch (demo-account data isn't licensed for redistribution).

## 3. LiveKit (voice)

1. Go to **livekit.io** → **Start building** → sign up → create a project (Build plan, free).
2. **Settings → Keys** → create a key. Copy the **API Key**, **API Secret**, and the **WebSocket URL** (`wss://….livekit.cloud`).

## 4. Deploy the two server functions (in Supabase)

**Edge Functions → Deploy a new function → Via Editor**, twice:

| Function name | Paste the contents of | Verify JWT |
|---|---|---|
| `ingest-quotes` | `backend/deploy/ingest-quotes.ts` | **OFF** (it's protected by the cron secret) |
| `voice-token` | `backend/deploy/voice-token.ts` | **ON** (default) |

Name them exactly as shown. To turn JWT verification off, open the function → **Details/Settings** → toggle off **Verify JWT** → Save.

## 5. Add the secrets (in Supabase)

**Edge Functions → Secrets** → add each one:

| Name | Value |
|---|---|
| `OANDA_TOKEN` | your OANDA API token |
| `OANDA_ACCOUNT_ID` | your OANDA v20 account ID |
| `CRON_SECRET` | the `brk_…` value inside `backend/cron.sql` |
| `LIVEKIT_URL` | `wss://….livekit.cloud` |
| `LIVEKIT_API_KEY` | LiveKit API key |
| `LIVEKIT_API_SECRET` | LiveKit API secret |

If your project only shows new-style keys (`sb_secret_…`) and prices don't arrive, add one more: `BROKIE_SERVICE_KEY` = your **secret** key from Project Settings → API Keys.

## 6. Start the price feed

SQL Editor → open `backend/cron.sql` → replace `YOUR-PROJECT-REF` with the part of your Project URL before `.supabase.co` → **Run**.

Wait 30 seconds, then run `select market, price, quoted_at from quotes;`. You should see Gold, NAS and ES prices. (On weekends, markets are closed, so prices won't update until Monday morning AEST.)

## 7. Tell Claude

Send the **Project URL** and **anon/publishable key**. Claude puts them into `Brokie/BrokieConfig.swift`, rebuilds, and checks it end to end.

---

### Free-plan limits worth knowing
- **Supabase** pauses a free project after about a week with no activity. Click **Resume project** in the dashboard to wake it. The 10-second price feed counts as activity while markets are open.
- **LiveKit**: 5,000 voice minutes a month (for example, 4 mates × 40 hours).
- **Apple**: the free account runs the app on *your* iPhone (re-run from Xcode every 7 days). Getting it onto mates' iPhones (TestFlight) needs the US$99/yr developer program. Hold off on that until you've proven people come back.
