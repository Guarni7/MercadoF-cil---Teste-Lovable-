-- start_trial() só pode conceder o teste grátis UMA vez por empresa.
--
-- Antes (065) só barrava trial ainda vigente: com o trial vencido (ou plano
-- pago vencido/cancelado) a função caía no fluxo normal e concedia mais 7 dias
-- — trial infinito bastando esperar vencer e chamar de novo.
--
-- Agora:
--   * plano 'active' ou 'trial' ainda dentro da validade → devolve o estado
--     atual sem alterar nada (idempotente, como antes);
--   * qualquer outro estado COM histórico (já teve trial/plano: status
--     diferente de 'none', data de validade ou trial_started_at gravados, na
--     empresa ou no profile) → recusa com exceção;
--   * só empresa sem nenhum histórico ganha os 7 dias.
--
-- A empresa (companies) manda: é o mesmo critério de getEffectivePlanFields no
-- client. Antes a decisão olhava só o profile de quem chamava, então um
-- membro cujo profile ainda estava 'none' dentro de uma empresa com plano
-- ativo podia, chamando a RPC direto, rebaixar o plano da empresa a trial.
--
-- Cuidado de nomes: as colunas de saída (plan, plan_status, plan_expires_at,
-- company_id) colidem com colunas das tabelas — por isso tudo aqui é lido por
-- record qualificado (me./co.) ou variável v_*, nunca pelo nome solto.
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
  v_status text;
  v_expires timestamptz;
  v_expired boolean;
  v_had_history boolean;
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

  v_status := coalesce(nullif(co.plan_status, ''), nullif(me.plan_status, ''), 'none');
  v_expires := coalesce(co.plan_expires_at, me.plan_expires_at);
  v_expired := v_expires is not null and v_expires <= now_ts;
  v_had_history := v_status <> 'none'
    or v_expires is not null
    or co.trial_started_at is not null
    or me.trial_started_at is not null;

  -- Plano ou trial ainda vigente: nada a fazer.
  if v_status in ('active', 'trial') and not v_expired then
    return query select coalesce(co.plan, me.plan), v_status, v_expires, me.company_id;
    return;
  end if;

  if v_had_history then
    raise exception 'trial already used — choose a paid plan to continue';
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
