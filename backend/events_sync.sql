-- Brokie: pull the economic calendar (CPI, NFP, FOMC...) into `events` automatically.
-- Source: the free weekly Forex Factory feed (nfs.faireconomy.media). Unofficial; fine for friends,
-- but swap for a licensed calendar before any public launch.
-- Run AFTER v3.sql. Safe to re-run. Hourly via pg_cron + pg_net, no edge function needed.
create extension if not exists pg_cron;
create extension if not exists pg_net;

alter table public.events add column if not exists source text;
create unique index if not exists events_source_dedupe on public.events (title, event_at);

create or replace function public.sync_events() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  rid bigint;
  resp record;
  payload jsonb;
  added int := 0;
begin
  -- 1) Ingest the response to the request we fired last time.
  select value::bigint into rid from brokie_private where key = 'events_req_id';
  if rid is not null then
    select status_code, content into resp from net._http_response where id = rid;
    if found and resp.status_code = 200 then
      begin payload := resp.content::jsonb; exception when others then payload := null; end;
      if jsonb_typeof(payload) = 'array' then
        with src as (
          select i->>'country' as country, i->>'impact' as impact, i->>'title' as title,
                 (i->>'date')::timestamptz as at, nullif(i->>'forecast', '') as fc, nullif(i->>'previous', '') as pv
          from jsonb_array_elements(payload) i
          where i->>'impact' = 'High' and i->>'country' in ('USD','EUR','GBP','JPY','AUD','CAD','NZD','CHF','CNY')
            and i->>'date' is not null
        ), ins as (
          insert into events (kind, impact, title, body, event_at, lead_minutes, duration_minutes, source)
          select 'econ', case when country = 'USD' then 'high' else 'med' end,
                 left(country || ' ' || title, 80),
                 left(case when fc is null and pv is null then 'High-impact release. Expect a spike.'
                           else 'Forecast ' || coalesce(fc, '?') || ' · Previous ' || coalesce(pv, '?') end, 280),
                 at, 30, 60, 'forexfactory'
          from src
          on conflict (title, event_at) do nothing
          returning 1)
        select count(*) into added from ins;
      end if;
    end if;
    delete from net._http_response where id = rid;
  end if;
  -- 2) Fire the next request (collected on the next run).
  select net.http_get(url := 'https://nfs.faireconomy.media/ff_calendar_thisweek.json', timeout_milliseconds := 10000) into rid;
  insert into brokie_private (key, value) values ('events_req_id', rid::text)
  on conflict (key) do update set value = excluded.value;
  return jsonb_build_object('added', added, 'next_request', rid);
end $$;
revoke all on function public.sync_events() from public, anon, authenticated;

select cron.unschedule(jobid) from cron.job where jobname = 'brokie-sync-events';
select cron.schedule('brokie-sync-events', '*/30 * * * *', 'select public.sync_events()');
select public.sync_events();
