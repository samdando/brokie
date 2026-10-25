-- Paper prediction contracts using public Kalshi data. No wallets or real-money orders.
begin;
insert into markets(id,point_value,tick_size,instrument) values('prediction',1,0.0001,'KALSHI') on conflict(id) do nothing;
create table if not exists prediction_markets (
 id text primary key,title text not null,rules text not null,close_at timestamptz not null,status text not null,
 yes_bid numeric not null check(yes_bid between 0 and 1),yes_ask numeric not null check(yes_ask between 0 and 1),
 no_bid numeric not null check(no_bid between 0 and 1),no_ask numeric not null check(no_ask between 0 and 1),
 payout_yes numeric check(payout_yes between 0 and 1),quoted_at timestamptz not null,volume numeric not null default 0
);
create table if not exists prediction_ticks (id text not null references prediction_markets(id), quoted_at timestamptz not null, yes_bid numeric not null, no_bid numeric not null, primary key(id,quoted_at));
alter table prediction_ticks enable row level security;
revoke all on prediction_ticks from anon,authenticated;
alter table prediction_markets enable row level security;
revoke all on prediction_markets from anon,authenticated;
alter table positions add column if not exists prediction_id text references prediction_markets(id);
alter table positions add column if not exists prediction_outcome text check(prediction_outcome in ('yes','no'));
alter table trades add column if not exists prediction_id text references prediction_markets(id);
alter table trades add column if not exists prediction_outcome text;
alter table trades add column if not exists prediction_question text;
alter table positions drop constraint if exists positions_quantity_check;
alter table positions add constraint positions_quantity_check check(quantity between 1 and case when market='prediction' then 10000 else 10 end);
alter table positions drop constraint if exists positions_prediction_check;
alter table positions add constraint positions_prediction_check check
 ((market='prediction' and prediction_id is not null and prediction_outcome is not null and side='long')
 or (market<>'prediction' and prediction_id is null and prediction_outcome is null));
alter table trades drop constraint if exists trades_reason_check;
alter table trades add constraint trades_reason_check check(reason in ('closed','liquidated','season_end','daily_limit','blown','reset','sl_fix','rules_fix','market_close','prediction_settled'));

create or replace function public.position_mark(p positions) returns numeric language sql stable security definer set search_path=public as $$
 select case when p.market='prediction' then
  (select case when m.payout_yes is not null then case when p.prediction_outcome='yes' then m.payout_yes else 1-m.payout_yes end
   else case when p.prediction_outcome='yes' then m.yes_bid else m.no_bid end end from prediction_markets m where m.id=p.prediction_id)
 else (select price from quotes where market=p.market) end
$$;
create or replace function public.unrealized(p_user uuid,p_season date) returns numeric language sql stable security definer set search_path=public as $$
 select coalesce(sum((coalesce(position_mark(p),p.entry_price)-p.entry_price)*m.point_value*p.quantity*direction(p.side)),0)
 from positions p join markets m on m.id=p.market where p.user_id=p_user and p.season=p_season
$$;
create or replace function public.position_margin(p positions) returns numeric language sql immutable as $$
 select case when p.market='prediction' then p.entry_price*p.quantity else p.quantity*1000 end
$$;
create or replace function public.set_position_session() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if new.market='prediction' then new.session_closes_at:=season_ends_at(new.season);
 else
  if not market_session_open(new.market,now()) then raise exception 'This market session is closed.'; end if;
  new.session_closes_at:=position_session_end(new.market,new.opened_at);
 end if;
 if exists(select 1 from positions where user_id=new.user_id and session_closes_at<=now()) then raise exception 'A previous session is awaiting settlement.'; end if;
 return new;
end $$;
create or replace function public.settle_position(p_position positions,p_reason text) returns trades
language plpgsql security definer set search_path=public as $$
declare mark numeric; value numeric; result trades;
begin
 mark:=position_mark(p_position);
 if mark is null then raise exception 'No recorded price available.'; end if;
 select (mark-p_position.entry_price)*m.point_value*p_position.quantity*direction(p_position.side) into value from markets m where m.id=p_position.market;
 update accounts set cash=cash+value where user_id=p_position.user_id and season=p_position.season;
 insert into trades(id,user_id,season,market,side,quantity,entry_price,exit_price,pnl,opened_at,reason,prediction_id,prediction_outcome,prediction_question,exit_quoted_at)
 values(p_position.id,p_position.user_id,p_position.season,p_position.market,p_position.side,p_position.quantity,p_position.entry_price,mark,value,p_position.opened_at,p_reason,
 p_position.prediction_id,p_position.prediction_outcome,(select title from prediction_markets where id=p_position.prediction_id),
 case when p_position.market='prediction' then (select quoted_at from prediction_markets where id=p_position.prediction_id) else (select quoted_at from quotes where market=p_position.market) end)
 returning * into result;
 delete from positions where id=p_position.id;
 return result;
