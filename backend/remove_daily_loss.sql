-- Apply last, after clean_floor.sql, server_brackets.sql and capped_eod_floor.sql.
-- Daily loss limits are retired for every existing and future paper account.
-- Season drawdown, fills, balances, brackets, and qualification retain their rules.
begin;
alter table public.risk_rule_audit enable row level security;
revoke all on public.risk_rule_audit from public,anon,authenticated;

-- Stop the old next-season $2,000 allowance from returning.
drop trigger if exists next_season_daily_limit on public.accounts;
alter table public.accounts alter column daily_loss_pct set default 0;
create or replace function public.normalize_no_daily_loss() returns trigger
language plpgsql set search_path=public as $$
begin
 new.daily_loss_pct:=0;
 new.daily_loss_amount:=null;
 if new.status='locked' then new.status:='active'; new.locked_at:=null; end if;
 return new;
end $$;
drop trigger if exists no_daily_loss on public.accounts;
create trigger no_daily_loss before insert or update on public.accounts
 for each row execute function public.normalize_no_daily_loss();
revoke all on function public.normalize_no_daily_loss() from public,anon,authenticated;

-- Retain a numeric compatibility field for older clients; zero is not a daily
-- stop. The enforcement block below is removed, rather than testing this floor.
create or replace function public.daily_loss_floor(a public.accounts) returns numeric
language sql immutable as $$ select 0::numeric $$;

do $$ declare src text; old_block text:=$block$  -- Daily loss -> locked until the next session.
  if a.status = 'active' and eq <= daily_loss_floor(a) then
    perform close_all(p_user, p_season, 'daily_limit');
    update accounts set status = 'locked', locked_at = now() where user_id = p_user and season = p_season;
    return 'locked';
  end if;$block$;
begin
 src:=pg_get_functiondef('public.enforce_rules(uuid,date)'::regprocedure);
 if position('Daily loss limits retired' in src)=0 then
   if position(old_block in src)=0 then raise exception 'Unknown enforce_rules version; daily rule was not changed.'; end if;
   src:=replace(src,old_block,'  -- Daily loss limits retired on 6 November 2026.');
   execute src;
 end if;
 src:=pg_get_functiondef('public.my_state()'::regprocedure);
 if position('daily_loss_enabled' in src)=0 then
   if position($part$'daily_loss_pct', acct.daily_loss_pct,$part$ in src)=0 then raise exception 'Unknown my_state version; daily rule was not changed.'; end if;
   src:=replace(src,$part$'daily_loss_pct', acct.daily_loss_pct,$part$,$part$'daily_loss_enabled', false, 'daily_loss_pct', acct.daily_loss_pct,$part$);
   execute src;
 end if;
end $$;

-- Record the exact prior account state and unlock daily-locked accounts without
-- changing anyone's paper cash, fills, restart allowance or qualification.
with changed as (
 select * from public.accounts where daily_loss_pct<>0 or daily_loss_amount is not null or status='locked'
), logged as (
 insert into public.risk_rule_audit(user_id,season,action,before_state,after_state)
 select a.user_id,a.season,'remove_daily_loss',to_jsonb(a),
        to_jsonb(a)||jsonb_build_object('daily_loss_pct',0,'daily_loss_amount',null,
        'status',case when a.status='locked' then 'active' else a.status end,
        'locked_at',case when a.status='locked' then null else a.locked_at end)
 from changed a returning user_id,season
)
update public.accounts a set daily_loss_pct=0,daily_loss_amount=null,
 status=case when a.status='locked' then 'active' else a.status end,
 locked_at=case when a.status='locked' then null else a.locked_at end
from logged l where a.user_id=l.user_id and a.season=l.season;
notify pgrst,'reload schema';
commit;
