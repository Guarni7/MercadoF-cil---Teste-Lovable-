-- Priority 12 fix (Security Gate): 4 SECURITY DEFINER functions were callable
-- by anon and/or authenticated via /rest/v1/rpc/<fn> (Supabase security
-- advisor WARN). Reviewed each:
--
-- bootstrap_company(text, text): legitimately called by the frontend on first
-- login (ensureProfileAndCompany -> supabase.rpc('bootstrap_company', ...)),
-- self-guards on auth.uid() is null. Keep EXECUTE for `authenticated`
-- (required for signup to work) — revoke from `anon` (an anonymous call would
-- hit the auth.uid() is null guard anyway, but there's no reason to expose it
-- to unauthenticated callers at all).
--
-- current_company_id(): used INSIDE RLS policies (002_tenant_rls.sql), must
-- stay executable by `authenticated` or every tenant-scoped policy breaks.
-- Revoke from `anon` — unauthenticated requests never reach a policy that
-- calls it (nothing is visible to anon on the tenant tables), so there is no
-- legitimate anon call path.
--
-- handle_new_user(): trigger function ONLY (fires on auth.users insert via
-- the on_auth_user_created trigger) — never meant to be called directly by
-- any client role. Revoke EXECUTE entirely from anon and authenticated;
-- trigger firing is unaffected (triggers invoke the function as the trigger
-- owner, independent of EXECUTE grants to other roles).
--
-- rls_auto_enable(): event trigger function (fires on CREATE TABLE DDL) —
-- same reasoning as handle_new_user, never meant to be called directly.
-- Revoke EXECUTE entirely from anon and authenticated.

revoke execute on function public.bootstrap_company(text, text) from anon;
revoke execute on function public.current_company_id() from anon;
revoke execute on function public.handle_new_user() from anon, authenticated;
revoke execute on function public.rls_auto_enable() from anon, authenticated;
