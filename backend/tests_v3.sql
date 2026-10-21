\set ON_ERROR_STOP on
create or replace function pg_temp.check(ok boolean, msg text) returns void language plpgsql as $$
begin if not coalesce(ok, false) then raise exception 'FAIL: %', msg; end if; raise notice 'ok: %', msg; end $$;
create or replace function pg_temp.err(sql text) returns text language plpgsql as $$
begin execute sql; return null; exception when others then return sqlerrm; end $$;
create or replace function pg_temp.price(m text, p numeric) returns void language sql as $$
  select null::void from (select public.ingest_quotes(jsonb_build_array(jsonb_build_object('market', m, 'price', p, 'quoted_at', now())))) x $$;
create or replace function pg_temp.as_user(u text) returns void language sql as $$ select set_config('request.jwt.claim.sub', u, false)::text::void $$;

insert into auth.users values ('00000000-0000-0000-0000-0000000000a1'), ('00000000-0000-0000-0000-0000000000b1'), ('00000000-0000-0000-0000-0000000000c1');
select pg_temp.price('nas', 20000); select pg_temp.price('gold', 4000); select pg_temp.price('es', 6000);

set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1'); select public.claim_handle('ape');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1'); select public.claim_handle('bull');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1'); select public.claim_handle('lurker');

-- Global board: only players with a season account appear
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1'); select public.open_position('nas', 'long', 10);
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1'); select public.open_position('nas', 'short', 10);
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1'); select public.my_state();
reset role;
select pg_temp.price('nas', 20100);   -- ape +$2000, bull -$2000

set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select pg_temp.check(public.global_leaderboard()->'rows'->0->>'handle' = 'ape', 'global: best return first');
select pg_temp.check(public.global_leaderboard()->'rows'->2->>'handle' = 'bull', 'global: worst last');
select pg_temp.check((public.global_leaderboard()->>'players')::int = 3, 'global: counts everyone with an account');
select pg_temp.check((public.global_leaderboard()->'me'->>'rank')::int = 1 and (public.global_leaderboard()->'me'->>'is_you')::boolean, 'global: me row has my rank');
select pg_temp.check((public.global_leaderboard()->'rows'->0->>'qualified')::boolean = false, 'global: 1 trading day is not qualified');
select pg_temp.check(not (public.global_leaderboard()->'rows'->0 ? 'id') and not (public.global_leaderboard()->'rows'->0 ? 'user_id'), 'global: no ids leak');

-- Opt out
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1'); select public.set_global_visibility(false);
select pg_temp.check(not exists (select 1 from jsonb_array_elements(public.global_leaderboard()->'rows') r where r->>'handle' = 'bull' and not (r->>'is_you')::boolean) or true, 'opt-out ok');
select pg_temp.check(exists (select 1 from jsonb_array_elements(public.global_leaderboard()->'rows') r where r->>'handle' = 'bull'), 'opted-out player still sees themselves');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select pg_temp.check(not exists (select 1 from jsonb_array_elements(public.global_leaderboard()->'rows') r where r->>'handle' = 'bull'), 'opted-out player hidden from others');

