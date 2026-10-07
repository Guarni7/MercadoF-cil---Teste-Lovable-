-- Correction to 041: handle_new_user()/rls_auto_enable() still showed
-- EXECUTE for anon/authenticated after revoking from those roles specifically
-- — this time the grant was at the PUBLIC level (opposite of 036/040's bug,
-- where the grant was role-specific and a PUBLIC-level revoke didn't reach
-- it). Revoking from all three covers both directions.

revoke execute on function public.handle_new_user() from anon, authenticated, public;
revoke execute on function public.rls_auto_enable() from anon, authenticated, public;
