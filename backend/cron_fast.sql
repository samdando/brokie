-- =====================================================================
-- Brokie: faster prices (~every 2 s instead of every 10 s), still $0.
-- Run AFTER redeploying the ingest-quotes function from deploy/ingest-quotes.ts
-- (the new version understands "loop_seconds"; the old one would ignore it).
--
-- Once a minute, pg_cron starts the function; it answers at once and keeps
-- pulling OANDA every 2 s for 55 s in the background. That's ~43k calls a month
-- (free plan allows 500k), down from ~260k with the 10-second schedule.
-- To go back: run cron.sql again.
-- =====================================================================
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Deleting old candle ticks now runs every 2 s, so give it an index.
create index if not exists quote_ticks_time on public.quote_ticks (quoted_at);

select cron.unschedule(jobid) from cron.job where jobname in ('brokie-ingest-quotes', 'brokie-ingest-quotes-fast');
select cron.schedule('brokie-ingest-quotes-fast', '* * * * *', $$
  select net.http_post(
    url := (select value from public.brokie_private where key = 'ingest_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select value from public.brokie_private where key = 'cron_secret')),
    body := '{"loop_seconds": 55, "every_ms": 2000}'::jsonb,
    timeout_milliseconds := 8000)
$$);

-- Check it's working (wait ~1 minute, run twice a few seconds apart; quoted_at should move):
--   select market, price, quoted_at, updated_at from public.quotes;
--   select status_code, content from net._http_response order by created desc limit 3;   -- expect 202 {"looping":55,...}
