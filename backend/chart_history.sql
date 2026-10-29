-- Apply after predictions.sql and rules_v4.sql (safe to run again).
-- Every authorized player's fills in the loaded chart history, without a shared
-- row limit. Open positions are always returned, even if opened before p_from.
-- The default keeps older clients on their existing 24-hour history window.
begin;

create or replace function public.chart_bubbles(p_market public.market, p_squad uuid default null, p_from timestamptz default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := require_user();
begin
  if p_squad is not null then perform require_member(p_squad); end if;
  return coalesce((
    select jsonb_agg(row_to_json(b) order by b.at)
    from (
      select 'open'::text as state, o.id, p.handle, o.user_id = uid as is_you, o.side, o.quantity, o.entry_price,
             null::numeric as exit_price, null::numeric as pnl, null::text as reason, o.opened_at as at, o.opened_at,
             round(position_margin(o) / nullif(a.cash + unrealized(o.user_id, o.season), 0) * 100, 2) as size_pct,
             dd_floor(a) as dd_floor,
             a.cash + unrealized(o.user_id, o.season) as equity, o.prediction_id, o.prediction_outcome,
             (select title from prediction_markets where id=o.prediction_id) as prediction_question, position_mark(o) as mark_price
      from positions o
      join profiles p on p.id = o.user_id
      join accounts a on a.user_id = o.user_id and a.season = o.season
      where o.market = p_market and o.season = current_season()
        and (o.user_id = uid or (p_squad is not null and exists (select 1 from squad_members m where m.squad_id = p_squad and m.user_id = o.user_id)))
      union all
      select * from (
        select 'closed'::text, t.id, p.handle, t.user_id = uid, t.side, t.quantity, t.entry_price, t.exit_price, t.pnl, t.reason,
               t.closed_at, t.opened_at, null::numeric, null::numeric, null::numeric,
               t.prediction_id, t.prediction_outcome, t.prediction_question, t.exit_price
        from trades t join profiles p on p.id = t.user_id
        where t.market = p_market and t.season = current_season() and t.closed_at >= coalesce(p_from, now() - interval '24 hours')
          and (t.user_id = uid or (p_squad is not null and exists (select 1 from squad_members m where m.squad_id = p_squad and m.user_id = t.user_id)))
        order by t.closed_at desc, t.id
      ) recent
    ) b), '[]'::jsonb);
end $$;

-- Replace the old two-argument overload so PostgREST resolves both old and new
-- clients to this function. Restrict the new signature before committing.
drop function if exists public.chart_bubbles(public.market, uuid);
revoke all on function public.chart_bubbles(public.market, uuid, timestamptz) from public, anon;
grant execute on function public.chart_bubbles(public.market, uuid, timestamptz) to authenticated;
notify pgrst, 'reload schema';
commit;
