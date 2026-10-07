-- Cadastro fiscal de produtos e serviços.
--
-- products tinha uma coluna fiscal_info jsonb que nunca foi preenchida (null em
-- 100% das linhas) e nenhum campo fiscal real. O XML gerado caía num NCM
-- "00000000" e CFOP "5102" fixos vindos da config, o que rejeita na SEFAZ.
-- Coluna dedicada em vez de jsonb porque esses campos são validados, filtrados
-- e obrigatórios no leiaute.

alter table public.products
  add column if not exists ncm text,
  add column if not exists cest text,
  add column if not exists cfop text,
  add column if not exists origin text,
  add column if not exists icms_cst text,
  add column if not exists icms_csosn text,
  add column if not exists pis_cst text,
  add column if not exists cofins_cst text,
  add column if not exists ibscbs_cst text,
  add column if not exists ibscbs_class_trib text,
  add column if not exists tax_benefit_code text,
  add column if not exists unit_trib text,
  add column if not exists gtin text,
  add column if not exists fiscal_notes text;

-- NCM tem 8 dígitos; CEST 7; CFOP 4. Campo vazio é permitido (produto ainda não
-- classificado), mas preenchido errado não passa — melhor barrar aqui do que
-- descobrir na rejeição.
alter table public.products drop constraint if exists products_ncm_format;
alter table public.products add constraint products_ncm_format
  check (ncm is null or ncm ~ '^[0-9]{8}$');

alter table public.products drop constraint if exists products_cest_format;
alter table public.products add constraint products_cest_format
  check (cest is null or cest ~ '^[0-9]{7}$');

alter table public.products drop constraint if exists products_cfop_format;
alter table public.products add constraint products_cfop_format
  check (cfop is null or cfop ~ '^[0-9]{4}$');

create index if not exists products_ncm_idx on public.products (company_id, ncm);

-- Serviços.
--
-- O PDV só conhecia produto. MEI e Simples que prestam serviço emitem NFS-e, e
-- a NFS-e Nacional exige código do serviço da lista nacional (Anexo B — NBS2 /
-- Lista de Serviço Nacional), município de incidência e tratamento de ISS.
create table if not exists public.services (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  code text,
  name text not null,
  description text,
  price numeric(14, 2) not null default 0,
  unit text,

  -- Classificação fiscal do serviço
  lc116_item text,
  service_national_code text,
  nbs_code text,
  city_ibge_code text,

  -- ISS
  iss_rate numeric(7, 4),
  iss_withheld boolean not null default false,
  iss_exigibility text,

  -- Retenções federais
  withhold_irrf boolean not null default false,
  withhold_csll boolean not null default false,
  withhold_inss boolean not null default false,
  withhold_pis boolean not null default false,
  withhold_cofins boolean not null default false,

  -- IBS/CBS
  ibscbs_cst text,
  ibscbs_class_trib text,

  active boolean not null default true,
  client_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists services_company_idx on public.services (company_id, active);
create unique index if not exists services_client_id_idx
  on public.services (company_id, client_id) where client_id is not null;

alter table public.services enable row level security;

drop policy if exists "services_tenant_select" on public.services;
create policy "services_tenant_select" on public.services
  for select to authenticated
  using (company_id = public.current_company_id());

drop policy if exists "services_tenant_write" on public.services;
create policy "services_tenant_write" on public.services
  for all to authenticated
  using (company_id = public.current_company_id())
  with check (company_id = public.current_company_id());

grant select, insert, update, delete on public.services to authenticated;
