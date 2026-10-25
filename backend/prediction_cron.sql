-- Keep Edge Function JWT verification enabled. Store the project's existing legacy anon JWT
-- in brokie_private under edge_anon_jwt before installing this job. Never commit that value.
-- Deploy prediction-quotes before installing this schedule.
insert into public.brokie_private(key,value)
select 'prediction_ingest_url',regexp_replace(value,'/functions/v1/[^/]+$','/functions/v1/prediction-quotes')
from public.brokie_private where key='ingest_url'
on conflict(key) do update set value=excluded.value;
select cron.unschedule(jobid) from cron.job where jobname='brokie-prediction-quotes';
select cron.schedule('brokie-prediction-quotes','30 seconds',$job$
 select net.http_post(url:=(select value from public.brokie_private where key='prediction_ingest_url'),
 headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||(select value from public.brokie_private where key='edge_anon_jwt'),'x-cron-secret',(select value from public.brokie_private where key='cron_secret')),
 body:='{}'::jsonb,timeout_milliseconds:=15000);
$job$);
