-- Renovação de plano: cada pagamento aprovado soma 30 dias a partir do maior
-- entre o vencimento atual e agora — só para empresa com plano 'active'.
--
-- Antes (067) a validade era sempre now() + 30 dias: quem renovava com 10 dias
-- restantes perdia esses 10 dias. Agora:
--   * plano 'active' ainda vigente  → vencimento atual + 30 dias (preserva os
--     dias restantes);
--   * plano 'active' já vencido (inclui os dias de tolerância) → agora + 30;
--   * trial (ou qualquer outro estado) → agora + 30. Os dias que sobraram do
--     teste grátis não viram crédito: pagar encerra o trial.
-- start_trial() não é tocado.
--
-- Duas cobranças diferentes da mesma empresa aprovadas ao mesmo tempo também
-- não perdem dias: a linha de companies é travada (`for update`) depois da
-- linha da cobrança, então a segunda soma em cima do vencimento já renovado
-- pela primeira. Ordem de lock fixa (pix_charges → companies) — nenhum outro
-- código trava nessa ordem inversa.
--
-- Idempotência igual à 067: a mesma cobrança (mesmo payment_id) nunca soma duas
-- vezes (`activated_at is not null` → already_activated).
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
  v_co record;
  v_now timestamptz := now();
  v_base timestamptz;
  v_expires timestamptz;
begin
  select * into v_charge
  from public.pix_charges
  where payment_id = p_payment_id
  for update;

  if not found then
    return query select false, 'charge_not_found'::text, null::uuid, null::text, null::timestamptz;
    return;
  end if;

  if v_charge.activated_at is not null then
    select public.companies.plan, public.companies.plan_expires_at into v_co
    from public.companies where id = v_charge.company_id;
    return query select true, 'already_activated'::text, v_charge.company_id, v_co.plan, v_co.plan_expires_at;
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

  if abs(coalesce(p_mp_amount, 0) - coalesce(v_charge.amount, 0)) > 0.01 then
    return query select false, 'amount_mismatch'::text, v_charge.company_id, v_charge.plan_id, null::timestamptz;
    return;
  end if;

  -- Trava a empresa para ler o vencimento atual sem corrida com outra renovação.
  select * into v_co from public.companies where id = v_charge.company_id for update;

  v_base := case
    when v_co.plan_status = 'active' and v_co.plan_expires_at is not null and v_co.plan_expires_at > v_now
      then v_co.plan_expires_at
    else v_now
  end;
  v_expires := v_base + interval '30 days';

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

  -- profiles.plan_status é cache por usuário — companies é quem manda.
  -- `profiles.company_id` qualificado: "company_id" sozinho colide com a
  -- coluna de saída do RETURNS TABLE.
  update public.profiles
  set plan = v_charge.plan_id,
      plan_status = 'active',
      plan_expires_at = v_expires,
      updated_at = v_now
  where public.profiles.company_id = v_charge.company_id;

  return query select true, 'activated'::text, v_charge.company_id, v_charge.plan_id, v_expires;
end;
$$;
