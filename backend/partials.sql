-- Brokie: take partials. Run in the Supabase SQL editor after v3.sql. Safe to re-run.
--
-- reduce_position(market, side, quantity) closes `quantity` micros of your stack on that market and
-- side, newest orders first (so the oldest order, which carries your SL/TP, stays open longest).
-- An order bigger than what's left is split: the closed part becomes its own trade, the rest stays
-- open at its original entry price. Returns the closed micros and their total P&L.

create or replace function public.reduce_position(p_market public.market, p_side public.trade_side, p_quantity int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := require_user();
  v_season date := current_season();
  left_to_close int := p_quantity;
  leg positions;
  part positions;
  t trades;
  total numeric := 0;
  closed int := 0;
begin
  if p_quantity is null or p_quantity < 1 then
    raise exception 'Choose at least 1 micro to close.' using errcode = 'P0001';
  end if;
  perform 1 from accounts where user_id = uid and accounts.season = v_season for update;
  if not exists (select 1 from positions where user_id = uid and positions.season = v_season and market = p_market and side = p_side) then
    raise exception 'No % position on that market to take a partial from.', p_side using errcode = 'P0001';
  end if;

  for leg in
    select * from positions
     where user_id = uid and positions.season = v_season and market = p_market and side = p_side
     order by opened_at desc, id desc
     for update
  loop
    exit when left_to_close <= 0;
    if leg.quantity <= left_to_close then
      t := settle_position(leg, 'closed');
      left_to_close := left_to_close - leg.quantity;
      closed := closed + leg.quantity;
    else
      -- Split: settle the closed slice as its own trade (new id), keep the rest open.
      part := leg;
      part.id := gen_random_uuid();
      part.quantity := left_to_close;
      t := settle_position(part, 'closed');   -- its delete finds no row; only the trade + cash move
      update positions set quantity = quantity - left_to_close where id = leg.id;
      closed := closed + left_to_close;
      left_to_close := 0;
    end if;
    total := total + t.pnl;
  end loop;

  perform enforce_rules(uid, v_season);
  return jsonb_build_object('closed', closed, 'pnl', round(total, 2));
end $$;

revoke all on function public.reduce_position(public.market, public.trade_side, int) from public, anon;
grant execute on function public.reduce_position(public.market, public.trade_side, int) to authenticated;
