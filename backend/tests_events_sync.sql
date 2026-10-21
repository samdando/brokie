\set ON_ERROR_STOP on
-- local stand-ins for pg_net and pg_cron
create schema if not exists net;
create table net._http_response (id bigint primary key, status_code int, content text);
create or replace function net.http_get(url text, timeout_milliseconds int default 1000) returns bigint language sql as $$ select 77::bigint $$;
create schema if not exists cron;
create table cron.job (jobid serial, jobname text);
create or replace function cron.unschedule(j int) returns void language sql as $$ select 1 $$;
create or replace function cron.schedule(n text, s text, c text) returns bigint language sql as $$ select 1::bigint $$;
create or replace function pg_temp.check(ok boolean, msg text) returns void language plpgsql as $$
begin if not coalesce(ok, false) then raise exception 'FAIL: %', msg; end if; raise notice 'ok: %', msg; end $$;
