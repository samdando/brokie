-- Run after predictions.sql. Predictions are isolated from the competition ledger.
begin;
-- Never silently convert or discard legacy paper-dollar exposure.
do $$ begin
 if exists(select 1 from positions where market='prediction') or exists(select 1 from trades where market='prediction') then
  raise exception 'Legacy paper predictions require reconciliation before enabling tokens.';
 end if;
end $$;
alter table positions drop constraint if exists positions_quantity_check;
alter table positions add constraint positions_quantity_check check(quantity between 1 and 10);
alter table positions drop constraint if exists positions_competition_only;
alter table positions add constraint positions_competition_only check(market<>'prediction');
alter table trades drop constraint if exists trades_competition_only;
alter table trades add constraint trades_competition_only check(market<>'prediction');
create table if not exists public.prediction_wallets (
 user_id uuid primary key references profiles(id) on update cascade on delete cascade,
 balance numeric not null default 0 check(balance>=0 and balance<'Infinity'::numeric)
);
create table if not exists public.prediction_rewards (
 user_id uuid not null references profiles(id) on update cascade on delete cascade,
 trading_day date not null, awarded_at timestamptz not null default now(),
 primary key(user_id,trading_day)
);
create table if not exists public.prediction_positions (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references profiles(id) on update cascade on delete cascade,
 prediction_id text not null references prediction_markets(id),
 prediction_outcome text not null check(prediction_outcome in ('yes','no')),
 quantity numeric not null check(quantity>0 and quantity<'Infinity'::numeric),
 entry_price numeric not null check(entry_price>0 and entry_price<1),
 cost numeric not null check(cost>0 and cost<'Infinity'::numeric),
 opened_at timestamptz not null default now()
);
create index if not exists prediction_positions_owner on prediction_positions(user_id);
create table if not exists public.prediction_trades (
 id uuid primary key, user_id uuid not null references profiles(id) on update cascade on delete cascade,
 prediction_id text not null references prediction_markets(id), prediction_outcome text not null,
 prediction_question text not null, quantity numeric not null, entry_price numeric not null,
 exit_price numeric not null, cost numeric not null, payout numeric not null, pnl numeric not null,
 opened_at timestamptz not null, closed_at timestamptz not null default now(), reason text not null
);
create index if not exists prediction_trades_owner on prediction_trades(user_id,closed_at desc);
alter table prediction_wallets enable row level security;
alter table prediction_rewards enable row level security;
alter table prediction_positions enable row level security;
alter table prediction_trades enable row level security;
revoke all on prediction_wallets,prediction_rewards,prediction_positions,prediction_trades from public,anon,authenticated;

-- A unique user/day entry and an atomic increment prevent duplicate/concurrent rewards.
create or replace function public.award_prediction_token(p_user uuid,p_day date) returns void
language plpgsql security definer set search_path=public as $$
begin
 insert into prediction_rewards(user_id,trading_day) values(p_user,p_day) on conflict do nothing;
 if found then
  insert into prediction_wallets(user_id,balance) values(p_user,1)
  on conflict(user_id) do update set balance=prediction_wallets.balance+1;
 end if;
end $$;
create or replace function public.reward_prediction_trading_day() returns trigger
language plpgsql security definer set search_path=public as $$
begin
 if new.market='prediction' then raise exception 'Predictions use the separate token wallet.'; end if;
 -- Manual entries/exits count. Automatic settlement and account resets do not.
 if tg_table_name='positions' then perform award_prediction_token(new.user_id,trading_today());
 elsif new.reason='closed' then perform award_prediction_token(new.user_id,trading_today()); end if;
 return new;
end $$;
drop trigger if exists reward_prediction_trading_day on positions;
create trigger reward_prediction_trading_day after insert on positions for each row execute function reward_prediction_trading_day();
drop trigger if exists reward_prediction_trading_day on trades;
create trigger reward_prediction_trading_day after insert on trades for each row execute function reward_prediction_trading_day();
-- Include players who already traded today when this feature is installed; no retroactive farming.
do $$ declare u uuid; begin
 for u in select user_id from positions where market<>'prediction' and trading_day_of(opened_at)=trading_today()
 union select user_id from trades where market<>'prediction' and
 (trading_day_of(opened_at)=trading_today() or (reason='closed' and trading_day_of(closed_at)=trading_today()))
 loop perform award_prediction_token(u,trading_today()); end loop;
end $$;

