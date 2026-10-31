-- Brokie · Supabase advisor fixes (1 Nov 2026). Rerunnable.
-- bars_from_tick() is a trigger function; nobody should call it over /rest/v1/rpc.
-- Triggers keep firing: EXECUTE is only checked when a trigger is created.
revoke execute on function public.bars_from_tick() from public, anon, authenticated;
