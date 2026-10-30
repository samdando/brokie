-- Normal EOD floor: highest closing balance minus a fixed $4,200 per $100k,
-- capped at original starting funds. $50k scales to $2,100. Hard-mode intraday
-- trailing accounts retain their existing rule. Apply after server_brackets.sql.
begin;
create or replace function public.eod_loss_allowance(a public.accounts) returns numeric
language sql immutable as $$ select round(a.start_balance*0.042,2) $$;
create or replace function public.dd_floor(a public.accounts) returns numeric
language sql stable as $$
 select round(case when a.dd_mode='trailing' then public.dd_base(a)*(1-a.max_dd_pct/100)
   else least(a.start_balance,greatest(a.start_balance,public.dd_base(a))-public.eod_loss_allowance(a)) end,2)
$$;

-- Every client receives the authoritative fixed allowance and cap with its floor.
do $$ declare src text;
begin
 src:=pg_get_functiondef('public.my_state()'::regprocedure);
 if position($patch$'max_loss_amount'$patch$ in src)=0 then
   src:=replace(src,$patch$'max_dd_pct', acct.max_dd_pct,$patch$,$patch$'max_dd_pct', acct.max_dd_pct,
     'max_loss_amount', case when acct.dd_mode='eod' then eod_loss_allowance(acct) else null end,
     'drawdown_cap', case when acct.dd_mode='eod' then acct.start_balance else null end,$patch$);
 end if;
 if position('eod_loss_allowance(acct)' in src)=0 then raise exception 'Unknown my_state version'; end if;
 execute src;
end $$;

-- A narrow admin-only correction for an account failed solely by the old
-- uncapped EOD floor. It preserves cash, receipts, qualifying days and restarts.
create table if not exists public.risk_rule_audit (
 id bigint generated always as identity primary key,
 user_id uuid not null,season date not null,at timestamptz not null default now(),
 action text not null,before_state jsonb not null,after_state jsonb not null
);
alter table public.risk_rule_audit enable row level security;
revoke all on public.risk_rule_audit from public,anon,authenticated;
create or replace function public.restore_capped_eod_account(p_handle text,p_expected_cash numeric,p_expected_blown_at timestamptz)
returns jsonb language plpgsql set search_path=public as $$
declare uid uuid; a accounts; restored accounts; old_floor numeric;
begin
 select id into strict uid from profiles where handle=p_handle;
 select * into strict a from accounts where user_id=uid and season=current_season() for update;
 if a.status<>'blown' then return jsonb_build_object('changed',false,'status',a.status,'cash',a.cash); end if;
 old_floor:=round(dd_base(a)*(1-a.max_dd_pct/100),2);
 if a.dd_mode<>'eod' or a.cash is distinct from p_expected_cash or a.blown_at is distinct from p_expected_blown_at
   or a.resets_used<>0 or old_floor<=a.start_balance or a.cash>old_floor
   or a.cash<=dd_floor(a) or a.cash<=daily_loss_floor(a)
   or exists(select 1 from positions where user_id=uid and season=a.season) then
   raise exception 'Account changed or another loss rule applies. Review before restoring.';
 end if;
 update accounts set status='active',blown_at=null where user_id=uid and season=a.season returning * into restored;
 insert into risk_rule_audit(user_id,season,action,before_state,after_state)
 values(uid,a.season,'cap_eod_floor_restore',to_jsonb(a),to_jsonb(restored));
 return jsonb_build_object('changed',true,'status',restored.status,'cash',restored.cash,'floor',dd_floor(restored),'resets_used',restored.resets_used);
end $$;
revoke all on function public.restore_capped_eod_account(text,numeric,timestamptz) from public,anon,authenticated;
notify pgrst,'reload schema';
commit;
