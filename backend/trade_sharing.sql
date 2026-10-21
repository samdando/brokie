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
    'closed_at', t.closed_at, 'reason', t.reason))
  from trade_shares s join trades t on t.id = s.trade_id join profiles p on p.id = t.user_id
  where s.token = p_token
$$;
revoke all on function public.share_trade(uuid), public.shared_trade(uuid) from public, anon, authenticated;
grant execute on function public.share_trade(uuid) to authenticated;
grant execute on function public.shared_trade(uuid) to anon, authenticated;
commit;
