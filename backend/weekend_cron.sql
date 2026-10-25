-- Install after weekend.sql. Independent of external price ingestion.
select cron.unschedule(jobid) from cron.job where jobname='brokie-market-close';
select cron.schedule('brokie-market-close','* * * * *',$$select public.settle_market_closes();$$);
-- Inspect pending closures rather than assigning a fabricated price:
-- select id,market,session_closes_at from positions where session_closes_at<=now();
