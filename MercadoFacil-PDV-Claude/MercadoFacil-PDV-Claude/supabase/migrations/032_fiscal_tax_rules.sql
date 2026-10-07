-- Motor tributário versionado (ICMS, PIS, COFINS, ISS, IBS e CBS).
--
-- O código antigo resolvia tributo com constante: src/lib/nfce.js emitia
-- ICMSSN102 com CSOSN fixo e vItem 0.00 para qualquer item de qualquer
-- empresa. Alíquota não pode morar no código: ela muda por vigência, por UF,
-- por NCM e por regime, e o IBS/CBS ainda vai mudar várias vezes até 2027.
--
-- Aqui a alíquota é dado: um conjunto de regras com vigência, e a regra mais
-- específica que estiver vigente na data da operação é a que vale.
--
-- Referências oficiais:
--   NT 2025.002-RTC (NF-e/NFC-e, grupo UB — det/imposto/IBSCBS)
--   IT 2025.002 — Tabelas de Classificação do IBS e da CBS (CST e cClassTrib)
--   LC 214/2025
-- Art. 348 da LC 214/25: para CRT 1, 2 e 4 (Simples e MEI) a tributação de
-- IBS/CBS só começa em 2027 e as regras serão publicadas em NT futura — mais um
-- motivo para a alíquota ser carregada, não compilada.

-- Tabela oficial de CST do IBS/CBS (18 códigos, IT 2025.002).
create table if not exists public.fiscal_cst_codes (
  code text primary key,
  name text not null,
  tax text not null default 'ibscbs',
  valid_from date,
  valid_to date,
  source text,
  updated_at timestamptz not null default now()
);

alter table public.fiscal_cst_codes enable row level security;

-- Tabela de referência: igual para todas as empresas, leitura liberada para
-- qualquer usuário autenticado, escrita só por service role.
drop policy if exists "fiscal_cst_read" on public.fiscal_cst_codes;
create policy "fiscal_cst_read" on public.fiscal_cst_codes
  for select to authenticated using (true);

insert into public.fiscal_cst_codes (code, name, source) values
  ('000', 'Tributação integral', 'IT 2025.002 - Tabela CST IBS/CBS'),
  ('010', 'Tributação com alíquotas uniformes', 'IT 2025.002 - Tabela CST IBS/CBS'),
  ('011', 'Tributação com alíquotas uniformes reduzidas', 'IT 2025.002 - Tabela CST IBS/CBS'),
  ('200', 'Alíquota reduzida', 'IT 2025.002 - Tabela CST IBS/CBS'),
  ('220', 'Alíquota fixa', 'IT 2025.002 - Tabela CST IBS/CBS'),
  ('221', 'Alíquota fixa proporcional', 'IT 2025.002 - Tabela CST IBS/CBS'),
  ('222', 'Redução de base de cálculo', 'IT 2025.002 - Tabela CST IBS/CBS'),
  ('400', 'Isenção', 'IT 2025.002 - Tabela CST IBS/CBS'),
  ('410', 'Imunidade e não incidência', 'IT 2025.002 - Tabela CST IBS/CBS'),
  ('510', 'Diferimento', 'IT 2025.002 - Tabela CST IBS/CBS'),
  ('515', 'Diferimento com redução de alíquota', 'IT 2025.002 - Tabela CST IBS/CBS'),
  ('550', 'Suspensão', 'IT 2025.002 - Tabela CST IBS/CBS'),
  ('620', 'Tributação monofásica', 'IT 2025.002 - Tabela CST IBS/CBS'),
  ('800', 'Transferência de crédito', 'IT 2025.002 - Tabela CST IBS/CBS'),
  ('810', 'Ajuste de IBS na ZFM', 'IT 2025.002 - Tabela CST IBS/CBS'),
  ('811', 'Ajustes', 'IT 2025.002 - Tabela CST IBS/CBS'),
  ('820', 'Tributação em documento específico', 'IT 2025.002 - Tabela CST IBS/CBS'),
  ('830', 'Exclusão da base de cálculo', 'IT 2025.002 - Tabela CST IBS/CBS')
on conflict (code) do update set name = excluded.name, source = excluded.source;

