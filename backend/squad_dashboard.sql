-- Exact daily totals and current open trades; membership checked server-side.
begin;
create or replace function squad_dashboard(p_squad uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare uid uuid:=require_member(p_squad); day date:=trading_today();
begin
 return jsonb_build_object('day',day,'ends_at',trading_day_ends_at(),
 'players',coalesce((select jsonb_agg(to_jsonb(r) order by r.pnl desc,r.handle) from (
  select p.handle, count(t.id) as trades, count(t.id) filter(where t.pnl>0) as wins,
   count(t.id) filter(where t.pnl<0) as losses, coalesce(sum(t.pnl),0) as pnl
  from squad_members sm join profiles p on p.id=sm.user_id
  left join trades t on t.user_id=p.id and t.season=current_season() and trading_day_of(t.closed_at)=day
  where sm.squad_id=p_squad group by p.handle
 )r),'[]'::jsonb),
 'open',coalesce((select jsonb_agg(to_jsonb(r) order by r.opened_at desc) from (
  select p.handle,o.market,o.side,sum(o.quantity) as quantity,
   sum(o.quantity*o.entry_price)/sum(o.quantity) as entry_price,min(o.opened_at) as opened_at
  from positions o join squad_members sm on sm.user_id=o.user_id and sm.squad_id=p_squad
  join profiles p on p.id=o.user_id where o.season=current_season()
  group by p.handle,o.market,o.side
 )r),'[]'::jsonb));
end $$;
revoke all on function squad_dashboard(uuid) from public,anon;
grant execute on function squad_dashboard(uuid) to authenticated;
commit;
