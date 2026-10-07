-- Atendimento por mesa/comanda (opcional — venda rápida não usa esta tabela).
--
-- Não existia nenhuma estrutura de mesa/comanda/atendimento (delivery_orders é pedido de entrega, com
-- endereço e taxa; sales só nasce no fechamento). Um atendimento = uma linha: mesa/comanda são o mesmo
-- conceito nesta versão (table_number identifica a mesa ou o número da comanda).
--
--   people jsonb  [{ id, label, peso, preco_kg, valor, manual, paga }]  — almoço por peso, uma entrada por pessoa
--                 (peso × preço/kg = valor; manual = valor ajustado à mão). NÃO vira produto.
--   items  jsonb  [{ id, product_id, name, price, quantity, paga }]     — produtos normais
--
-- O pagamento reaproveita o checkout do PDV: a venda (sales) é criada pelo fluxo normal e o PDV marca aqui
-- as pessoas/itens pagos (`paga`) e acrescenta o id da venda em sale_ids. Quando tudo está pago o
-- atendimento vira 'fechada' e a mesa fica livre. A receita e a baixa de estoque continuam só na venda.
--
-- Multi-tenant: company_id obrigatório + RLS por empresa (mesmo padrão de services/delivery_orders).
-- Idempotente: pode rodar mais de uma vez.
create table if not exists public.table_orders (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  table_number text not null,
  status text not null default 'aberta' check (status in ('aberta', 'fechada', 'cancelada')),
  people jsonb not null default '[]'::jsonb,
  items jsonb not null default '[]'::jsonb,
  sale_ids jsonb not null default '[]'::jsonb,
  notes text,
  opened_by_name text,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Uma mesa só pode ter UM atendimento aberto por vez (abrir duas vezes a mesma mesa é recusado pelo banco).
create unique index if not exists table_orders_open_uidx
  on public.table_orders (company_id, table_number) where status = 'aberta';

create index if not exists table_orders_company_idx
  on public.table_orders (company_id, status, created_at desc);

alter table public.table_orders enable row level security;

drop policy if exists "table_orders_tenant_all" on public.table_orders;
create policy "table_orders_tenant_all" on public.table_orders
  for all to authenticated
  using (company_id = public.current_company_id())
  with check (company_id = public.current_company_id());

grant select, insert, update, delete on public.table_orders to authenticated;
