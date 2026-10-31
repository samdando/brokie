-- =====================================================================
-- $1 pool: check Base for USDC entries once a minute.
-- Run AFTER pool.sql and after deploying the pool-watch edge function
-- (backend/deploy/pool-watch.ts, "Verify JWT" off).
-- Replace YOUR-PROJECT-REF with the part of your Project URL before .supabase.co.
-- ~43k calls/month, inside the free plan. Nothing happens until
-- brokie_private.pool_usdc_treasury is set.
-- =====================================================================
insert into public.brokie_private (key, value)
values ('pool_watch_url', 'https://YOUR-PROJECT-REF.supabase.co/functions/v1/pool-watch')
on conflict (key) do update set value = excluded.value;

select cron.unschedule(jobid) from cron.job where jobname = 'brokie-pool-watch';
select cron.schedule('brokie-pool-watch', '* * * * *', $$
  select net.http_post(
    url := (select value from public.brokie_private where key = 'pool_watch_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select value from public.brokie_private where key = 'cron_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 20000)
$$);

-- Check it's working (wait a minute):
--   select status_code, content from net._http_response order by created desc limit 3;
--   select * from public.pool_entries order by created_at desc;
