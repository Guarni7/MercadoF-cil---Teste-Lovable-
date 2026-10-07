-- 004: bootstrap de empresa (insert company + link profile) sem abrir INSERT livre
-- Corrige: new row violates row-level security policy for table "companies"
-- Cole no SQL Editor e Run.

create or replace function public.bootstrap_company(p_trade_name text, p_email text default null)
returns public.companies
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  existing uuid;
  c public.companies;
  trial_start timestamptz := now();
  trial_end timestamptz := now() + interval '7 days';
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;

  select company_id into existing from public.profiles where id = uid;
  if existing is not null then
    select * into c from public.companies where id = existing;
    return c;
  end if;

  insert into public.companies (
    trade_name,
    email,
    status,
    plan_status,
    trial_started_at,
    plan_expires_at
  ) values (
    coalesce(nullif(trim(p_trade_name), ''), 'Minha empresa'),
    p_email,
    'active',
    'trial',
    trial_start,
    trial_end
  )
  returning * into c;

  update public.profiles
  set
    company_id = c.id,
    company_role = 'owner',
    plan_status = 'trial',
    trial_started_at = trial_start,
    plan_expires_at = trial_end,
    updated_at = now()
  where id = uid
    and company_id is null;

  return c;
end;
$$;

revoke all on function public.bootstrap_company(text, text) from public;
grant execute on function public.bootstrap_company(text, text) to authenticated;
