-- No new opposing positions on the same market. The account lock serializes
-- simultaneous opens. Existing positions and receipts remain untouched;
-- reduce_position still settles slices and preserves the remaining bracket.
begin;
create or replace function public.guard_one_direction() returns trigger
language plpgsql security definer set search_path=public as $$
begin
 if new.market='prediction' then return new; end if;
 perform 1 from accounts where user_id=new.user_id and season=new.season for update;
 if exists(select 1 from positions p where p.user_id=new.user_id and p.season=new.season
   and p.market=new.market and p.side<>new.side and p.id<>new.id) then
   raise exception 'Reduce or close your existing position before opening the other direction.' using errcode='P0001';
 end if;
 return new;
end $$;
drop trigger if exists one_direction_per_market on public.positions;
create trigger one_direction_per_market before insert or update of side,market,user_id,season on public.positions
 for each row execute function public.guard_one_direction();
revoke all on function public.guard_one_direction() from public,anon,authenticated;
notify pgrst,'reload schema';
commit;
