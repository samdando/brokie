-- Removes Claude's test accounts plus the "zz" and "xcode" test handles from Brokie.
-- Paste into the Supabase SQL editor and run. Safe to re-run.

begin;

create temp table doomed on commit drop as
  select id, handle from public.profiles
  where handle ilike '%claude%' or handle ilike 'zz%' or handle ilike 'xcode%';

-- Squads owned by a test account would be deleted with it (owner_id cascades).
-- Hand them to the longest-standing real member first so testers keep their squad.
update public.squads s
set owner_id = (
  select m.user_id from public.squad_members m
  where m.squad_id = s.id and m.user_id not in (select id from doomed)
  order by m.joined_at limit 1)
where s.owner_id in (select id from doomed)
  and exists (select 1 from public.squad_members m
              where m.squad_id = s.id and m.user_id not in (select id from doomed));

-- Deleting the auth user cascades to profile, accounts, positions, trades,
-- squad memberships and backup codes, so they drop off every leaderboard.
delete from auth.users where id in (select id from doomed);

select handle as removed from doomed order by handle;

commit;
