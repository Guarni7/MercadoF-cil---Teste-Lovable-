-- Bloqueio de estoque negativo, com opção por empresa (só admin liga) e
-- proteção contra corrida entre caixas.
--
-- Hoje apply_stock_movement (009, custo em 026) aplica saída sem checar saldo
-- — dois caixas vendendo a última unidade ao mesmo tempo, ou um sync offline
-- chegando depois que o estoque real já zerou, colocam o produto em negativo
-- sem erro nenhum. products.stock também não tem CHECK (stock >= 0).

-- 1) Configuração por empresa — mesmo modelo de company_fiscal_settings/
-- company_payment_settings (tabela própria por domínio, não emenda em
-- companies, que já tem grant de coluna trancado desde 037). Nasce false:
-- estoque negativo bloqueado por padrão, como pedido.
create table if not exists public.company_stock_settings (
  company_id uuid primary key references public.companies(id) on delete cascade,
  allow_negative_stock boolean not null default false,
  updated_at timestamptz not null default now()
);

alter table public.company_stock_settings enable row level security;

-- Qualquer membro da empresa pode ler (a tela de vendas precisa saber se
-- pode vender sem saldo antes de finalizar). Só admin/owner grava — helper
-- abaixo, mesmo estilo de current_company_id() (002_tenant_rls.sql).
create or replace function public.current_company_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(company_role, role) from public.profiles where id = auth.uid()
$$;

revoke all on function public.current_company_role() from public;
grant execute on function public.current_company_role() to authenticated;

drop policy if exists "stock_settings_tenant_select" on public.company_stock_settings;
create policy "stock_settings_tenant_select" on public.company_stock_settings
  for select to authenticated
  using (company_id = public.current_company_id());

drop policy if exists "stock_settings_admin_write" on public.company_stock_settings;
create policy "stock_settings_admin_write" on public.company_stock_settings
  for all to authenticated
  using (
    company_id = public.current_company_id()
    and public.current_company_role() in ('owner', 'admin', 'platform_admin')
  )
  with check (
    company_id = public.current_company_id()
    and public.current_company_role() in ('owner', 'admin', 'platform_admin')
  );

-- 2) apply_stock_movement: saída passa a ser condicional quando a empresa não
-- permitiu estoque negativo (padrão). UPDATE com WHERE stock >= quantity é o
-- que resolve a corrida: o Postgres serializa via lock de linha, então o
-- segundo UPDATE concorrente só roda depois do primeiro commitar — se o
-- primeiro já consumiu o saldo, a condição do segundo falha e ele é
-- recusado, em vez de aplicar por cima (dois SELECTs lendo o mesmo valor e
-- os dois UPDATEs passando, que é como o bug acontecia antes).
--
-- Sem linha em company_stock_settings (empresa nunca configurou) o padrão é
-- bloquear — coalesce trata null como false.
create or replace function public.apply_stock_movement(
  p_client_id text,
  p_product_id uuid,
  p_quantity numeric,
  p_product_name text default null,
  p_type text default 'saida',
  p_reason text default 'venda',
  p_notes text default null,
  p_terminal_id text default null,
  p_unit_cost numeric default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_company_id uuid;
  v_stock numeric;
  v_delta numeric;
  v_allow_negative boolean;
  v_enforce boolean;
begin
  if p_client_id is null or length(trim(p_client_id)) = 0 then
    raise exception 'client_id obrigatório para movimentação idempotente';
  end if;

  select company_id, stock into v_company_id, v_stock
  from public.products
  where id = p_product_id;

  if v_company_id is null then
    raise exception 'Produto % não encontrado', p_product_id;
  end if;

  -- client_id tem índice único: se já existe, a operação já foi aplicada.
  if exists (select 1 from public.stock_movements where client_id = p_client_id) then
    return jsonb_build_object('applied', false, 'reason', 'already_applied', 'stock', v_stock);
  end if;

  v_enforce := p_type = 'saida';
  if v_enforce then
    select allow_negative_stock into v_allow_negative
    from public.company_stock_settings
    where company_id = v_company_id;
    v_enforce := not coalesce(v_allow_negative, false);
  end if;

  if v_enforce then
    update public.products
      set stock = stock - p_quantity, updated_at = now()
      where id = p_product_id and coalesce(stock, 0) >= p_quantity
      returning stock into v_stock;

    if not found then
      select stock into v_stock from public.products where id = p_product_id;
      return jsonb_build_object('applied', false, 'reason', 'insufficient_stock', 'stock', v_stock);
    end if;

    insert into public.stock_movements (
      product_id, product_name, type, quantity, reason, notes,
      client_id, terminal_id, company_id, unit_cost
    ) values (
      p_product_id::text, p_product_name, p_type, p_quantity, p_reason, p_notes,
      p_client_id, p_terminal_id, v_company_id, p_unit_cost
    );

    return jsonb_build_object('applied', true, 'stock', v_stock);
  end if;

  -- Entrada, ou saída com allow_negative_stock=true: fluxo original, sem
  -- checar saldo.
  insert into public.stock_movements (
    product_id, product_name, type, quantity, reason, notes,
    client_id, terminal_id, company_id, unit_cost
  ) values (
    p_product_id::text, p_product_name, p_type, p_quantity, p_reason, p_notes,
    p_client_id, p_terminal_id, v_company_id, p_unit_cost
  );

  v_delta := case when p_type = 'entrada' then p_quantity else -p_quantity end;

  update public.products
  set stock = coalesce(stock, 0) + v_delta,
      updated_at = now()
  where id = p_product_id
  returning stock into v_stock;

  return jsonb_build_object('applied', true, 'stock', v_stock);
exception
  when unique_violation then
    select stock into v_stock from public.products where id = p_product_id;
    return jsonb_build_object('applied', false, 'reason', 'already_applied', 'stock', v_stock);
end;
$$;

revoke all on function public.apply_stock_movement(
  text, uuid, numeric, text, text, text, text, text, numeric
) from public;
grant execute on function public.apply_stock_movement(
  text, uuid, numeric, text, text, text, text, text, numeric
) to authenticated;
