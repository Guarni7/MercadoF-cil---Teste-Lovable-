-- Documentos fiscais, eventos e trilha de auditoria.
--
-- A tabela nfces existente guardava só o resultado da geração local de XML:
-- ela nasceu com status "autorizada" sem nunca ter falado com autorizador
-- nenhum. Aqui o status é o do fluxo real de emissão e só chega em
-- 'authorized' quando existe protocolo devolvido pelo autorizador oficial.
--
-- Um único fluxo serve NFC-e (modelo 65), NF-e (modelo 55) e NFS-e Nacional,
-- porque as etapas são as mesmas: validar, montar, assinar, transmitir,
-- registrar o retorno. O que muda é o adaptador de transmissão.

create table if not exists public.fiscal_documents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,

  model text not null check (model in ('55', '65', 'nfse')),
  series integer,
  number bigint,
  environment text not null check (environment in ('homologacao', 'producao')),

  -- draft        — montado, ainda não validado
  -- validating   — em validação fiscal
  -- transmitting — enviado ao autorizador, sem resposta
  -- authorized   — protocolo oficial recebido (único estado que vale como nota)
  -- rejected     — autorizador recusou, com código e motivo
  -- pending      — autorizador em processamento assíncrono
  -- cancelled    — cancelamento autorizado por evento
  -- error        — falha técnica antes de obter resposta conclusiva
  -- contingency  — emitido em contingência, pendente de transmissão
  status text not null default 'draft' check (status in (
    'draft', 'validating', 'transmitting', 'authorized',
    'rejected', 'pending', 'cancelled', 'error', 'contingency'
  )),

  -- Origem
  sale_id uuid references public.sales(id) on delete set null,
  service_order_id uuid,

  -- Destinatário / tomador
  customer_id uuid references public.customers(id) on delete set null,
  customer_name text,
  customer_document text,

  -- Conteúdo
  items jsonb not null default '[]'::jsonb,
  totals jsonb not null default '{}'::jsonb,
  payload jsonb not null default '{}'::jsonb,

  -- Identificação oficial, preenchida só com retorno do autorizador
  access_key text,
  dps_id text,
  protocol text,
  authorized_at timestamptz,
  issue_date timestamptz,

  -- Retorno oficial
  rejection_code text,
  rejection_message text,
  authorizer_response jsonb,

  -- Documentos
  xml_signed text,
  xml_authorized text,

  -- Cancelamento
  cancelled_at timestamptz,
  cancel_protocol text,
  cancel_reason text,

  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists fiscal_documents_company_idx
  on public.fiscal_documents (company_id, created_at desc);
create index if not exists fiscal_documents_sale_idx
  on public.fiscal_documents (sale_id);

-- A chave de acesso é única dentro do ambiente; homologação e produção podem
-- repetir numeração sem colidir.
create unique index if not exists fiscal_documents_access_key_idx
  on public.fiscal_documents (company_id, environment, access_key)
  where access_key is not null;

alter table public.fiscal_documents enable row level security;

drop policy if exists "fiscal_documents_tenant_select" on public.fiscal_documents;
create policy "fiscal_documents_tenant_select" on public.fiscal_documents
  for select to authenticated
  using (company_id = public.current_company_id());

-- A tela nunca grava documento fiscal direto: quem escreve é a Edge Function
-- com service role, depois de falar com o autorizador. Sem policy de insert ou
-- update o cliente não consegue inventar uma nota autorizada.
drop policy if exists "fiscal_documents_tenant_write" on public.fiscal_documents;

-- Eventos do documento (cancelamento, carta de correção, manifestação).
create table if not exists public.fiscal_document_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  document_id uuid not null references public.fiscal_documents(id) on delete cascade,
  event_type text not null,
  sequence integer not null default 1,
  status text not null default 'draft' check (status in (
    'draft', 'transmitting', 'authorized', 'rejected', 'error'
  )),
  protocol text,
  reason text,
  request_payload jsonb,
  authorizer_response jsonb,
  xml text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists fiscal_document_events_doc_idx
  on public.fiscal_document_events (document_id, created_at desc);

alter table public.fiscal_document_events enable row level security;

drop policy if exists "fiscal_events_tenant_select" on public.fiscal_document_events;
create policy "fiscal_events_tenant_select" on public.fiscal_document_events
  for select to authenticated
  using (company_id = public.current_company_id());

-- Trilha de auditoria fiscal. Append-only: sem policy de update ou delete, e a
-- escrita é do service role. Serve para reconstruir o que aconteceu com cada
-- documento, inclusive as tentativas que falharam.
create table if not exists public.fiscal_audit_log (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  document_id uuid references public.fiscal_documents(id) on delete set null,
  user_id uuid references auth.users(id) on delete set null,
  user_name text,
  operation text not null,
  model text,
  environment text,
  status_from text,
  status_to text,
  protocol text,
  rejection_code text,
  rejection_message text,
  error_message text,
  response jsonb,
  created_at timestamptz not null default now()
);

create index if not exists fiscal_audit_log_company_idx
  on public.fiscal_audit_log (company_id, created_at desc);
create index if not exists fiscal_audit_log_document_idx
  on public.fiscal_audit_log (document_id, created_at desc);

alter table public.fiscal_audit_log enable row level security;

drop policy if exists "fiscal_audit_tenant_select" on public.fiscal_audit_log;
create policy "fiscal_audit_tenant_select" on public.fiscal_audit_log
  for select to authenticated
  using (company_id = public.current_company_id());