end $$;
create or replace function public.prediction_board() returns jsonb language plpgsql security definer set search_path=public as $$
declare uid uuid:=require_user();
begin
 return jsonb_build_object('markets',coalesce((select jsonb_agg(to_jsonb(m) order by volume desc) from (
  select * from prediction_markets where (status='active' and close_at>now() and quoted_at>now()-interval '3 minutes')
   or id in(select prediction_id from positions where user_id=uid) order by volume desc limit 60) m),'[]'::jsonb));
end $$;
create or replace function public.open_prediction(p_market text,p_outcome text,p_stake numeric default 100) returns jsonb
language plpgsql security definer set search_path=public as $$
declare uid uuid:=require_user(); a accounts; m prediction_markets; ask numeric; qty int; used numeric; p positions;
begin
 if p_outcome is null or p_outcome not in ('yes','no') or p_stake is null or p_stake<1 or p_stake>1000 then raise exception 'Choose Yes or No and a paper stake between $1 and $1,000.'; end if;
 a:=ensure_account(uid);
 select * into a from accounts where user_id=uid and season=a.season for update;
 if a.status<>'active' then raise exception 'This account is locked or blown.'; end if;
 select * into m from prediction_markets where id=p_market;
 if not found or m.status<>'active' or m.close_at<=now() or m.quoted_at<now()-interval '90 seconds' or m.quoted_at>now()+interval '5 seconds' or m.payout_yes is not null then raise exception 'This prediction is closed or its prices are stale.'; end if;
 ask:=case when p_outcome='yes' then m.yes_ask else m.no_ask end;
 if ask<=0 or ask>=1 then raise exception 'No executable price for this outcome.'; end if;
 qty:=least(10000,floor(p_stake/ask)::int);
 if qty<1 then raise exception 'Choose a larger paper stake.'; end if;
 select coalesce(sum(position_margin(o)),0) into used from positions o where user_id=uid and season=a.season;
 if a.cash+unrealized(uid,a.season)-used<qty*ask then raise exception 'Not enough buying power.'; end if;
 if (select count(*) from positions where user_id=uid and season=a.season)>=10 then raise exception 'Max 10 open positions.'; end if;
 if (select count(*) from positions where user_id=uid and opened_at>now()-interval '10 seconds')>=5 then raise exception 'Slow down — max 5 new trades per 10 seconds.'; end if;
 insert into positions(user_id,season,market,side,quantity,entry_price,prediction_id,prediction_outcome)
 values(uid,a.season,'prediction','long',qty,ask,m.id,p_outcome) returning * into p;
 perform enforce_rules(uid,a.season);
 return to_jsonb(p);
