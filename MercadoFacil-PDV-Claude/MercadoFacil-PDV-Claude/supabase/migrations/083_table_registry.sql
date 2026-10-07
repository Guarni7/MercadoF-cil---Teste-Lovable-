-- Cadastro de mesas por empresa ("Criar mesas" / "Remover mesas" em Mesas).
--
-- Até aqui as mesas eram 1..N de uma configuração local do aparelho. Agora cada empresa tem as suas mesas no banco
-- (compartilhadas por todos os caixas): criar uma faixa (ex.: 1 até 10) insere as mesas que faltam; remover uma faixa
-- apaga o cadastro (o app não remove mesa com atendimento aberto). Os atendimentos (table_orders) e o histórico NÃO
-- dependem desta tabela: remover uma mesa não apaga atendimento nenhum.
-- Multi-tenant: company_id obrigatório + RLS por empresa (mesmo padrão de table_orders). Idempotente.
create table if not exists public.table_registry (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  table_number text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists table_registry_uidx
  on public.table_registry (company_id, table_number);

alter table public.table_registry enable row level security;

drop policy if exists "table_registry_tenant_all" on public.table_registry;
create policy "table_registry_tenant_all" on public.table_registry
  for all to authenticated
  using (company_id = public.current_company_id())
  with check (company_id = public.current_company_id());

grant select, insert, update, delete on public.table_registry to authenticated;
