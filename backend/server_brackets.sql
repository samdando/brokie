-- Server-owned paper SL/TP. Apply after clean_floor.sql. Re-runnable.
begin;
alter table public.positions add column if not exists stop_loss numeric;
alter table public.positions add column if not exists take_profit numeric;
alter table public.positions add column if not exists bracket_after_quote timestamptz;
alter table public.trades add column if not exists trigger_price numeric;
create table if not exists public.bracket_audit (
 id bigint generated always as identity primary key,
 user_id uuid not null, position_id uuid not null, at timestamptz not null default now(),
 action text not null, details jsonb not null
);
alter table public.bracket_audit enable row level security;
revoke all on public.bracket_audit from public,anon,authenticated;
alter table public.trades drop constraint if exists trades_reason_check;
alter table public.trades add constraint trades_reason_check check
 (reason in ('closed','liquidated','season_end','daily_limit','blown','reset','sl_fix','rules_fix','market_close','prediction_settled','stop_loss','take_profit'));

-- One edit applies to every leg of the selected market/side stack, atomically.
create or replace function public.set_position_bracket(p_position uuid,p_kind text,p_price numeric default null) returns jsonb
language plpgsql security definer set search_path=public as $$
declare uid uuid:=require_user(); p positions; q quotes; a accounts; level numeric; leg positions;
begin
 if p_kind is null or p_kind not in ('sl','tp') then raise exception 'Choose SL or TP.'; end if;
 select * into a from accounts where user_id=uid and season=current_season() for update;
 select * into p from positions where id=p_position and user_id=uid and season=current_season() for update;
 if not found then raise exception 'This position is already closed.'; end if;
 if p.market='prediction' then raise exception 'SL/TP is available for trading markets only.'; end if;
 if a.status<>'active' or p.session_closes_at<=now() then raise exception 'This position is no longer available for SL/TP.'; end if;
 select * into q from quotes where market=p.market;
 if p_price is not null then
   if p_price::text in ('NaN','Infinity','-Infinity') or p_price<=0 or p_price>10000000 then raise exception 'Choose a valid price.'; end if;
   if q.price is null or q.quoted_at<now()-interval '45 seconds' or q.quoted_at>now()+interval '5 seconds' then raise exception 'Waiting for a fresh price. Stop was not saved.'; end if;
   select round(p_price/tick_size)*tick_size into level from markets where id=p.market;
   if level<=0 or ((p_kind='sl' and p.side='long') or (p_kind='tp' and p.side='short')) and level>=q.price
     or ((p_kind='sl' and p.side='short') or (p_kind='tp' and p.side='long')) and level<=q.price then
     raise exception 'Price has already crossed that level. Stop was not saved.';
   end if;
 end if;
 for leg in select * from positions where user_id=uid and season=p.season and market=p.market and side=p.side order by id for update loop
   update positions set stop_loss=case when p_kind='sl' then level else stop_loss end,
     take_profit=case when p_kind='tp' then level else take_profit end,
     bracket_after_quote=q.quoted_at where id=leg.id;
   insert into bracket_audit(user_id,position_id,action,details) values(uid,leg.id,case when level is null then 'cancel' else 'save' end,
     jsonb_build_object('kind',p_kind,'price',level,'market',p.market,'side',p.side,'quantity',leg.quantity,'quote',q.price,'quoted_at',q.quoted_at));
 end loop;
 return jsonb_build_object('positions',(select jsonb_agg(jsonb_build_object('id',id,'stop_loss',stop_loss,'take_profit',take_profit)) from positions where user_id=uid and season=p.season and market=p.market and side=p.side));
end $$;

-- Adding size to an already protected stack inherits its server-confirmed levels.
create or replace function public.inherit_position_bracket() returns trigger
language plpgsql security definer set search_path=public as $$
declare old_leg positions;
begin
 if new.market='prediction' then return new; end if;
 select * into old_leg from positions where user_id=new.user_id and season=new.season and market=new.market and side=new.side
   and (stop_loss is not null or take_profit is not null) order by opened_at,id limit 1;
 if found then
   new.stop_loss:=old_leg.stop_loss; new.take_profit:=old_leg.take_profit;
   new.bracket_after_quote:=(select quoted_at from quotes where market=new.market);
   insert into bracket_audit(user_id,position_id,action,details) values(new.user_id,new.id,'inherit',jsonb_build_object('sl',new.stop_loss,'tp',new.take_profit,'from',old_leg.id));
 end if;
 return new;
