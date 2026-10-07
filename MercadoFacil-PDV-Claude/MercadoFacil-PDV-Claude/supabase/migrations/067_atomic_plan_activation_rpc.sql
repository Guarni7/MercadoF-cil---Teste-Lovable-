-- Ativação atômica de assinatura paga (substitui as 3 escritas independentes
-- que activatePlanFromCharge fazia via supabase-js — sem transação entre
-- elas, uma falha no meio deixava activated_at gravado e companies nunca
-- atualizado, travando a cobrança pra sempre sem caminho de retry).
--
-- Uma chamada de função plpgsql roda inteira na mesma transação: qualquer
-- exceção não tratada desfaz TODAS as escritas feitas até ali, incluindo
-- pix_charges.activated_at. `select ... for update` trava a linha da
-- cobrança — uma segunda chamada concorrente para o mesmo payment_id espera
-- a primeira terminar (commit ou rollback) antes de prosseguir, então nunca
-- há corrida real dentro da ativação em si.
create or replace function public.activate_plan_subscription(
  p_payment_id text,
  p_mp_status text,
  p_mp_amount numeric
)
returns table (
  activated boolean,
  reason text,
  company_id uuid,
  plan_id text,
  plan_expires_at timestamptz
)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_charge record;
  v_now timestamptz := now();
  v_expires timestamptz;
  v_company record;
begin
  select * into v_charge
  from public.pix_charges
  where payment_id = p_payment_id
  for update;

  if not found then
    return query select false, 'charge_not_found'::text, null::uuid, null::text, null::timestamptz;
    return;
  end if;

  -- Já processada antes (por esta chamada ou por outra que venceu a corrida):
  -- do ponto de vista de quem chama, a assinatura ESTÁ ativa — só não foi
  -- esta chamada que fez o trabalho. activated=true aqui é proposital: o
  -- contrato de activated é "a cobrança está ativada no banco agora", não
  -- "eu fiz a ativação".
  if v_charge.activated_at is not null then
    -- Qualificado: "plan_expires_at" sozinho também colide com a coluna de
    -- saída do RETURNS TABLE.
    select public.companies.plan, public.companies.plan_expires_at into v_company
    from public.companies where id = v_charge.company_id;
    return query select true, 'already_activated'::text, v_charge.company_id, v_company.plan, v_company.plan_expires_at;
    return;
  end if;

  if p_mp_status <> 'approved' then
    return query select false, 'not_approved'::text, v_charge.company_id, v_charge.plan_id, null::timestamptz;
    return;
  end if;

  if v_charge.plan_id is null then
    return query select false, 'not_a_subscription_charge'::text, v_charge.company_id, null::text, null::timestamptz;
    return;
  end if;

  -- O que o Mercado Pago confirma que foi pago tem que bater com o que o
  -- backend calculou e cobrou na criação da cobrança — nunca um valor vindo
  -- do frontend.
  if abs(coalesce(p_mp_amount, 0) - coalesce(v_charge.amount, 0)) > 0.01 then
    return query select false, 'amount_mismatch'::text, v_charge.company_id, v_charge.plan_id, null::timestamptz;
    return;
  end if;

  v_expires := v_now + interval '30 days';

  update public.pix_charges
  set activated_at = v_now, updated_at = v_now
  where id = v_charge.id;

  update public.companies
  set plan = v_charge.plan_id,
      plan_status = 'active',
      plan_expires_at = v_expires,
      plan_addons = coalesce(v_charge.addon_ids, '{}'),
      updated_at = v_now
  where id = v_charge.company_id;

  -- profiles.plan_status é cache por usuário (mesmo padrão de
  -- activate-company e start_trial) — companies é quem manda de verdade.
  -- `profiles.company_id` qualificado: "company_id" sozinho é ambíguo aqui
  -- (colide com a coluna de saída "company_id" do RETURNS TABLE).
  update public.profiles
  set plan = v_charge.plan_id,
      plan_status = 'active',
      plan_expires_at = v_expires,
      updated_at = v_now
  where public.profiles.company_id = v_charge.company_id;

  return query select true, 'activated'::text, v_charge.company_id, v_charge.plan_id, v_expires;
end;
$$;

-- Só o backend (Edge Function com service_role) chama isso. anon/authenticated
-- nunca devem conseguir ativar uma assinatura direto por SQL/REST. `revoke
-- all ... from public` sozinho não basta — mesmo caso de 041/048:
-- ALTER DEFAULT PRIVILEGES (migration 003) já concede EXECUTE automático pra
-- authenticated/anon em toda função nova, e isso é um grant próprio dessas
-- roles, não coberto pelo revoke de `public`. Precisa revogar explicitamente.
revoke all on function public.activate_plan_subscription(text, text, numeric) from public;
revoke execute on function public.activate_plan_subscription(text, text, numeric) from authenticated, anon;
grant execute on function public.activate_plan_subscription(text, text, numeric) to service_role;
