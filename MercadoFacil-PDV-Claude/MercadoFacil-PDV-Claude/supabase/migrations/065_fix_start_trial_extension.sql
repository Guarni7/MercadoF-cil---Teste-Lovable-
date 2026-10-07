-- start_trial() sobrescrevia plan_expires_at incondicionalmente a cada
-- chamada — com plan_status já 'trial', repetir a chamada empurrava o
-- vencimento mais 7 dias toda vez (trial infinito via automação). Mesmo
-- guard de early-return que já existe pro caso 'active', agora também pro
-- caso 'trial' ainda não vencido: devolve o trial atual sem reescrever nada.
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

  if me.plan_status = 'trial' and me.plan_expires_at is not null and me.plan_expires_at > now_ts then
    return query select me.plan, me.plan_status, me.plan_expires_at, me.company_id;
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
