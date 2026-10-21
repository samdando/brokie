\set ON_ERROR_STOP on
create or replace function pg_temp.check(ok boolean, msg text) returns void language plpgsql as $$
begin if not coalesce(ok, false) then raise exception 'FAIL: %', msg; end if; raise notice 'ok: %', msg; end $$;
-- Brisbane is UTC+10 all year. New York is UTC-4 until 1 Nov 2026, then UTC-5.
select pg_temp.check(public.trading_day_of('2026-10-22 06:59+10') = '2026-10-22'::date - 1, '6:59am Brisbane (4:59pm NY) is still yesterday''s session');
select pg_temp.check(public.trading_day_of('2026-10-22 07:00+10') = '2026-10-22', '7:00am Brisbane (5pm NY) starts today''s session');
select pg_temp.check(public.trading_day_of('2026-10-22 23:59+10') = '2026-10-22', 'midnight Brisbane is no longer a reset');
select pg_temp.check(public.trading_day_of('2026-10-23 00:30+10') = '2026-10-22', '12:30am Brisbane still the same session');
select pg_temp.check(public.trading_day_of('2026-11-05 07:59+10') = '2026-11-04', 'after NY clocks go back: 7:59am Brisbane still the old session');
select pg_temp.check(public.trading_day_of('2026-11-05 08:00+10') = '2026-11-05', 'after NY clocks go back: reset is 8am Brisbane');
select pg_temp.check(public.trading_day_ends_at() > now() and public.trading_day_ends_at() <= now() + interval '1 day', 'session end is within the next day');
select pg_temp.check(extract(hour from public.trading_day_ends_at() at time zone 'America/New_York') = 17, 'session ends at 5pm New York');
