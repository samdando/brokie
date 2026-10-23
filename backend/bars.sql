-- Brokie · price history as bars, so charts can show 1m up to 1D (23 Oct 2026).
-- quote_ticks only keeps 3 days; bars keep 1-minute bars ~45 days, 1-hour bars ~3 years
-- and daily bars forever. Every tick updates its 1m, 1h and 1D bar. candles() builds any
-- whole-minute timeframe from the biggest stored bar that divides it (4h from 1h, 1D from 1D).
-- Bucket numbers stay epoch-aligned (index = floor(epoch / size)), exactly like before,
-- so 1D candles run from 00:00 UTC (10am Brisbane). Rerunnable.

create table if not exists public.bars (
  market   market      not null references markets(id),
  secs     int         not null check (secs in (60, 3600, 86400)),
  idx      bigint      not null,              -- floor(epoch / secs)
  open     numeric     not null,
  high     numeric     not null,
  low      numeric     not null,
  close    numeric     not null,
  first_at timestamptz not null,              -- time of the price behind `open`
  last_at  timestamptz not null,              -- time of the price behind `close`
  primary key (market, secs, idx)
);
alter table public.bars enable row level security;   -- read only through candles()
revoke all on public.bars from anon, authenticated;

-- Fold one price into a bar: widest high/low, earliest open, latest close. Order-independent,
-- so live ticks and backfilled history can arrive in any order and still agree.
create or replace function public.merge_bar(p_market market, p_secs int, p_idx bigint,
  p_open numeric, p_high numeric, p_low numeric, p_close numeric, p_first timestamptz, p_last timestamptz)
returns void language sql security definer set search_path = public as $$
  insert into bars as b (market, secs, idx, open, high, low, close, first_at, last_at)
  values (p_market, p_secs, p_idx, p_open, p_high, p_low, p_close, p_first, p_last)
  on conflict (market, secs, idx) do update set
    high     = greatest(b.high, excluded.high),
    low      = least(b.low, excluded.low),
    open     = case when excluded.first_at < b.first_at then excluded.open else b.open end,
    first_at = least(b.first_at, excluded.first_at),
    close    = case when excluded.last_at >= b.last_at then excluded.close else b.close end,
    last_at  = greatest(b.last_at, excluded.last_at);
$$;
revoke all on function public.merge_bar(market, int, bigint, numeric, numeric, numeric, numeric, timestamptz, timestamptz) from public, anon, authenticated;

create or replace function public.bars_from_tick() returns trigger
language plpgsql security definer set search_path = public as $$
declare s int;
begin
  foreach s in array array[60, 3600, 86400] loop
    perform merge_bar(new.market, s, floor(extract(epoch from new.quoted_at) / s)::bigint,
                      new.price, new.price, new.price, new.price, new.quoted_at, new.quoted_at);
  end loop;
  return null;
end $$;

drop trigger if exists bars_from_tick on public.quote_ticks;
create trigger bars_from_tick after insert on public.quote_ticks
  for each row execute function public.bars_from_tick();

-- Seed bars from the ticks we already have (same merge, so rerunning changes nothing).
do $$
declare s int;
begin
  foreach s in array array[60, 3600, 86400] loop
    perform merge_bar(t.market, s, t.idx, t.o, t.h, t.l, t.c, t.f, t.la)
    from (
      select market, floor(extract(epoch from quoted_at) / s)::bigint as idx,
             (array_agg(price order by quoted_at asc))[1] as o, max(price) as h, min(price) as l,
             (array_agg(price order by quoted_at desc))[1] as c, min(quoted_at) as f, max(quoted_at) as la
      from quote_ticks group by 1, 2
    ) t;
  end loop;
end $$;

-- Candles for the chart. Same signature and output as before; now up to 1 day and 300 bars.
create or replace function public.candles(p_market market, p_bucket_seconds integer default 60, p_limit integer default 60)
returns jsonb language sql stable security definer set search_path = public as $$
  with params as (
    select greatest(10, least(p_bucket_seconds, 86400)) as size, greatest(5, least(p_limit, 300)) as n
  ), base as (
    select size, n,
           case when size % 86400 = 0 then 86400 when size % 3600 = 0 then 3600 when size % 60 = 0 then 60 else 0 end as b
    from params
  ), from_bars as (           -- whole minutes and up: build from stored bars
    select floor(x.idx * base.b / base.size)::bigint as bucket,
           (array_agg(x.open order by x.idx asc))[1] as open, max(x.high) as high, min(x.low) as low,
           (array_agg(x.close order by x.idx desc))[1] as close
    from bars x, base
    where base.b > 0 and x.market = p_market and x.secs = base.b
      and x.idx >= floor((extract(epoch from now()) - base.size * base.n * 3) / base.b)
    group by 1
  ), from_ticks as (          -- under a minute (or odd sizes): straight from ticks, as before
    select floor(extract(epoch from t.quoted_at) / base.size)::bigint as bucket,
           (array_agg(t.price order by t.quoted_at asc))[1] as open, max(t.price) as high, min(t.price) as low,
           (array_agg(t.price order by t.quoted_at desc))[1] as close
    from quote_ticks t, base
    where base.b = 0 and t.market = p_market and t.quoted_at >= now() - make_interval(secs => base.size * base.n * 3)
    group by 1
  ), all_bars as (select * from from_bars union all select * from from_ticks)
  select coalesce(jsonb_agg(jsonb_build_object('index', bucket, 'open', open, 'high', high, 'low', low, 'close', close)
                            order by bucket), '[]'::jsonb)
  from (select * from all_bars order by bucket desc limit (select n from params)) last_bars
$$;

-- Keep the table small: 1m bars ~45 days, 1h bars ~3 years, daily bars forever.
select cron.unschedule('brokie-trim-bars') where exists (select 1 from cron.job where jobname = 'brokie-trim-bars');
select cron.schedule('brokie-trim-bars', '23 4 * * *', $cron$
  delete from public.bars where secs = 60   and idx < floor(extract(epoch from now() - interval '45 days') / 60);
  delete from public.bars where secs = 3600 and idx < floor(extract(epoch from now() - interval '3 years') / 3600);
$cron$);

-- History backfill (service role only): rows from OANDA candles, folded in with the same merge
-- as live ticks, prices rounded to each market's tick. p_rows: [{market, secs, time, o, h, l, c, complete}].
create or replace function public.backfill_bars(p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r jsonb; m markets; s int; t timestamptz; n int := 0;
begin
  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    select * into m from markets where id::text = r->>'market';
    s := (r->>'secs')::int; t := (r->>'time')::timestamptz;
    continue when m.id is null or s not in (60, 3600, 86400) or t is null or t > now();
    perform merge_bar(m.id, s, floor(extract(epoch from t) / s)::bigint,
      round((r->>'o')::numeric / m.tick_size) * m.tick_size, round((r->>'h')::numeric / m.tick_size) * m.tick_size,
      round((r->>'l')::numeric / m.tick_size) * m.tick_size, round((r->>'c')::numeric / m.tick_size) * m.tick_size,
      t, case when (r->>'complete')::boolean then t + make_interval(secs => s) - interval '1 millisecond' else least(now(), t + make_interval(secs => s)) end);
    n := n + 1;
  end loop;
  return jsonb_build_object('merged', n);
end $$;
revoke all on function public.backfill_bars(jsonb) from public, anon, authenticated;
