-- Four reviewed, unused tester candidates only. Requires explicit deletion
-- confirmation. A renamed or newly active account aborts the entire batch.
begin;
create temp table test_candidates(handle text primary key,created_at timestamptz) on commit drop;
insert into test_candidates values
 ('chartgremlin','2026-10-29 14:09:33.885073+00'),
 ('brokietester99','2026-10-29 14:15:16.426336+00'),
 ('brokiefan2026','2026-10-31 05:42:54.45462+00'),
 ('uitesterx','2026-10-31 05:50:15.448334+00');
create temp table reviewed_test_accounts on commit drop as
 select p.id,p.handle,p.created_at from public.profiles p join test_candidates c using(handle);
do $$ begin
 perform 1 from public.profiles p join reviewed_test_accounts d using(id) for update of p;
 perform 1 from public.accounts a join reviewed_test_accounts d on d.id=a.user_id for update of a;
 if exists(select 1 from reviewed_test_accounts d join test_candidates c using(handle) where d.created_at<>c.created_at)
 or exists(select 1 from trades t join reviewed_test_accounts d on d.id=t.user_id)
 or exists(select 1 from positions o join reviewed_test_accounts d on d.id=o.user_id)
 or exists(select 1 from squad_members m join reviewed_test_accounts d on d.id=m.user_id)
 or exists(select 1 from squads s join reviewed_test_accounts d on d.id=s.owner_id)
 or exists(select 1 from accounts a join reviewed_test_accounts d on d.id=a.user_id where a.cash<>a.start_balance)
 then raise exception 'A candidate changed or has real activity. No accounts were deleted.'; end if;
end $$;
delete from auth.users where id in(select id from reviewed_test_accounts);
select handle as removed from reviewed_test_accounts order by handle;
commit;
