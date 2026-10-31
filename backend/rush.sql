-- Brokie · Rush mode: replay rounds on real historical candles (1 Nov 2026).
-- rush_candles() is candles() with a chosen end time, so a seed (market + bucket + end) gives every
-- player exactly the same bars. Read-only, public (challenge links work before signup). Rerunnable.
-- Requires bars.sql. Returns the <= p_limit (max 300) whole buckets that end at or before p_end
-- (capped at now()), oldest first, in the same shape as candles(): [{index, open, high, low, close}].

create or replace function public.rush_candles(p_market market, p_bucket_seconds integer default 60,
  p_end timestamptz default now(), p_limit integer default 100)
returns jsonb language sql stable security definer set search_path = public as $$
  with params as (
    select greatest(10, least(coalesce(p_bucket_seconds, 60), 86400)) as size, greatest(5, least(coalesce(p_limit, 100), 300)) as n,
           extract(epoch from least(coalesce(p_end, now()), now())) as e
  ), base as (
    select size, n, floor(e / size)::bigint as stop,     -- first bucket NOT returned (it holds p_end)
           case when size % 86400 = 0 then 86400 when size % 3600 = 0 then 3600 when size % 60 = 0 then 60 else 0 end as b
    from params
  ), from_bars as (           -- whole minutes and up: build from stored bars
    select floor(x.idx * base.b / base.size)::bigint as bucket,
           (array_agg(x.open order by x.idx asc))[1] as open, max(x.high) as high, min(x.low) as low,
           (array_agg(x.close order by x.idx desc))[1] as close
    from bars x, base
    where base.b > 0 and x.market = p_market and x.secs = base.b
      and x.idx >= (base.stop - base.n * 3) * base.size / base.b
      and x.idx <  base.stop * base.size / base.b
    group by 1
  ), from_ticks as (          -- under a minute (or odd sizes): straight from ticks, like candles()
    select floor(extract(epoch from t.quoted_at) / base.size)::bigint as bucket,
           (array_agg(t.price order by t.quoted_at asc))[1] as open, max(t.price) as high, min(t.price) as low,
           (array_agg(t.price order by t.quoted_at desc))[1] as close
    from quote_ticks t, base
    where base.b = 0 and t.market = p_market
      and t.quoted_at >= to_timestamp((base.stop - base.n * 3) * base.size)
      and t.quoted_at <  to_timestamp(base.stop * base.size)
    group by 1
  ), all_bars as (select * from from_bars union all select * from from_ticks)
  select coalesce(jsonb_agg(jsonb_build_object('index', bucket, 'open', open, 'high', high, 'low', low, 'close', close)
                            order by bucket), '[]'::jsonb)
  from (select * from all_bars order by bucket desc limit (select n from params)) last_bars
$$;

revoke all on function public.rush_candles(market, integer, timestamptz, integer) from public;
grant execute on function public.rush_candles(market, integer, timestamptz, integer) to anon, authenticated;
