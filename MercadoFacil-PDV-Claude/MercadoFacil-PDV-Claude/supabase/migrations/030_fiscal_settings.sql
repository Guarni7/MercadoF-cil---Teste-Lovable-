-- Configuração fiscal por empresa.
--
-- Até aqui o fiscal do PDV morava inteiro no localStorage (src/lib/nfce.js,
-- chave "fiscal_config"): CNPJ, IE, série, numeração e até a URL do agente
-- fiscal. Isso não sobrevive a troca de terminal, não tem company_id e não tem
-- RLS — qualquer empresa via o mesmo dado no mesmo navegador.
--
-- Três tabelas:
--   company_fiscal_settings — o que a tela pode ler (RLS por tenant);
--   company_fiscal_secrets  — certificado e credenciais (só service role);
--   fiscal_document_series  — numeração por modelo/série/ambiente.
--
-- CRT segue o leiaute oficial da NF-e/NFC-e (NT 2025.002-RTC):
--   1 = Simples Nacional
--   2 = Simples Nacional, excesso de sublimite
--   3 = Regime Normal
--   4 = MEI

create table if not exists public.company_fiscal_settings (
  company_id uuid primary key references public.companies(id) on delete cascade,

  -- Identificação do emitente
  cnpj text,
  legal_name text,
  trade_name text,
  ie text,
  ie_isento boolean not null default false,
  im text,
  uf text,
  city_name text,
  city_ibge_code text,
  cnae_main text,
  cnae_secondary text[],

  -- Regime tributário
  tax_regime text not null default 'simples'
    check (tax_regime in ('mei', 'simples', 'presumido', 'real')),
  crt text not null default '1' check (crt in ('1', '2', '3', '4')),
  taxpayer_type text not null default 'contribuinte'
    check (taxpayer_type in ('contribuinte', 'isento', 'nao_contribuinte')),

  -- MEI vende mercadoria, presta serviço ou os dois. O documento fiscal muda
  -- conforme o caso, então a tela precisa saber qual fluxo habilitar.
  mei_scope text check (mei_scope in ('mercadorias', 'servicos', 'ambos')),

  -- Ambiente de emissão. Vale para todos os documentos da empresa.
  environment text not null default 'homologacao'
    check (environment in ('homologacao', 'producao')),

  -- Documentos habilitados pelo lojista
  nfce_enabled boolean not null default false,
  nfe_enabled boolean not null default false,
  nfse_enabled boolean not null default false,

  -- NFS-e Nacional (Sefin Nacional / ADN)
  nfse_provider text not null default 'nacional',
  nfse_special_regime text,
  nfse_simples_optant boolean,
  nfse_issqn_withheld_default boolean not null default false,

  -- Espelho seguro dos segredos: a tela mostra "configurado / vence em" sem
  -- nunca receber o certificado nem a senha.
  certificate_subject text,
  certificate_valid_until timestamptz,
  certificate_updated_at timestamptz,

  -- Estabelecimento
  address text,
  address_number text,
  complement text,
  neighborhood text,
  cep text,
  phone text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.company_fiscal_settings enable row level security;

drop policy if exists "fiscal_settings_tenant_select" on public.company_fiscal_settings;
create policy "fiscal_settings_tenant_select" on public.company_fiscal_settings
  for select to authenticated
  using (company_id = public.current_company_id());

-- Gravação dos campos não sensíveis pode vir da tela; o certificado e as
-- credenciais passam obrigatoriamente pela Edge Function com service role.
drop policy if exists "fiscal_settings_tenant_write" on public.company_fiscal_settings;
create policy "fiscal_settings_tenant_write" on public.company_fiscal_settings
  for all to authenticated
  using (company_id = public.current_company_id())
  with check (company_id = public.current_company_id());

-- Certificado digital e credenciais fiscais.
--
-- RLS ligada e zero policies: nem o dono da empresa lê isto com a chave
-- anônima. Só o service role das Edge Functions, que assina o documento no
-- servidor e nunca devolve o material sensível para o navegador.
--
-- A senha do Gov.br não é armazenada em lugar nenhum: a NFS-e Nacional autentica
-- por certificado digital (mTLS / assinatura da DPS), não por login de portal.
create table if not exists public.company_fiscal_secrets (
  company_id uuid primary key references public.companies(id) on delete cascade,
  certificate_pfx text,
  certificate_password text,
  nfse_client_id text,
  nfse_client_secret text,
  updated_at timestamptz not null default now()
);

alter table public.company_fiscal_secrets enable row level security;
revoke all on public.company_fiscal_secrets from anon, authenticated;

-- Numeração fiscal por empresa, modelo, série e ambiente.
--
-- Homologação e produção têm numeração independente, senão o primeiro teste
-- queima um número da sequência oficial. O número só avança dentro de uma
-- transação, via next_fiscal_number(), para dois caixas simultâneos não
-- receberem o mesmo número.
create table if not exists public.fiscal_document_series (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  model text not null check (model in ('55', '65', 'nfse')),
  series integer not null default 1,
  environment text not null default 'homologacao'
    check (environment in ('homologacao', 'producao')),
  current_number bigint not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, model, series, environment)
);

alter table public.fiscal_document_series enable row level security;

drop policy if exists "fiscal_series_tenant_select" on public.fiscal_document_series;
create policy "fiscal_series_tenant_select" on public.fiscal_document_series
  for select to authenticated
  using (company_id = public.current_company_id());

drop policy if exists "fiscal_series_tenant_write" on public.fiscal_document_series;
create policy "fiscal_series_tenant_write" on public.fiscal_document_series
  for all to authenticated
  using (company_id = public.current_company_id())
  with check (company_id = public.current_company_id());

-- Reserva o próximo número da série de forma atômica.
create or replace function public.next_fiscal_number(
  p_company_id uuid,
  p_model text,
  p_series integer,
  p_environment text
) returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_number bigint;
begin
  insert into public.fiscal_document_series (company_id, model, series, environment, current_number)
  values (p_company_id, p_model, p_series, p_environment, 0)
  on conflict (company_id, model, series, environment) do nothing;

  update public.fiscal_document_series
     set current_number = current_number + 1,
         updated_at = now()
   where company_id = p_company_id
     and model = p_model
     and series = p_series
     and environment = p_environment
  returning current_number into v_number;

  return v_number;
end;
$$;

revoke all on function public.next_fiscal_number(uuid, text, integer, text) from public, anon, authenticated;
