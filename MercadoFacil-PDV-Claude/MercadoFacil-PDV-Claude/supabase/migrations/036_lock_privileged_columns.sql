-- Priority 1 fix (Security Gate): privilege escalation via direct client UPDATE
-- on profiles/companies. profiles_update_self / companies_update_own only scope
-- by ROW (id = auth.uid() / current_company_id()), with no column restriction —
-- any authenticated user could set platform_admin/role/company_role/company_id
-- on profiles, or status/plan/plan_status on companies, straight from the
-- browser, bypassing every Edge Function that re-checks those same DB values.
--
-- Fix: column-level REVOKE stops the `authenticated` PostgREST role from writing
-- these specific columns, while leaving the rest of the row (and existing RLS
-- row-scoping) untouched — the user can still edit their own allowed fields.
-- SECURITY DEFINER functions (bootstrap_company, start_trial below) are owned
-- by `postgres`, so this REVOKE does not affect them: legitimate, server-
-- validated flows keep working through those functions.

revoke update (role, company_id, company_role, platform_admin, plan, plan_status, plan_expires_at, trial_started_at)
  on public.profiles from authenticated, anon;

revoke update (status, plan, plan_status, plan_expires_at, trial_started_at)
  on public.companies from authenticated, anon;

-- start_trial(): replaces the direct client-side update() (previously in
-- src/api/supabaseData.js's startTrial()) that wrote plan/plan_status/
-- plan_expires_at/status directly from the browser. Same pattern as
-- bootstrap_company: auth.uid()-scoped, SECURITY DEFINER, only ever writes
-- server-computed values — never a client-supplied status/plan_status. Also
-- closes a second gap the old code had: it unconditionally forced
-- companies.status = 'active', which would have silently un-suspended a
-- company an admin had suspended for non-payment/fraud.
create or replace function public.start_trial(p_plan text default 'mei')
returns table (plan text, plan_status text, plan_expires_at timestamptz, company_id uuid)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  uid uuid := auth.uid();
  me public.profiles;
  co public.companies;
  now_ts timestamptz := now();
  expires timestamptz;
  allowed_plan text;
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;

  select * into me from public.profiles where id = uid;
  if me.company_id is null then
    raise exception 'company not linked';
  end if;

  select * into co from public.companies where id = me.company_id;

  if co.status = 'suspended' then
    raise exception 'company suspended — contact support';
  end if;

  if coalesce(me.plan_status, 'none') = 'active' then
    return query select me.plan, 'active'::text, me.plan_expires_at, me.company_id;
    return;
  end if;

  allowed_plan := case when p_plan in ('mei', 'simples') then p_plan else 'mei' end;
  expires := now_ts + interval '7 days';

  update public.companies
  set plan = allowed_plan,
      plan_status = 'trial',
      trial_started_at = coalesce(co.trial_started_at, now_ts),
      plan_expires_at = expires,
      status = case when co.status = 'pending' then 'active' else co.status end
  where id = me.company_id;

  update public.profiles
  set plan = allowed_plan,
      plan_status = 'trial',
      trial_started_at = coalesce(me.trial_started_at, now_ts),
      plan_expires_at = expires
  where id = uid;

  return query select allowed_plan, 'trial'::text, expires, me.company_id;
end;
$$;

revoke all on function public.start_trial(text) from public;
grant execute on function public.start_trial(text) to authenticated;