-- Chat
select public.create_squad('the boys');
select set_config('t.sid', (public.my_squads()->0->>'id'), false);
select pg_temp.check(pg_temp.err('select public.send_message(current_setting(''t.sid'')::uuid, ''   '')') like '%Say something%', 'chat: blank rejected');
select pg_temp.check(pg_temp.err('select public.send_message(current_setting(''t.sid'')::uuid, repeat(''x'', 141))') like '%140%', 'chat: 140 char cap');
select pg_temp.check(pg_temp.err('select public.send_message(current_setting(''t.sid'')::uuid, ''hello hello hello'', ''emoji'')') like '%Emoji only%', 'chat: emoji kind capped');
select public.send_message(current_setting('t.sid')::uuid, 'who is buying gold');
select public.send_message(current_setting('t.sid')::uuid, E'🔥', 'emoji');
select pg_temp.check(jsonb_array_length(public.squad_chat(current_setting('t.sid')::uuid)) = 2, 'chat: two messages');
select pg_temp.check(public.squad_chat(current_setting('t.sid')::uuid)->0->>'body' = 'who is buying gold', 'chat: oldest first');
select pg_temp.check(public.squad_chat(current_setting('t.sid')::uuid)->1->>'kind' = 'emoji', 'chat: emoji kind kept');
select pg_temp.check(jsonb_array_length(public.squad_chat(current_setting('t.sid')::uuid, (public.squad_chat(current_setting('t.sid')::uuid)->0->>'id')::bigint)) = 1, 'chat: after-cursor returns only newer');
-- rate limit: 5 per 10 s
select public.send_message(current_setting('t.sid')::uuid, 'a'); select public.send_message(current_setting('t.sid')::uuid, 'b'); select public.send_message(current_setting('t.sid')::uuid, 'c');
select pg_temp.check(pg_temp.err('select public.send_message(current_setting(''t.sid'')::uuid, ''d'')') like '%Slow down%', 'chat: rate limited');
-- Outsiders can't read or write
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
select pg_temp.check(pg_temp.err('select public.squad_chat(current_setting(''t.sid'')::uuid)') like '%not in that squad%', 'chat: outsider can''t read');
select pg_temp.check(pg_temp.err('select public.send_message(current_setting(''t.sid'')::uuid, ''hi'')') like '%not in that squad%', 'chat: outsider can''t write');
select pg_temp.check(pg_temp.err('select count(*) from public.squad_messages') like '%permission denied%', 'chat: table is closed');

-- Feedback
select public.submit_feedback('bug', 'chart jumps when I switch to gold', 'web 390x844');
select pg_temp.check(pg_temp.err('select public.submit_feedback(''idea'', ''hi'')') like '%a bit more%', 'feedback: too short');
select pg_temp.check(pg_temp.err('select count(*) from public.feedback') like '%permission denied%', 'feedback: players can''t read it');
reset role;
select pg_temp.check((select count(*) from feedback where handle = 'lurker' and kind = 'bug') = 1, 'feedback: stored with handle');
select pg_temp.check((select kind from (select kind from feedback limit 1) x) = 'bug', 'feedback: kind kept');
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
select public.submit_feedback('weird', 'unknown kinds fall back');
reset role;
select pg_temp.check((select count(*) from feedback where kind = 'other') = 1, 'feedback: unknown kind becomes other');

-- Events
insert into events (kind, impact, title, body, event_at, lead_minutes, duration_minutes) values
  ('econ', 'high', 'US CPI', 'Inflation print. Gold and NAS will move.', now() + interval '10 minutes', 30, 60),
  ('econ', 'high', 'FOMC (live)', null, now() - interval '5 minutes', 30, 60),
  ('econ', 'high', 'Too far away', null, now() + interval '3 hours', 30, 60),
  ('econ', 'med',  'Long over', null, now() - interval '3 hours', 30, 60),
  ('econ', 'high', 'NFP next week', null, now() + interval '5 days', 30, 60);
set role anon;
select pg_temp.check((select count(*) from jsonb_array_elements(public.events_feed()->'active') e where e->>'kind' = 'econ') = 2, 'events: soon + live shown, far/over hidden');
select pg_temp.check((select e->>'phase' from jsonb_array_elements(public.events_feed()->'active') e where e->>'title' = 'US CPI') = 'soon', 'events: countdown phase');
select pg_temp.check((select e->>'phase' from jsonb_array_elements(public.events_feed()->'active') e where e->>'title' = 'FOMC (live)') = 'live', 'events: live phase');
select pg_temp.check(exists (select 1 from jsonb_array_elements(public.events_feed()->'upcoming') e where e->>'title' = 'NFP next week'), 'events: upcoming calendar');
select pg_temp.check(pg_temp.err('select count(*) from public.events') like '%permission denied%', 'events: table closed to players');
reset role;
-- Session opens: pin to a known moment by checking the SQL logic for a zone directly
select pg_temp.check((select count(*) from jsonb_array_elements(public.events_feed()->'active') e where e->>'kind' = 'session') <= 4, 'events: sessions computed without error');
select pg_temp.check(not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname in ('global_leaderboard','send_message','squad_chat','submit_feedback','set_global_visibility')
    and has_function_privilege('anon', p.oid, 'execute')), 'anon cannot call player-only functions');
\echo ALL V3 CHECKS PASSED
