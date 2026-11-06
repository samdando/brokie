-- Owner/SQL-console only. No client can reset another player's account.
-- Keeps identity, squads, cosmetics and every receipt. A request key prevents
-- re-running the same reset after the player has started trading again.
begin;
create or replace function public.admin_reset_paper_account(p_handle text,p_expected_cash numeric,p_expected_status text,p_request text)
returns jsonb language plpgsql set search_path=public as $$
declare uid uuid; a accounts; restored accounts; n int; action_key text:='admin_reset:'||p_request;
begin
 if p_request is null or length(p_request)<8 then raise exception 'Supply a unique reset request key.'; end if;
 select id into strict uid from profiles where handle=p_handle;
 select * into strict a from accounts where user_id=uid and season=current_season() for update;
 if exists(select 1 from risk_rule_audit where user_id=uid and season=a.season and action=action_key) then
   return jsonb_build_object('changed',false,'handle',p_handle,'cash',a.cash,'status',a.status);
 end if;
 if a.cash is distinct from p_expected_cash or a.status is distinct from p_expected_status then raise exception 'Account changed. Review before resetting.'; end if;
 n:=close_all(uid,a.season,'reset');
 update accounts set cash=starting_balance(),start_balance=starting_balance(),peak_equity=starting_balance(),
   eod_peak=starting_balance(),day_start_equity=starting_balance(),trading_day=trading_today(),
   status='active',daily_loss_pct=0,daily_loss_amount=null,max_dd_pct=8,dd_mode='eod',
   resets_used=0,funded_at=null,target_hit_at=null,blown_at=null,locked_at=null,
   protection_credit=0,liquidations=0,worst_drawdown=0,qualify_from=now()
 where user_id=uid and season=a.season returning * into restored;
 insert into risk_rule_audit(user_id,season,action,before_state,after_state)
 values(uid,a.season,action_key,to_jsonb(a),to_jsonb(restored));
 return jsonb_build_object('changed',true,'handle',p_handle,'cash',restored.cash,'status',restored.status,'closed_positions',n,'daily_loss_enabled',false);
end $$;
revoke all on function public.admin_reset_paper_account(text,numeric,text,text) from public,anon,authenticated;
commit;
