-- Correction to 039: `revoke all on function ... from public` does not remove
-- an explicit per-role grant. This project has an ALTER DEFAULT PRIVILEGES
-- rule (Supabase's own baseline setup) that auto-grants EXECUTE on every new
-- function in schema public to anon/authenticated/service_role at creation
-- time — a grant to the specific role, not to PUBLIC, so `... FROM PUBLIC`
-- left it untouched. Verified live: has_function_privilege('authenticated',
-- 'public.get_payment_secrets(uuid)','EXECUTE') returned true after 039's
-- revoke. Same root class of bug as 036 (grant scope wider than the revoke).

revoke all on function public.get_payment_secrets(uuid) from authenticated, anon, public;
revoke all on function public.set_payment_secrets(uuid, text, text) from authenticated, anon, public;
revoke all on function public.get_fiscal_secrets(uuid) from authenticated, anon, public;
revoke all on function public.set_fiscal_secrets(uuid, text, text, text, text) from authenticated, anon, public;

grant execute on function public.get_payment_secrets(uuid) to service_role;
grant execute on function public.set_payment_secrets(uuid, text, text) to service_role;
grant execute on function public.get_fiscal_secrets(uuid) to service_role;
grant execute on function public.set_fiscal_secrets(uuid, text, text, text, text) to service_role;
