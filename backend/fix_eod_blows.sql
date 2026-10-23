-- Brokie: undo the Season 1 blow-ups the 8% end-of-day rule would not have caused (23 Oct 2026).
-- Run in the Supabase SQL editor AFTER rules_v4.sql. One-off: it checks each account is still in
-- the exact state that was replayed and skips it otherwise, so re-running does nothing.
--
-- Until rules_v4 went live the server blew accounts on an INTRADAY trailing drawdown (10%, or 8%
-- after a buy-back) measured from the highest open-equity peak. Replaying quote_ticks for every
-- tick of their sessions shows that @sam and @fukotrades never fell within 8% of their highest
-- end-of-day balance ($100k for both) and never hit the 5% daily limit before being blown, so
-- under the rules decided on 22 Oct neither account would have blown or needed a buy-back:
--
--   sam         blown 22 Oct 01:34 UTC at $95,719 (EOD floor $92,000, daily floor $90,245)
--               bought back, then blown again 22 Oct 13:15 UTC at $148,597 with +$14,795 open
--               profit because equity fell 8% from an intraday peak of $161,602 (EOD floor $92,000)
--   fukotrades  blown 23 Oct 02:31 UTC at $98,457 (EOD floor $92,000, daily floor $90,158)
--               bought back, then daily-locked at $95,895 on the 4% buy-back limit
--
-- The fix merges each buy-back account back into the original:
--   * cash = start balance + every trade's P&L this season. Trades stay at the prices they closed
--     at: we can't know what the player would have done with positions the blow-up closed.
--   * the buy-back is handed back (resets_used 0, normal 5% daily limit, qualifying from day one).
--   * trades closed by the wrongful blow-ups (and fukotrades' 4% daily-limit close, which the
--     merged account would not have hit) are relabelled 'rules_fix', so 💀 REKT leaves the feeds.
--   * end-of-day high, intraday peak, worst drawdown, today's session start and the funded badge
--     are set from the replay of the merged account.
--   * one note goes into each affected squad chat.

do $$ begin
  alter table public.trades drop constraint if exists trades_reason_check;
  alter table public.trades add constraint trades_reason_check
    check (reason in ('closed', 'liquidated', 'season_end', 'daily_limit', 'blown', 'reset', 'sl_fix', 'rules_fix'));
end $$;

do $$
declare
  r record;
  uid uuid;
  a public.accounts;
  realized numeric;
  fixed text[] := '{}';
begin
  if not exists (select 1 from pg_proc where proname = 'dd_floor' and pronamespace = 'public'::regnamespace) then
    raise exception 'Run rules_v4.sql first.';
  end if;

  for r in
    select * from (values
      -- handle, replayed state (cash, peak, status) -> merged account
      ('sam',        148597.0::numeric, 161602.0::numeric, 'blown',
                     144316.0::numeric, 157321.0::numeric, 144316.0::numeric, 144316.0::numeric, 12.3347::numeric,
                     timestamptz '2026-10-22 03:37:40.281+00', array['2026-10-22 01:34:22.234128+00', '2026-10-22 13:15:41.954398+00']::timestamptz[]),
      ('fukotrades', 95895.00::numeric,  102590.00::numeric, 'locked',
                     94352.00::numeric,  110132.00::numeric, 100000.0::numeric, 94903.50::numeric, 14.3282::numeric,
                     timestamptz '2026-10-23 01:42:42.485+00', array['2026-10-23 02:31:54.366602+00', '2026-10-23 03:05:12.231128+00']::timestamptz[])
    ) v(handle, was_cash, was_peak, was_status, cash, peak, eod_peak, day_start, worst_dd, funded_at, wrong_closes)
  loop
    select p.id into uid from public.profiles p where p.handle = r.handle;
    select * into a from public.accounts where user_id = uid and season = public.current_season() for update;
    if not found or a.cash <> r.was_cash or a.peak_equity <> r.was_peak or a.status <> r.was_status or a.resets_used <> 1 then
      raise notice 'skip @%: not in the replayed state (already fixed, or it has traded since)', r.handle;
      continue;
    end if;
    -- The merged balance must equal start + every trade this season, or the replay is stale.
    select a.start_balance + coalesce(sum(pnl), 0) into realized from public.trades where user_id = uid and season = a.season;
    if realized <> r.cash then
      raise exception '@%: trades sum to % but the replay says %', r.handle, realized, r.cash;
    end if;
    if exists (select 1 from public.positions where user_id = uid and season = a.season) then
      raise exception '@% has open positions; replay again before fixing', r.handle;
    end if;

    update public.trades set reason = 'rules_fix'
     where user_id = uid and season = a.season and closed_at = any (r.wrong_closes) and reason in ('blown', 'daily_limit');

    update public.accounts set
      cash = r.cash, start_balance = 100000, peak_equity = r.peak, eod_peak = r.eod_peak,
      day_start_equity = r.day_start, trading_day = public.trading_today(),
      status = 'active', blown_at = null, resets_used = 0, qualify_from = null,
      daily_loss_pct = 5, max_dd_pct = 8, dd_mode = 'eod', rules_version = 4,
      worst_drawdown = r.worst_dd, funded_at = r.funded_at, protection_credit = 0
     where user_id = uid and season = a.season;

    -- Sanity: the restored account sits above both floors right now.
    select * into a from public.accounts where user_id = uid and season = a.season;
    if a.cash <= public.dd_floor(a) or a.cash <= a.day_start_equity * 0.95 then
      raise exception '@% would still be under a floor after the fix', r.handle;
    end if;
    fixed := fixed || r.handle;
  end loop;

  if cardinality(fixed) = 0 then raise notice 'nothing to fix'; return; end if;

  -- One note per affected squad, from @sam (who runs the game) if he's in it, else from the player.
  insert into public.squad_messages (squad_id, user_id, kind, body)
  select s.squad_id,
         coalesce((select m.user_id from public.squad_members m join public.profiles p on p.id = m.user_id
                    where m.squad_id = s.squad_id and p.handle = 'sam'), min(s.user_id::text)::uuid),
         'text',
         left('🛠 Rules fix: 8% end-of-day drawdown is live. ' ||
              string_agg('@' || s.handle, ' & ' order by s.handle) ||
              ' wouldn''t have blown under it. Restored, buy-back returned.', 140)
    from (select m.squad_id, m.user_id, p.handle from public.squad_members m join public.profiles p on p.id = m.user_id
           where p.handle = any (fixed)) s
   group by s.squad_id;
  raise notice 'fixed: %', fixed;
end $$;