end $$;
drop trigger if exists inherit_position_bracket on public.positions;
create trigger inherit_position_bracket before insert on public.positions for each row execute function public.inherit_position_bracket();

-- Called for each newly accepted quote, before account loss checks. A stop is a
-- market trigger: fill at that observed quote, never invent a fill at the level.
create or replace function public.process_position_brackets(p_market public.market) returns int
language plpgsql security definer set search_path=public as $$
declare q quotes; a record; p positions; hit text; level numeric; n int:=0; receipt trades;
begin
 select * into q from quotes where market=p_market;
 if q.price is null then return 0; end if;
 for a in select distinct user_id,season from positions where market=p_market and (stop_loss is not null or take_profit is not null) order by user_id,season loop
   perform 1 from accounts where user_id=a.user_id and season=a.season for update;
   if exists(select 1 from positions where user_id=a.user_id and season=a.season and session_closes_at<=now()) then continue; end if;
   for p in select * from positions where user_id=a.user_id and season=a.season and market=p_market order by id for update loop
     if q.quoted_at<=p.bracket_after_quote or q.quoted_at<p.opened_at or q.quoted_at>=p.session_closes_at then continue; end if;
     hit:=null; level:=null;
     if p.stop_loss is not null and ((p.side='long' and q.price<=p.stop_loss) or (p.side='short' and q.price>=p.stop_loss)) then hit:='stop_loss'; level:=p.stop_loss;
     elsif p.take_profit is not null and ((p.side='long' and q.price>=p.take_profit) or (p.side='short' and q.price<=p.take_profit)) then hit:='take_profit'; level:=p.take_profit; end if;
     if hit is null then continue; end if;
     receipt:=settle_position(p,hit);
     update trades set trigger_price=level where id=receipt.id;
     insert into bracket_audit(user_id,position_id,action,details) values(p.user_id,p.id,hit,jsonb_build_object('trigger',level,'fill',q.price,'quoted_at',q.quoted_at,'pnl',receipt.pnl));
     n:=n+1;
   end loop;
   perform enforce_rules(a.user_id,a.season);
 end loop;
 return n;
end $$;

-- Flat locked accounts previously waited for the player to reopen the app.
create or replace function public.refresh_daily_locks() returns int
language plpgsql security definer set search_path=public as $$
declare a record; n int:=0;
begin
 for a in select user_id,season from accounts where season=current_season() and status='locked' and trading_day<trading_today() order by user_id loop
   if enforce_rules(a.user_id,a.season)='active' then n:=n+1; end if;
 end loop;
 return n;
end $$;

-- Guarded patch keeps the live feed's existing validation and settlement logic.
do $$ declare src text;
begin
 src:=pg_get_functiondef('public.ingest_quotes(jsonb)'::regprocedure);
 if position('process_position_brackets' in src)=0 then
   if position('accepted := accepted + 1;' in src)=0 then raise exception 'Unknown ingest_quotes version'; end if;
   src:=replace(src,'accepted := accepted + 1;','if found then perform process_position_brackets(m.id); end if; accepted := accepted + 1;');
   src:=replace(src,'perform settle_market_closes();','perform settle_market_closes(); perform refresh_daily_locks();');
   execute src;
 end if;
 src:=pg_get_functiondef('public.my_state()'::regprocedure);
 if position($patch$'unlock_at'$patch$ in src)=0 then
   src:=replace(src,$patch$'status', acct.status,$patch$,$patch$'status', acct.status, 'unlock_at', case when acct.status='locked' then trading_day_ends_at() else null end,$patch$);
   if position($patch$'unlock_at'$patch$ in src)=0 then raise exception 'Unknown my_state version'; end if;
   execute src;
 end if;
end $$;
revoke all on function public.set_position_bracket(uuid,text,numeric),public.inherit_position_bracket(),public.process_position_brackets(public.market),public.refresh_daily_locks() from public,anon,authenticated;
grant execute on function public.set_position_bracket(uuid,text,numeric) to authenticated;
do $$ begin
 if exists(select 1 from cron.job where jobname='brokie-daily-unlock') then perform cron.unschedule('brokie-daily-unlock'); end if;
 perform cron.schedule('brokie-daily-unlock','* * * * *','select public.refresh_daily_locks()');
end $$;
select public.refresh_daily_locks();
notify pgrst, 'reload schema';
commit;
