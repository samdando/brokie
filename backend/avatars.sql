-- Apply after prediction_tokens.sql. Cosmetic purchases share the token wallet.
begin;
create table if not exists avatar_items (
 id text primary key, name text not null, symbol text not null, color text not null,
 price integer not null check(price>0)
);
insert into avatar_items values
 ('bull','Bull club','🐂','#73E7C3',3),('bear','Bear club','🐻','#F2CA73',3),
 ('rocket','Moon crew','🚀','#7CC8FF',5),('diamond','Diamond hands','💎','#B5A0FE',5),
 ('fire','On fire','🔥','#FF9D76',8),('crown','Squad royalty','👑','#D6FE59',12)
on conflict(id) do nothing;
create table if not exists avatar_ownership (
 user_id uuid not null references profiles(id) on update cascade on delete cascade,
 item_id text not null references avatar_items(id), purchased_at timestamptz not null default now(),
 primary key(user_id,item_id)
);
alter table profiles add column if not exists avatar_item text references avatar_items(id);
alter table avatar_items enable row level security;
alter table avatar_ownership enable row level security;
revoke all on avatar_items,avatar_ownership from public,anon,authenticated;

create or replace function avatar_shop() returns jsonb language plpgsql security definer set search_path=public as $$
declare uid uuid:=require_user();
begin
 return jsonb_build_object('balance',coalesce((select balance from prediction_wallets where user_id=uid),0),
 'equipped',(select avatar_item from profiles where id=uid),
 'items',(select jsonb_agg(to_jsonb(i)||jsonb_build_object('owned',exists(select 1 from avatar_ownership o where o.user_id=uid and o.item_id=i.id)) order by i.price,i.id) from avatar_items i));
end $$;
create or replace function buy_avatar(p_item text) returns jsonb language plpgsql security definer set search_path=public as $$
declare uid uuid:=require_user(); cost integer; available numeric;
begin
 select price into cost from avatar_items where id=p_item;
 if not found then raise exception 'Avatar not found.'; end if;
 insert into prediction_wallets(user_id) values(uid) on conflict do nothing;
 select balance into available from prediction_wallets where user_id=uid for update;
 if not exists(select 1 from avatar_ownership where user_id=uid and item_id=p_item) then
  if available<cost then raise exception 'Not enough tokens for this avatar.'; end if;
  update prediction_wallets set balance=balance-cost where user_id=uid;
  insert into avatar_ownership(user_id,item_id) values(uid,p_item);
 end if;
 update profiles set avatar_item=p_item where id=uid;
 return avatar_shop();
end $$;
create or replace function equip_avatar(p_item text default null) returns jsonb language plpgsql security definer set search_path=public as $$
declare uid uuid:=require_user();
begin
 -- Serialize equip and buy against the same player row.
 perform 1 from profiles where id=uid for update;
 if p_item is not null and not exists(select 1 from avatar_ownership where user_id=uid and item_id=p_item) then raise exception 'Buy this avatar first.'; end if;
 update profiles set avatar_item=p_item where id=uid;
 return avatar_shop();
end $$;
create or replace function player_avatars(p_handles text[]) returns jsonb language plpgsql security definer set search_path=public as $$
declare uid uuid:=require_user();
begin
 if cardinality(p_handles)>100 then raise exception 'Too many players.'; end if;
 return coalesce((select jsonb_object_agg(p.handle,jsonb_build_object('symbol',i.symbol,'color',i.color))
 from profiles p left join avatar_items i on i.id=p.avatar_item where p.handle=any(p_handles)),'{}'::jsonb);
end $$;
revoke all on function avatar_shop(),buy_avatar(text),equip_avatar(text),player_avatars(text[]) from public,anon;
grant execute on function avatar_shop(),buy_avatar(text),equip_avatar(text),player_avatars(text[]) to authenticated;
commit;