create or replace function public.prediction_board() returns jsonb language plpgsql security definer set search_path=public as $$
declare uid uuid:=require_user();
begin
 return jsonb_build_object(
 'balance',coalesce((select balance from prediction_wallets where user_id=uid),0),
 'earned_today',exists(select 1 from prediction_rewards where user_id=uid and trading_day=trading_today()),
 'next_reward_at',trading_day_ends_at(),
 'markets',coalesce((select jsonb_agg(to_jsonb(m) order by volume desc) from (
  select * from prediction_markets where (status='active' and close_at>now() and quoted_at>now()-interval '3 minutes')
   or id in(select prediction_id from prediction_positions where user_id=uid) order by (id in(select prediction_id from prediction_positions where user_id=uid)) desc,volume desc limit 60) m),'[]'::jsonb),
 'positions',coalesce((select jsonb_agg(to_jsonb(p)||jsonb_build_object('prediction_question',m.title,'mark_price',
  case when m.payout_yes is not null then case when p.prediction_outcome='yes' then m.payout_yes else 1-m.payout_yes end
  else case when p.prediction_outcome='yes' then m.yes_bid else m.no_bid end end) order by p.opened_at)
  from prediction_positions p join prediction_markets m on m.id=p.prediction_id where p.user_id=uid),'[]'::jsonb),
 'trades',coalesce((select jsonb_agg(to_jsonb(t) order by t.closed_at desc) from
  (select * from prediction_trades where user_id=uid order by closed_at desc limit 30)t),'[]'::jsonb));
end $$;
create or replace function public.open_prediction(p_market text,p_outcome text,p_stake numeric default 1) returns jsonb
language plpgsql security definer set search_path=public as $$
declare uid uuid:=require_user(); m prediction_markets; ask numeric; qty numeric; cost numeric; available numeric; p prediction_positions;
begin
 if p_outcome is null or p_outcome not in ('yes','no') or p_stake is null or not(p_stake between 1 and 1000) or p_stake<>trunc(p_stake) then
  raise exception 'Choose Yes or No and a whole-token stake between 1 and 1,000.';
 end if;
 insert into prediction_wallets(user_id) values(uid) on conflict do nothing;
 select balance into available from prediction_wallets where user_id=uid for update;
 select * into m from prediction_markets where id=p_market for share;
 if not found or m.status<>'active' or m.close_at<=now() or m.quoted_at<now()-interval '90 seconds' or m.quoted_at>now()+interval '5 seconds' or m.payout_yes is not null then
  raise exception 'This prediction is closed or its prices are stale.';
 end if;
 ask:=case when p_outcome='yes' then m.yes_ask else m.no_ask end;
 if ask<=0 or ask>=1 then raise exception 'No executable price for this outcome.'; end if;
 if available<p_stake then raise exception 'Not enough tokens. Earn 1 token on your first trade each trading day.'; end if;
 if (select count(*) from prediction_positions where user_id=uid)>=20 then raise exception 'Max 20 open predictions.'; end if;
 qty:=trunc(p_stake/ask,6); cost:=p_stake;
 update prediction_wallets set balance=balance-cost where user_id=uid;
 insert into prediction_positions(user_id,prediction_id,prediction_outcome,quantity,entry_price,cost)
 values(uid,m.id,p_outcome,qty,ask,cost) returning * into p;
 return to_jsonb(p);
