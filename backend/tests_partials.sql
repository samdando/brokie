\set ON_ERROR_STOP on
-- Run after supabase_stub, schema, seasons_v2, v3 and partials.
create or replace function pg_temp.check(ok boolean, msg text) returns void language plpgsql as $$
begin if not coalesce(ok, false) then raise exception 'FAIL: %', msg; end if; raise notice 'ok: %', msg; end $$;
create or replace function pg_temp.err(sql text) returns text language plpgsql as $$
begin execute sql; return null; exception when others then return sqlerrm; end $$;
create or replace function pg_temp.price(m text, p numeric) returns void language sql as $$
  select null::void from (select public.ingest_quotes(jsonb_build_array(jsonb_build_object('market', m, 'price', p, 'quoted_at', now())))) x $$;
create or replace function pg_temp.as_user(u text) returns void language sql as $$ select set_config('request.jwt.claim.sub', u, false)::text::void $$;

insert into auth.users values ('00000000-0000-0000-0000-0000000000f1'), ('00000000-0000-0000-0000-0000000000f2');
select pg_temp.price('nas', 20000); select pg_temp.price('gold', 4000); select pg_temp.price('es', 6000);

set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f1');
select public.claim_handle('fuko');
select public.open_position('nas', 'long', 10);
select public.open_position('nas', 'long', 4);
select public.open_position('nas', 'short', 3);   -- a hedge leg must be left alone
reset role;
update positions set opened_at = now() - interval '2 minutes' where quantity = 10;   -- the oldest order

select pg_temp.price('nas', 20010);   -- +10 pts = +$20 per micro on a long

set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-0000000000f1');
select pg_temp.check(pg_temp.err('select public.reduce_position(''nas'',''long'',0)') like '%at least 1%', 'rejects 0');
select pg_temp.check(pg_temp.err('select public.reduce_position(''gold'',''long'',1)') like '%No long position%', 'rejects a market with no stack');

-- Take 6 off a 14-micro long: closes the newer 4-lot whole, then splits 2 off the 10-lot.
select pg_temp.check((public.reduce_position('nas', 'long', 6)->>'closed')::int = 6, 'closed 6 micros');
reset role;
select pg_temp.check((select sum(quantity) from positions where user_id = '00000000-0000-0000-0000-0000000000f1' and side = 'long') = 8, '8 long micros left');
select pg_temp.check((select count(*) from positions where user_id = '00000000-0000-0000-0000-0000000000f1' and side = 'long') = 1, 'oldest order survives (keeps its SL/TP id)');
select pg_temp.check((select entry_price from positions where user_id = '00000000-0000-0000-0000-0000000000f1' and side = 'long') = 20000, 'remaining order keeps its entry');
select pg_temp.check((select sum(quantity) from positions where user_id = '00000000-0000-0000-0000-0000000000f1' and side = 'short') = 3, 'hedge leg untouched');
select pg_temp.check((select count(*) from trades where user_id = '00000000-0000-0000-0000-0000000000f1') = 2, 'two trades booked (whole 4-lot + 2-lot slice)');
select pg_temp.check((select sum(pnl) from trades where user_id = '00000000-0000-0000-0000-0000000000f1') = 120, 'P&L = 6 micros x $20');
select pg_temp.check((select cash from accounts where user_id = '00000000-0000-0000-0000-0000000000f1') = 100120, 'cash credited');

-- Asking for more than you hold just closes the lot.
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-0000000000f1');
select pg_temp.check((public.reduce_position('nas', 'long', 50)->>'closed')::int = 8, 'over-ask closes the rest');
reset role;
select pg_temp.check((select count(*) from positions where user_id = '00000000-0000-0000-0000-0000000000f1' and side = 'long') = 0, 'long stack gone');

-- Someone else can't touch it.
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-0000000000f2');
select public.claim_handle('other');
select pg_temp.check(pg_temp.err('select public.reduce_position(''nas'',''short'',1)') like '%No short position%', 'cannot reduce another player''s stack');
reset role;
select pg_temp.check((select sum(quantity) from positions where user_id = '00000000-0000-0000-0000-0000000000f1' and side = 'short') = 3, 'their hedge still there');

-- Anonymous callers are refused.
set role anon;
select pg_temp.check(pg_temp.err('select public.reduce_position(''nas'',''short'',1)') like '%permission denied%', 'anon refused');
reset role;