-- Tabela oficial de cClassTrib. São centenas de códigos com indicadores que
-- comandam as regras de validação, e a lista muda a cada versão do IT. Nasce
-- vazia de propósito: quem popula é scripts/fiscal/import-class-trib.mjs a
-- partir do arquivo oficial. Inventar código aqui produziria rejeição na
-- SEFAZ, então a tela avisa quando a tabela não está carregada.
create table if not exists public.fiscal_class_trib_codes (
  code text primary key,
  cst_code text not null references public.fiscal_cst_codes(code),
  name text not null,
  indicators jsonb not null default '{}'::jsonb,
  valid_from date,
  valid_to date,
  source text,
  updated_at timestamptz not null default now()
);

create index if not exists fiscal_class_trib_cst_idx
  on public.fiscal_class_trib_codes (cst_code);

alter table public.fiscal_class_trib_codes enable row level security;

drop policy if exists "fiscal_class_trib_read" on public.fiscal_class_trib_codes;
create policy "fiscal_class_trib_read" on public.fiscal_class_trib_codes
  for select to authenticated using (true);

-- Conjunto de regras tributárias com vigência.
--
-- company_id nulo = conjunto base do sistema, visível para todas as empresas.
-- company_id preenchido = regra própria daquela loja, que vence a base.
create table if not exists public.tax_rule_sets (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete cascade,
  name text not null,
  version text not null,
  valid_from date not null,
  valid_to date,
  status text not null default 'draft' check (status in ('draft', 'active', 'archived')),
  source text,
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists tax_rule_sets_company_idx
  on public.tax_rule_sets (company_id, valid_from desc);

alter table public.tax_rule_sets enable row level security;

drop policy if exists "tax_rule_sets_read" on public.tax_rule_sets;
create policy "tax_rule_sets_read" on public.tax_rule_sets
  for select to authenticated
  using (company_id is null or company_id = public.current_company_id());

drop policy if exists "tax_rule_sets_write" on public.tax_rule_sets;
create policy "tax_rule_sets_write" on public.tax_rule_sets
  for all to authenticated
  using (company_id = public.current_company_id())
  with check (company_id = public.current_company_id());

-- Regra tributária.
--
-- match  — em que operação a regra pega (ncm, cest, cfop, uf, regime, modelo,
--          produto ou serviço específico). Campo ausente = não restringe.
-- taxes  — o que aplicar, no vocabulário do leiaute oficial:
--          {"icms":{"cst":"00","csosn":"102","aliquota":18},
--           "pis":{"cst":"01","aliquota":1.65},
--           "cofins":{"cst":"01","aliquota":7.6},
--           "ibs":{"cst":"000","cClassTrib":"000001","pIBSUF":0,"pIBSMun":0,"pRedAliq":0},
--           "cbs":{"cst":"000","cClassTrib":"000001","pCBS":0,"pRedAliq":0},
--           "iss":{"aliquota":0,"retido":false}}
-- Nada disso tem default no código: item sem regra vigente vira erro de
-- validação fiscal, não uma alíquota chutada.
create table if not exists public.tax_rules (
  id uuid primary key default gen_random_uuid(),
  rule_set_id uuid not null references public.tax_rule_sets(id) on delete cascade,
  company_id uuid references public.companies(id) on delete cascade,
  description text,
  priority integer not null default 100,
  match jsonb not null default '{}'::jsonb,
  taxes jsonb not null default '{}'::jsonb,
  valid_from date not null,
  valid_to date,
  active boolean not null default true,
  source text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists tax_rules_set_idx on public.tax_rules (rule_set_id, priority);
create index if not exists tax_rules_company_idx on public.tax_rules (company_id, valid_from desc);

alter table public.tax_rules enable row level security;

drop policy if exists "tax_rules_read" on public.tax_rules;
create policy "tax_rules_read" on public.tax_rules
  for select to authenticated
  using (company_id is null or company_id = public.current_company_id());

drop policy if exists "tax_rules_write" on public.tax_rules;
create policy "tax_rules_write" on public.tax_rules
  for all to authenticated
  using (company_id = public.current_company_id())
  with check (company_id = public.current_company_id());