end $$;
-- Callers lock the wallet before a position. Only the server can settle and credit tokens.
create or replace function public.settle_token_prediction(p_id uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare p prediction_positions; m prediction_markets; mark numeric; proceeds numeric; t prediction_trades;
begin
 select * into p from prediction_positions where id=p_id for update;
 if not found then raise exception 'Prediction already closed.'; end if;
 select * into m from prediction_markets where id=p.prediction_id for share;
 if m.payout_yes is null then
  if m.status<>'active' or m.close_at<=now() then raise exception 'This event has closed and is awaiting its official result.'; end if;
  if m.quoted_at<now()-interval '90 seconds' or m.quoted_at>now()+interval '5 seconds' then raise exception 'No fresh exit bid. Try again shortly.'; end if;
  mark:=case when p.prediction_outcome='yes' then m.yes_bid else m.no_bid end;
  if mark<=0 then raise exception 'No executable exit bid. Wait for settlement.'; end if;
 else mark:=case when p.prediction_outcome='yes' then m.payout_yes else 1-m.payout_yes end; end if;
 proceeds:=trunc(p.quantity*mark,6);
 insert into prediction_trades(id,user_id,prediction_id,prediction_outcome,prediction_question,quantity,entry_price,exit_price,cost,payout,pnl,opened_at,reason)
 values(p.id,p.user_id,p.prediction_id,p.prediction_outcome,m.title,p.quantity,p.entry_price,mark,p.cost,proceeds,proceeds-p.cost,p.opened_at,
 case when m.payout_yes is null then 'closed' else 'prediction_settled' end) returning * into t;
 update prediction_wallets set balance=balance+proceeds where user_id=p.user_id;
 delete from prediction_positions where id=p.id;
 return to_jsonb(t);
end $$;
create or replace function public.close_prediction(p_id uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare uid uuid:=require_user();
begin
 perform 1 from prediction_wallets where user_id=uid for update;
 if not exists(select 1 from prediction_positions where id=p_id and user_id=uid) then raise exception 'Prediction not found or already closed.'; end if;
 return settle_token_prediction(p_id);
end $$;
create or replace function public.prediction_watchlist() returns jsonb language sql security definer set search_path=public as $$
 select coalesce(jsonb_agg(id),'[]'::jsonb) from (select distinct prediction_id as id from prediction_positions) x
$$;
create or replace function public.ingest_predictions(p_rows jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare r jsonb; a prediction_wallets; p prediction_positions; n int:=0; settled int:=0;
begin
 for r in select * from jsonb_array_elements(p_rows) loop
  if (r->>'quoted_at')::timestamptz<now()-interval '90 seconds' or (r->>'quoted_at')::timestamptz>now()+interval '5 seconds' then continue; end if;
  insert into prediction_markets(id,title,rules,close_at,status,yes_bid,yes_ask,no_bid,no_ask,payout_yes,quoted_at,volume)
  values(r->>'id',r->>'title',r->>'rules',(r->>'close_at')::timestamptz,r->>'status',(r->>'yes_bid')::numeric,(r->>'yes_ask')::numeric,
  (r->>'no_bid')::numeric,(r->>'no_ask')::numeric,(r->>'payout_yes')::numeric,(r->>'quoted_at')::timestamptz,coalesce((r->>'volume')::numeric,0))
  on conflict(id) do update set title=excluded.title,rules=excluded.rules,close_at=excluded.close_at,status=case when prediction_markets.payout_yes is not null then prediction_markets.status else excluded.status end,
  yes_bid=case when excluded.status='active' then excluded.yes_bid else prediction_markets.yes_bid end,
  yes_ask=case when excluded.status='active' then excluded.yes_ask else prediction_markets.yes_ask end,
  no_bid=case when excluded.status='active' then excluded.no_bid else prediction_markets.no_bid end,
  no_ask=case when excluded.status='active' then excluded.no_ask else prediction_markets.no_ask end,
  payout_yes=coalesce(prediction_markets.payout_yes,excluded.payout_yes),quoted_at=excluded.quoted_at,volume=excluded.volume
  where prediction_markets.quoted_at<=excluded.quoted_at;
  insert into prediction_ticks(id,quoted_at,yes_bid,no_bid) select id,quoted_at,
   coalesce(payout_yes,yes_bid),case when payout_yes is not null then 1-payout_yes else no_bid end
   from prediction_markets where id=r->>'id' on conflict do nothing;
  n:=n+1;
 end loop;
 for a in select * from prediction_wallets w where exists(select 1 from prediction_positions o join prediction_markets m on m.id=o.prediction_id where o.user_id=w.user_id and m.payout_yes is not null) order by user_id for update skip locked loop
  for p in select o.* from prediction_positions o join prediction_markets m on m.id=o.prediction_id where o.user_id=a.user_id and m.payout_yes is not null order by o.id loop
   perform settle_token_prediction(p.id); settled:=settled+1;
  end loop;
 end loop;
 delete from prediction_ticks where quoted_at<now()-interval '7 days';
 return jsonb_build_object('accepted',n,'settled',settled);
end $$;
revoke all on function award_prediction_token(uuid,date),reward_prediction_trading_day(),settle_token_prediction(uuid),open_prediction(text,text,numeric),close_prediction(uuid),prediction_board(),ingest_predictions(jsonb),prediction_watchlist() from public,anon,authenticated;
grant execute on function open_prediction(text,text,numeric),close_prediction(uuid),prediction_board() to authenticated;
grant execute on function ingest_predictions(jsonb),prediction_watchlist() to service_role;
notify pgrst, 'reload schema';
commit;
