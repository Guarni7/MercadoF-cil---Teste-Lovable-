-- 036 granted start_trial to `authenticated` but never explicitly revoked the
-- automatic anon grant (same ALTER DEFAULT PRIVILEGES behavior documented in
-- 040/042) — caught by re-running the security advisor after the P12 pass.
-- start_trial requires auth.uid() internally (raises if null), so an
-- unauthenticated call would fail anyway, but there's no reason to expose it
-- to anon at all — same reasoning already applied to bootstrap_company.

revoke execute on function public.start_trial(text) from anon;
