-- Devolução parcial/total de venda — registro formal, vinculado à venda
-- original.
--
-- Antes só existia "cancelar venda inteira" (Sales.jsx handleCancel):
-- Product.get + Product.bulkUpdate direto (sem stock_movements, sem trilha,
-- sujeito a corrida entre duas devoluções concorrentes do mesmo produto), sem
-- registro de quem/quando/motivo, sem limite contra devolver mais do que foi
-- vendido. sale_returns aqui é o registro formal; a baixa de estoque em si
-- continua sendo feita pelo cliente via apply_stock_movement (009), tipo
-- 'entrada' — o mesmo caminho atômico e idempotente que toda entrada/saída de
-- estoque já usa, nunca leitura-e-escrita direta.
--
-- items segue o mesmo formato jsonb de sales.items/sales.payments (padrão já
-- estabelecido neste projeto para listas por linha, ver 001/053) em vez de
-- uma tabela filha — mais simples e herda o mesmo estilo de validação via
-- trigger.
create table if not exists public.sale_returns (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  sale_id uuid not null references public.sales(id) on delete restrict,

  -- Idempotência (mesmo padrão de sales.client_id/stock_movements.client_id):
  -- reenvio da mesma devolução (retry de rede, duplo clique) não duplica.
  client_id text,

  -- [{ product_id, name, quantity, unit_price, total }]
  items jsonb not null default '[]'::jsonb,
  total numeric not null default 0,

  reason text,

  -- O que DEVE ser estornado, não confirmação de que foi estornado de
  -- verdade — TEF/PIX/cartão não têm estorno automático implementado ainda
  -- (ver comentário em transmitters.ts/tef.js sobre não fabricar sucesso).
  refund_method text,
  refund_amount numeric not null default 0,

  created_by uuid references auth.users(id) on delete set null,
  created_by_name text,
  created_at timestamptz not null default now()
);

create index if not exists sale_returns_sale_idx
  on public.sale_returns (sale_id, created_at desc);

-- Único por empresa quando informado — mesmo papel do índice único em
-- stock_movements.client_id (009_apply_stock_movement.sql).
create unique index if not exists sale_returns_client_id_idx
  on public.sale_returns (company_id, client_id)
  where client_id is not null;

alter table public.sale_returns enable row level security;

drop policy if exists "sale_returns_tenant_select" on public.sale_returns;
create policy "sale_returns_tenant_select" on public.sale_returns
  for select to authenticated
  using (company_id = public.current_company_id());

-- Só insert: devolução é registro de auditoria, não se edita depois de
-- criada — mesmo padrão de stock_movements/fiscal_audit_log (append-only).
drop policy if exists "sale_returns_tenant_insert" on public.sale_returns;
create policy "sale_returns_tenant_insert" on public.sale_returns
  for insert to authenticated
  with check (company_id = public.current_company_id());

-- Impede devolver mais do que foi vendido (somando devoluções já
-- registradas do mesmo produto na mesma venda) e impede apontar para venda
-- de outra empresa ou já cancelada. SECURITY INVOKER (padrão Postgres): RLS
-- de sales/sale_returns já restringe à própria empresa, sem precisar de
-- privilégio elevado — mesma estratégia de 049/053.
create or replace function public.sale_returns_validate()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_sale record;
  v_item jsonb;
  v_product_id text;
  v_qty numeric;
  v_sold numeric;
  v_returned numeric;
  v_sum numeric := 0;
begin
  select id, company_id, status, items into v_sale
  from public.sales where id = new.sale_id;

  if v_sale.id is null then
    raise exception 'Venda % não encontrada', new.sale_id;
  end if;
  if v_sale.company_id <> new.company_id then
    raise exception 'Devolução não pode apontar para venda de outra empresa';
  end if;
  if v_sale.status = 'cancelada' then
    raise exception 'Venda já está cancelada — não é possível registrar devolução';
  end if;

  if new.items is null or jsonb_array_length(new.items) = 0 then
    raise exception 'Devolução sem itens';
  end if;

  for v_item in select * from jsonb_array_elements(new.items) loop
    v_product_id := v_item ->> 'product_id';
    v_qty := case when jsonb_typeof(v_item -> 'quantity') = 'number'
                  then (v_item ->> 'quantity')::numeric end;

    if v_product_id is null or v_product_id = '' or v_qty is null or v_qty <= 0 then
      raise exception 'Item de devolução inválido (product_id/quantity)';
    end if;

    select coalesce(sum(
      case when jsonb_typeof(i -> 'quantity') = 'number' then (i ->> 'quantity')::numeric else 0 end
    ), 0)
    into v_sold
    from jsonb_array_elements(coalesce(v_sale.items, '[]'::jsonb)) as i
    where i ->> 'product_id' = v_product_id;

    if v_sold = 0 then
      raise exception 'Produto % não faz parte da venda original', v_product_id;
    end if;

    select coalesce(sum(
      case when jsonb_typeof(ri -> 'quantity') = 'number' then (ri ->> 'quantity')::numeric else 0 end
    ), 0)
    into v_returned
    from public.sale_returns sr
    cross join lateral jsonb_array_elements(sr.items) as ri
    where sr.sale_id = new.sale_id
      and ri ->> 'product_id' = v_product_id;

    if v_returned + v_qty > v_sold + 0.0001 then
      raise exception
        'Quantidade devolvida (%) excede o saldo disponível (%) do produto %',
        v_returned + v_qty, greatest(v_sold - v_returned, 0), v_product_id;
    end if;

    v_sum := v_sum + coalesce(
      case when jsonb_typeof(v_item -> 'total') = 'number' then (v_item ->> 'total')::numeric end,
      0
    );
  end loop;

  -- total é recalculado a partir dos próprios itens, mesmo raciocínio de
  -- 049 (sales.total nunca aceito só porque o cliente mandou): impede um
  -- total inflado sem itens correspondentes.
  new.total := v_sum;
  if new.refund_amount is null or new.refund_amount = 0 then
    new.refund_amount := v_sum;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_sale_returns_validate on public.sale_returns;
create trigger trg_sale_returns_validate
  before insert on public.sale_returns
  for each row
  execute function public.sale_returns_validate();