end $$;
create or replace function public.close_prediction(p_id uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare uid uuid:=require_user(); p positions; m prediction_markets; t trades;
begin
 perform 1 from accounts where user_id=uid order by season for update;
 select * into p from positions where id=p_id and user_id=uid and market='prediction' for update;
 if not found then raise exception 'Prediction already closed.'; end if;
 select * into m from prediction_markets where id=p.prediction_id;
 if m.payout_yes is null and (m.status<>'active' or m.close_at<=now()) then raise exception 'This event has closed and is awaiting its official result.'; end if;
 if m.payout_yes is null and (m.quoted_at<now()-interval '90 seconds' or position_mark(p)<=0) then raise exception 'No fresh exit bid. Try again shortly.'; end if;
 t:=settle_position(p,case when m.payout_yes is not null then 'prediction_settled' else 'closed' end);
 perform enforce_rules(uid,p.season); return to_jsonb(t);
end $$;
-- Service-only ingestion validates all prices and settles only official final payouts.
create or replace function public.ingest_predictions(p_rows jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare r jsonb; a accounts; p positions; n int:=0; settled int:=0;
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
 for a in select * from accounts x where exists(select 1 from positions o where o.user_id=x.user_id and o.season=x.season and o.market='prediction') order by user_id,season for update skip locked loop
  for p in select o.* from positions o join prediction_markets m on m.id=o.prediction_id where o.user_id=a.user_id and o.season=a.season and m.payout_yes is not null for update of o loop
   perform settle_position(p,'prediction_settled'); settled:=settled+1;
  end loop;
  perform enforce_rules(a.user_id,a.season);
 end loop;
 delete from prediction_ticks where quoted_at<now()-interval '7 days';
 return jsonb_build_object('accepted',n,'settled',settled);
end $$;
create or replace function public.prediction_watchlist() returns jsonb language sql security definer set search_path=public as $$
 select coalesce(jsonb_agg(id),'[]'::jsonb) from (select distinct prediction_id as id from positions where prediction_id is not null) x
$$;
revoke all on function position_mark(positions),position_margin(positions),open_prediction(text,text,numeric),close_prediction(uuid),prediction_board(),ingest_predictions(jsonb),prediction_watchlist() from public,anon,authenticated;
grant execute on function open_prediction(text,text,numeric),close_prediction(uuid),prediction_board() to authenticated;
grant execute on function ingest_predictions(jsonb),prediction_watchlist() to service_role;
create or replace function public.my_state() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := require_user();
  acct accounts := ensure_account(uid);
  eq numeric := acct.cash + unrealized(uid, acct.season);
begin
  return jsonb_build_object(
    'handle',  (select handle from profiles where id = uid),
    'season',  acct.season,
    'season_number', season_number(acct.season),
    'season_ends_at', season_ends_at(acct.season),
    'server_time', now(),
    'cash', acct.cash,
    'protection_credit', acct.protection_credit,
    'liquidations', acct.liquidations,
    'has_backup_code', exists (select 1 from account_recovery where user_id = uid),
    'rules', jsonb_build_object(
      'status', acct.status,
      'start_balance', acct.start_balance,
      'peak_equity', acct.peak_equity,
      'day_start_equity', acct.day_start_equity,
      'daily_loss_pct', acct.daily_loss_pct,
      'max_dd_pct', acct.max_dd_pct,
      'dd_mode', acct.dd_mode,
      'dd_base', round(dd_base(acct), 2),
      'daily_floor', round(acct.day_start_equity * (1 - acct.daily_loss_pct / 100), 2),
      'drawdown_floor', dd_floor(acct),
      'target', round(acct.start_balance * 1.10, 2),
      'funded', acct.funded_at is not null,
      'target_hit', acct.target_hit_at is not null,
      'resets_used', acct.resets_used,
      'trading_days', trading_days(uid, acct.season),
      'qualify_days', 5,
      'equity', round(eq, 2)),
    'positions', coalesce((select jsonb_agg((to_jsonb(p) || jsonb_build_object('mark_price',position_mark(p),'prediction_question',(select title from prediction_markets where id=p.prediction_id))) order by p.opened_at)
                             from positions p where p.user_id = uid and p.season = acct.season), '[]'::jsonb),
    'trades', coalesce((select jsonb_agg(to_jsonb(t) order by t.closed_at desc)
                          from (select * from trades where user_id = uid and season = acct.season
                                order by closed_at desc limit 50) t), '[]'::jsonb),
    'quotes', coalesce((select jsonb_agg(to_jsonb(q)) from quotes q), '[]'::jsonb)
  );
end $$;
create or replace function public.open_position(p_market public.market, p_side public.trade_side, p_quantity int)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := require_user();
  acct accounts;
  q quotes;
  equity numeric;
  used numeric;
  pos positions;
  recent int;
begin
  if p_quantity not between 1 and 10 then
    raise exception 'Choose 1 to 10 contracts.' using errcode = 'P0001';
  end if;
  acct := ensure_account(uid);
  select * into acct from accounts where user_id = uid and season = acct.season for update;
  if acct.status = 'blown' then
    raise exception 'Account blown for this season. 💀 Use your buy-back or wait for next season.' using errcode = 'P0001';
  end if;
  if acct.status = 'locked' then
    raise exception 'Daily loss limit hit. Trading unlocks when the next session opens (5pm New York, % Brisbane).',
      to_char(trading_day_ends_at() at time zone 'Australia/Brisbane', 'FMHH12am') using errcode = 'P0001';
  end if;
  select count(*) into recent from positions where user_id = uid and opened_at > now() - interval '10 seconds';
  if recent >= 5 then raise exception 'Slow down — max 5 new trades per 10 seconds.' using errcode = 'P0001'; end if;
  select * into q from quotes where market = p_market;
  if not found or q.quoted_at < now() - quote_max_age() then
    raise exception 'Market is closed or the price feed is stale. Try again when it''s live.' using errcode = 'P0001';
  end if;
  if (select count(*) from positions where user_id = uid and season = acct.season) >= 10 then
    raise exception 'Max 10 open positions. Close one first.' using errcode = 'P0001';
  end if;
  equity := acct.cash + unrealized(uid, acct.season);
  select coalesce(sum(position_margin(positions)), 0) into used from positions where user_id = uid and season = acct.season;
  if equity - used + 0.000001 < p_quantity * 1000 then
    raise exception 'Not enough buying power. Close a position or choose fewer contracts.' using errcode = 'P0001';
  end if;
  insert into positions (user_id, season, market, side, quantity, entry_price)
  values (uid, acct.season, p_market, p_side, p_quantity, q.price)
  returning * into pos;
  return to_jsonb(pos);
end $$;
create or replace function public.close_position(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := require_user();
  pos positions;
  result trades;
begin
  perform 1 from accounts where user_id=uid order by season for update;
  select * into pos from positions where id = p_id and user_id = uid for update;
  if not found then raise exception 'That position is already closed.' using errcode = 'P0001'; end if;
  if pos.market='prediction' then return close_prediction(p_id); end if;
  result := settle_position(pos, 'closed');
  perform enforce_rules(uid, pos.season);
  return to_jsonb(result);
end $$;
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
  if p_market='prediction' then raise exception 'Use the prediction exit button.'; end if;
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
create or replace function public.guard_session_exit() returns trigger
language plpgsql security definer set search_path=public as $$
begin
 if new.reason not in ('market_close','prediction_settled') and exists(select 1 from positions p where p.user_id=new.user_id
   and p.market=new.market and p.side=new.side and p.opened_at=new.opened_at and p.session_closes_at<=now()) then
   raise exception 'Session ended. This position is awaiting its market-close receipt.';
 end if;
 return new;
end $$;
create or replace function public.settle_market_closes(p_now timestamptz default now()) returns jsonb
language plpgsql security definer set search_path=public as $$
declare a accounts; p positions; mark numeric; quote_time timestamptz; value numeric; n int:=0; pending int:=0;
begin
 for a in select * from accounts x where exists(select 1 from positions o where o.user_id=x.user_id
   and o.season=x.season and o.session_closes_at<=p_now) order by user_id,season for update skip locked loop
   for p in select * from positions where user_id=a.user_id and season=a.season and session_closes_at<=p_now
     order by session_closes_at,id for update loop
     mark:=null; quote_time:=null;
     if p.market='prediction' then
       select case when p.prediction_outcome='yes' then t.yes_bid else t.no_bid end,t.quoted_at into mark,quote_time
       from prediction_ticks t where t.id=p.prediction_id and t.quoted_at between p.session_closes_at-interval '5 minutes' and p.session_closes_at
       order by t.quoted_at desc limit 1;
     else
     select x.price,x.at into mark,quote_time from (
       select q.price,q.quoted_at as at from quotes q where q.market=p.market
       union all select t.price,t.quoted_at from quote_ticks t where t.market=p.market
         and t.quoted_at>=p.session_closes_at-interval '5 minutes' and t.quoted_at<=p.session_closes_at
       union all select b.close,b.last_at from bars b where b.market=p.market and b.secs=60
         and b.idx between floor(extract(epoch from p.session_closes_at-interval '5 minutes')/60)::bigint
                       and floor(extract(epoch from p.session_closes_at)/60)::bigint
     ) x where x.at<=p.session_closes_at and x.at>=p.session_closes_at-interval '5 minutes'
       and x.at>=p.opened_at order by x.at desc limit 1;
     end if;
     if mark is null then pending:=pending+1; continue; end if;
     select (mark-p.entry_price)*m.point_value*p.quantity*direction(p.side) into value from markets m where m.id=p.market;
     insert into trades(id,user_id,season,market,side,quantity,entry_price,exit_price,pnl,opened_at,closed_at,reason,exit_quoted_at,prediction_id,prediction_outcome,prediction_question)
       values(p.id,p.user_id,p.season,p.market,p.side,p.quantity,p.entry_price,mark,value,p.opened_at,p.session_closes_at,'market_close',quote_time,p.prediction_id,p.prediction_outcome,(select title from prediction_markets where id=p.prediction_id));
     update accounts set cash=cash+value where user_id=p.user_id and season=p.season;
     delete from positions where id=p.id;
     n:=n+1;
   end loop;
   if not exists(select 1 from positions where user_id=a.user_id and season=a.season and session_closes_at<=p_now) then
     perform enforce_rules(a.user_id,a.season);
   end if;
 end loop;
 return jsonb_build_object('settled',n,'pending',pending);
end $$;
-- Preserve per-event identity and marks in squad profiles.
create or replace function public.chart_bubbles(p_market public.market, p_squad uuid default null) returns jsonb
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
             a.peak_equity * (1 - a.max_dd_pct / 100) as dd_floor,
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
        where t.market = p_market and t.season = current_season() and t.closed_at > now() - interval '24 hours'
          and (t.user_id = uid or (p_squad is not null and exists (select 1 from squad_members m where m.squad_id = p_squad and m.user_id = t.user_id)))
        order by t.closed_at desc limit 60
      ) recent
    ) b), '[]'::jsonb);
end $$;


commit;
