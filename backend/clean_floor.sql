-- Apply AFTER prediction_tokens.sql, avatars.sql, rules_v4.sql and weekend.sql.
-- One transaction. Re-runnable: grants are journalled; current-season rules stay intact.
begin;
create table if not exists public.starter_token_grants (
 user_id uuid primary key references profiles(id) on update cascade on delete cascade,
 granted_at timestamptz not null default now()
);
alter table starter_token_grants enable row level security;
revoke all on starter_token_grants from public,anon,authenticated;
create or replace function grant_starter_tokens() returns trigger language plpgsql security definer set search_path=public as $$
begin
 insert into starter_token_grants(user_id) values(new.id) on conflict do nothing;
 if found then
  insert into prediction_wallets(user_id,balance) values(new.id,5)
  on conflict(user_id) do update set balance=prediction_wallets.balance+5;
 end if;
 return new;
end $$;
drop trigger if exists profile_starter_tokens on profiles;
create trigger profile_starter_tokens after insert on profiles for each row execute function grant_starter_tokens();
-- Grant exactly once, adding to earned balances rather than overwriting them.
with recipients as (
 insert into starter_token_grants(user_id) select id from profiles on conflict do nothing returning user_id
) insert into prediction_wallets(user_id,balance) select user_id,5 from recipients
on conflict(user_id) do update set balance=prediction_wallets.balance+5;

alter table avatar_items drop constraint if exists avatar_items_price_check;
alter table avatar_items add constraint avatar_items_price_check check(price>=0);
insert into avatar_items(id,name,symbol,color,price) values
 ('ghost','Ghost mode','👻','#F2F5FF',0),('koala','Local legend','🐨','#73E7C3',0),
 ('tiger','Tiger club','🐯','#F2CA73',0),('alien','Outside the chart','👽','#B5A0FE',0)
on conflict(id) do nothing;
alter table profiles add column if not exists profile_color text;
alter table profiles drop constraint if exists profiles_color_check;
alter table profiles add constraint profiles_color_check check(profile_color is null or profile_color in ('#D6FE59','#73E7C3','#7CC8FF','#B5A0FE','#FF7D8B','#F2CA73','#FF9D76','#F2F5FF'));
create or replace function avatar_shop() returns jsonb language plpgsql security definer set search_path=public as $$
declare uid uuid:=require_user();
begin
 return jsonb_build_object('balance',coalesce((select balance from prediction_wallets where user_id=uid),0),
 'equipped',(select avatar_item from profiles where id=uid),'color',(select profile_color from profiles where id=uid),
 'items',(select jsonb_agg(to_jsonb(i)||jsonb_build_object('owned',i.price=0 or exists(select 1 from avatar_ownership o where o.user_id=uid and o.item_id=i.id)) order by i.price,i.id) from avatar_items i));
end $$;
create or replace function equip_avatar(p_item text default null) returns jsonb language plpgsql security definer set search_path=public as $$
declare uid uuid:=require_user();
begin
 perform 1 from profiles where id=uid for update;
 if p_item is not null and not exists(select 1 from avatar_items where id=p_item and price=0)
 and not exists(select 1 from avatar_ownership where user_id=uid and item_id=p_item) then raise exception 'Buy this avatar first.'; end if;
 update profiles set avatar_item=p_item where id=uid;
 return avatar_shop();
end $$;
create or replace function set_profile_color(p_color text) returns jsonb language plpgsql security definer set search_path=public as $$
declare uid uuid:=require_user();
begin
 if p_color is null or p_color not in ('#D6FE59','#73E7C3','#7CC8FF','#B5A0FE','#FF7D8B','#F2CA73','#FF9D76','#F2F5FF') then raise exception 'Choose a profile colour from the palette.'; end if;
 update profiles set profile_color=p_color where id=uid;
 return avatar_shop();
