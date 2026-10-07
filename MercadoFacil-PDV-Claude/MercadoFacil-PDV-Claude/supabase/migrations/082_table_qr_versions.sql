-- Invalidar o QR de uma mesa (QR perdido/vazado): versão do token por mesa.
--
-- O token do QR da mesa é um hash de (empresa, mesa); sem estado não dá para trocá-lo. Esta tabela guarda a VERSÃO atual
-- por mesa: ausência de linha = versão 0 (os QR já impressos continuam valendo). "Invalidar" incrementa a versão; o token
-- passa a ser hash(empresa, mesa, versão) e o QR antigo deixa de resolver em TODOS os caixas (a versão vem do banco).
-- Multi-tenant: company_id obrigatório + RLS por empresa (mesmo padrão de table_orders). Idempotente.
create table if not exists public.table_qr_versions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  table_number text not null,
  version integer not null default 0 check (version >= 0),
  rotated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists table_qr_versions_uidx
  on public.table_qr_versions (company_id, table_number);

alter table public.table_qr_versions enable row level security;

drop policy if exists "table_qr_versions_tenant_all" on public.table_qr_versions;
create policy "table_qr_versions_tenant_all" on public.table_qr_versions
  for all to authenticated
  using (company_id = public.current_company_id())
  with check (company_id = public.current_company_id());

grant select, insert, update, delete on public.table_qr_versions to authenticated;
