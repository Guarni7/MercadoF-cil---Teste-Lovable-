-- Sangria/Suprimento: leitura + gravação direta (SangriaDialog.jsx e
-- SuprimentoDialog.jsx faziam api.entities.CashRegister.update(id, {
-- withdrawals_total: (register.withdrawals_total || 0) + amount }), somando
-- em cima do valor que já estava no estado React) perde atualização sob
-- concorrência — dois terminais fazendo sangria no mesmo caixa ao mesmo
-- tempo, o clássico read-modify-write: os dois leem o mesmo total, os dois
-- somam por cima, o segundo UPDATE apaga o primeiro. E não existia fila
-- offline nenhuma: sem internet a chamada falhava e a operação sumia sem
-- rastro (nem no banco, nem na fila de sincronização).
--
-- Mesma estratégia de apply_stock_movement (057): tabela de auditoria com
-- client_id idempotente (retry/reenvio não duplica) + UPDATE atômico via
-- coluna = coluna + valor — o Postgres serializa por lock de linha, então a
-- corrida vira sequência (um aplica, commita, o outro aplica em cima do
-- valor já atualizado), nunca dois SELECTs lendo o mesmo valor stale e os
-- dois UPDATEs OK por cima.

create table if not exists public.cash_movements (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  cash_register_id uuid not null references public.cash_registers(id) on delete cascade,
  type text not null check (type in ('sangria', 'suprimento')),
  amount numeric not null check (amount > 0),
  reason text,
  client_id text,
  terminal_id text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create unique index if not exists cash_movements_client_id_idx
  on public.cash_movements (client_id)
  where client_id is not null;

create index if not exists cash_movements_register_idx
  on public.cash_movements (cash_register_id, created_at desc);

alter table public.cash_movements enable row level security;

drop policy if exists "cash_movements_tenant_all" on public.cash_movements;
create policy "cash_movements_tenant_all" on public.cash_movements
  for all to authenticated
  using (company_id = public.current_company_id())
  with check (company_id = public.current_company_id());

-- SECURITY INVOKER: RLS de cash_registers/cash_movements (cash_tenant_all,
-- cash_movements_tenant_all) já restringe tudo à própria empresa, sem
-- precisar de privilégio elevado — mesmo raciocínio de apply_stock_movement.
create or replace function public.apply_cash_movement(
  p_client_id text,
  p_cash_register_id uuid,
  p_type text,
  p_amount numeric,
  p_reason text default null,
  p_terminal_id text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_company_id uuid;
  v_total numeric;
begin
  if p_client_id is null or length(trim(p_client_id)) = 0 then
    raise exception 'client_id obrigatório para movimentação idempotente';
  end if;
  if p_type not in ('sangria', 'suprimento') then
    raise exception 'Tipo de movimentação de caixa inválido: %', p_type;
  end if;
  if coalesce(p_amount, 0) <= 0 then
    raise exception 'Valor da movimentação de caixa precisa ser maior que zero';
  end if;

  select company_id into v_company_id
  from public.cash_registers
  where id = p_cash_register_id;

  if v_company_id is null then
    raise exception 'Caixa % não encontrado', p_cash_register_id;
  end if;

  -- client_id tem índice único: se já existe, a operação já foi aplicada —
  -- reenvio (retry após timeout, reprocessamento da fila offline) não duplica.
  if exists (select 1 from public.cash_movements where client_id = p_client_id) then
    select case when p_type = 'sangria' then withdrawals_total else supplies_total end
      into v_total
      from public.cash_registers where id = p_cash_register_id;
    return jsonb_build_object('applied', false, 'reason', 'already_applied', 'total', v_total);
  end if;

  insert into public.cash_movements (
    company_id, cash_register_id, type, amount, reason, client_id, terminal_id, created_by
  ) values (
    v_company_id, p_cash_register_id, p_type, p_amount, p_reason, p_client_id, p_terminal_id, auth.uid()
  );

  if p_type = 'sangria' then
    update public.cash_registers
      set withdrawals_total = coalesce(withdrawals_total, 0) + p_amount,
          updated_at = now()
      where id = p_cash_register_id
      returning withdrawals_total into v_total;
  else
    update public.cash_registers
      set supplies_total = coalesce(supplies_total, 0) + p_amount,
          updated_at = now()
      where id = p_cash_register_id
      returning supplies_total into v_total;
  end if;

  return jsonb_build_object('applied', true, 'total', v_total);
exception
  when unique_violation then
    select case when p_type = 'sangria' then withdrawals_total else supplies_total end
      into v_total
      from public.cash_registers where id = p_cash_register_id;
    return jsonb_build_object('applied', false, 'reason', 'already_applied', 'total', v_total);
end;
$$;

revoke all on function public.apply_cash_movement(text, uuid, text, numeric, text, text) from public;
grant execute on function public.apply_cash_movement(text, uuid, text, numeric, text, text) to authenticated;