end $$;
create or replace function player_avatars(p_handles text[]) returns jsonb language plpgsql security definer set search_path=public as $$
declare uid uuid:=require_user();
begin
 if cardinality(p_handles)>100 then raise exception 'Too many players.'; end if;
 return coalesce((select jsonb_object_agg(p.handle,jsonb_build_object('symbol',i.symbol,'color',coalesce(p.profile_color,i.color)))
 from profiles p left join avatar_items i on i.id=p.avatar_item where p.handle=any(p_handles)),'{}'::jsonb);
end $$;
revoke all on function grant_starter_tokens(),set_profile_color(text) from public,anon;
grant execute on function set_profile_color(text) to authenticated;

-- Raise only per-order size. Buying power, freshness, market hours, position count,
-- authentication and rate limits remain in the existing server function.
alter table positions drop constraint if exists positions_quantity_check;
alter table positions add constraint positions_quantity_check check(quantity between 1 and 100);
do $$ declare src text;
begin
 src:=pg_get_functiondef('public.open_position(public.market,public.trade_side,integer)'::regprocedure);
 if position('p_quantity not between 1 and 10 then' in src)>0 then
  src:=replace(src,'p_quantity not between 1 and 10 then','p_quantity is null or p_quantity not between 1 and 100 then');
  src:=replace(src,'Choose 1 to 10 contracts.','Choose 1 to 100 contracts.');
  execute src;
 elsif position('p_quantity not between 1 and 100 then' in src)=0 then
  raise exception 'Unknown open_position version. Check the order-size guard before applying.';
 end if;
end $$;

-- Persist the rollout season once. Re-running in another season cannot shift the rule.
create table if not exists public.floor_rollout (
 id boolean primary key default true check(id), after_season date not null
);
insert into floor_rollout(id,after_season) values(true,current_season()) on conflict do nothing;
alter table floor_rollout enable row level security;
revoke all on floor_rollout from public,anon,authenticated;
alter table accounts add column if not exists daily_loss_amount numeric check(daily_loss_amount>0);
create or replace function apply_next_season_daily_limit() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if new.season>(select after_season from floor_rollout where id) then new.daily_loss_amount:=2000; end if;
 return new;
end $$;
drop trigger if exists next_season_daily_limit on accounts;
create trigger next_season_daily_limit before insert on accounts for each row execute function apply_next_season_daily_limit();
-- Include future accounts if they were precreated, leave this season alone.
update accounts set daily_loss_amount=2000 where season>(select after_season from floor_rollout where id);
create or replace function daily_loss_floor(a accounts) returns numeric language sql stable as $$
 select round(case when a.daily_loss_amount is not null then a.day_start_equity-a.daily_loss_amount else a.day_start_equity*(1-a.daily_loss_pct/100) end,2)
$$;
do $$ declare src text;
begin
 src:=pg_get_functiondef('public.enforce_rules(uuid,date)'::regprocedure);
 src:=replace(src,'eq <= a.day_start_equity * (1 - a.daily_loss_pct / 100)','eq <= daily_loss_floor(a)');
 if position('eq <= daily_loss_floor(a)' in src)=0 then raise exception 'Unknown enforce_rules version.'; end if;
 execute src;
 src:=pg_get_functiondef('public.my_state()'::regprocedure);
 src:=replace(src,'''daily_floor'', round(acct.day_start_equity * (1 - acct.daily_loss_pct / 100), 2)', '''daily_floor'', daily_loss_floor(acct)');
 if position('''daily_loss_amount''' in src)=0 then
  src:=replace(src,'''daily_loss_pct'', acct.daily_loss_pct,','''daily_loss_pct'', acct.daily_loss_pct, ''daily_loss_amount'', acct.daily_loss_amount,');
 end if;
 if position('daily_loss_floor(acct)' in src)=0 then raise exception 'Unknown my_state version.'; end if;
 execute src;
end $$;
revoke all on function apply_next_season_daily_limit() from public,anon,authenticated;
commit;
