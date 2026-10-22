-- Apply after schema.sql and seasons_v2.sql. Sharing is opt-in per closed trade.
begin;
create table if not exists public.trade_shares (
  token uuid primary key default gen_random_uuid(),
  trade_id uuid not null unique references public.trades(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.trade_shares enable row level security;
revoke all on public.trade_shares from public, anon, authenticated;

create or replace function public.share_trade(p_trade uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user(); result uuid;
begin
  if not exists(select 1 from trades where id = p_trade and user_id = uid) then
    raise exception 'Trade not found';
  end if;
  insert into trade_shares(trade_id) values(p_trade) on conflict(trade_id) do nothing;
  select token into result from trade_shares where trade_id = p_trade;
  return result;
end $$;

create or replace function public.shared_trade(p_token uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('handle', p.handle, 'trade', jsonb_build_object(
    'id', t.id, 'market', t.market, 'side', t.side, 'quantity', t.quantity,
    'entry_price', t.entry_price, 'exit_price', t.exit_price, 'pnl', t.pnl,
    'opened_at', t.opened_at, 'closed_at', t.closed_at, 'reason', t.reason),
    'bucket_seconds', history.size, 'candles', history.bars)
  from trade_shares s join trades t on t.id = s.trade_id join profiles p on p.id = t.user_id
  cross join lateral (
    with params as (
      select greatest(60, ceil(extract(epoch from (t.closed_at - t.opened_at)) / 60)::int) as size
    ), ticks as (
      select floor(extract(epoch from q.quoted_at) / params.size)::bigint as bucket, q.price, q.quoted_at
      from quote_ticks q, params
      where q.market = t.market
        and q.quoted_at >= t.opened_at - make_interval(secs => params.size * 3)
        and q.quoted_at <= t.closed_at + make_interval(secs => params.size * 3)
    ), bars as (
      select bucket, (array_agg(price order by quoted_at))[1] as open,
        max(price) as high, min(price) as low, (array_agg(price order by quoted_at desc))[1] as close
      from ticks group by bucket
    )
    select params.size, coalesce((select jsonb_agg(jsonb_build_object(
      'index', bucket, 'open', open, 'high', high, 'low', low, 'close', close
    ) order by bucket) from bars), '[]'::jsonb) as bars from params
  ) history
  where s.token = p_token
$$;
revoke all on function public.share_trade(uuid), public.shared_trade(uuid) from public, anon, authenticated;
grant execute on function public.share_trade(uuid) to authenticated;
grant execute on function public.shared_trade(uuid) to anon, authenticated;
commit;
