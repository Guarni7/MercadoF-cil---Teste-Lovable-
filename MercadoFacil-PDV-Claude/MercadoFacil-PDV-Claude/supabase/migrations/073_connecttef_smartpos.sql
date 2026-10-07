-- Smart POS do ConnectTEF vinculado a cada empresa (ambiente de teste e produção).
--
-- Fluxo: a Edge Function connecttef-pair-smartpos grava uma linha "aguardando" com
-- uma `referencia` UUID e pede o QR Code ao ConnectTEF; ao ler o QR no Smart POS
-- (no teste, o ConnectTEF simula a leitura), o ConnectTEF manda o evento
-- `smartpos.identificado` ao webhook com o `smartposId`, e a linha vira "vinculado".
--
-- Leitura: qualquer usuário da empresa (RLS por company_id). Escrita: só service
-- role, pela Edge Function e pelas funções abaixo — nenhuma policy de escrita, e
-- o cliente não tem grant de escrita.

create table if not exists public.connecttef_smartpos (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  -- CPF/CNPJ do cliente no ConnectTEF (só dígitos).
  documento_cliente text not null,
  -- Enviada ao ConnectTEF no pedido do QR Code; volta no evento de identificação.
  referencia uuid not null,
  smartpos_id text,
  status text not null default 'aguardando' check (status in ('aguardando', 'vinculado')),
  qr_expires_at timestamptz,
  linked_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists connecttef_smartpos_referencia_idx
  on public.connecttef_smartpos (referencia);
-- Um mesmo Smart POS não aparece duas vezes na mesma empresa (reler o QR no
-- mesmo aparelho atualiza a vinculação). Empresas diferentes podem usar o mesmo
-- id (o Smart POS virtual de teste é compartilhado).
create unique index if not exists connecttef_smartpos_company_device_idx
  on public.connecttef_smartpos (company_id, smartpos_id) where smartpos_id is not null;
create index if not exists connecttef_smartpos_company_idx
  on public.connecttef_smartpos (company_id, created_at desc);

alter table public.connecttef_smartpos enable row level security;
-- ALTER DEFAULT PRIVILEGES (migration 003) concede tudo a authenticated/anon em
-- tabelas novas; revoke explícito e só o SELECT que a policy abaixo cobre.
revoke all on public.connecttef_smartpos from public, anon, authenticated;
grant select on public.connecttef_smartpos to authenticated;

drop policy if exists "connecttef_smartpos_tenant_select" on public.connecttef_smartpos;
create policy "connecttef_smartpos_tenant_select" on public.connecttef_smartpos
  for select to authenticated
  using (company_id = public.current_company_id());

-- Processa um evento já registrado em connecttef_events. Só reconhece
-- `smartpos.identificado` (vincula o Smart POS); qualquer outro tipo é ignorado e
-- fica sem processar — pagamento é etapa futura. Idempotente: evento já
-- processado não faz nada, e reprocessar o mesmo vínculo não muda o resultado.
--
-- Resultados: linked | already_processed | ignored | not_found | invalid.
-- Evento inválido (sem smartposId, referência desconhecida, documento divergente,
-- Smart POS diferente já vinculado) fica marcado como processado COM `error`, para
-- não ser reprocessado em loop, e não vincula nada.
create or replace function public.process_connecttef_event(p_event_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  e public.connecttef_events%rowtype;
  p public.connecttef_smartpos%rowtype;
  v_smartpos text;
  v_documento text;
  v_erro text;
begin
  select * into e from public.connecttef_events where event_id = p_event_id for update;
  if not found then
    return jsonb_build_object('result', 'not_found');
  end if;
  if e.processed_at is not null then
    return jsonb_build_object('result', 'already_processed');
  end if;
  if e.event_type is distinct from 'smartpos.identificado' then
    return jsonb_build_object('result', 'ignored');
  end if;

  v_smartpos := nullif(btrim(coalesce(e.payload -> 'dados' ->> 'smartposId', e.payload ->> 'smartposId')), '');
  v_documento := regexp_replace(
    coalesce(e.payload -> 'dados' ->> 'documentoCliente', e.payload ->> 'documentoCliente', ''), '\D', '', 'g');

  if v_smartpos is null or v_smartpos !~ '^[A-Za-z0-9._-]{1,100}$' then
    v_erro := 'smartposId ausente ou em formato inválido';
  elsif e.referencia is null or e.referencia !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    v_erro := 'referencia ausente ou não é um UUID';
  else
    select * into p from public.connecttef_smartpos where referencia = e.referencia::uuid for update;
    if not found then
      v_erro := 'referencia desconhecida';
    elsif v_documento <> '' and v_documento <> p.documento_cliente then
      v_erro := 'documentoCliente do evento diverge do pareamento';
    elsif p.smartpos_id is not null and p.smartpos_id <> v_smartpos then
      v_erro := 'pareamento já vinculado a outro Smart POS';
    end if;
  end if;

  if v_erro is not null then
    update public.connecttef_events set processed_at = now(), error = v_erro where id = e.id;
    return jsonb_build_object('result', 'invalid', 'error', v_erro);
  end if;

  -- Reler o QR no mesmo aparelho: a vinculação nova substitui a anterior da empresa.
  delete from public.connecttef_smartpos
   where company_id = p.company_id and smartpos_id = v_smartpos and id <> p.id;

  update public.connecttef_smartpos
     set smartpos_id = v_smartpos,
         status = 'vinculado',
         linked_at = coalesce(linked_at, now()),
         updated_at = now()
   where id = p.id;

  update public.connecttef_events set processed_at = now(), error = null where id = e.id;
  return jsonb_build_object('result', 'linked', 'company_id', p.company_id, 'smartpos_id', v_smartpos);
end;
$$;

revoke all on function public.process_connecttef_event(text) from public, anon, authenticated;
grant execute on function public.process_connecttef_event(text) to service_role;
