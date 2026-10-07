-- Pagamentos do ConnectTEF (Smart POS) em homologação/produção: solicitação e resultado.
--
-- Fluxo: a Edge Function connecttef-request-payment grava a operação como
-- 'pendente' ANTES de chamar o ConnectTEF. O 202 do ConnectTEF só significa "em
-- processamento" (vira 'processando'); o resultado definitivo chega pelo webhook
-- (`pagamento.aprovado` / `pagamento.recusado`) e é aplicado por
-- process_connecttef_event, uma vez só, sob trava de linha.
--
-- Esta etapa NÃO finaliza venda nenhuma: a transição para 'aprovado' acontece
-- exatamente uma vez (finalized_at / final_event_id) e é o gancho para a venda
-- usar depois.
--
-- Estados:
--   pendente      gravado, ainda sem resposta do ConnectTEF
--   processando   ConnectTEF aceitou (HTTP 202); aguarda o webhook
--   indeterminado a chamada deu timeout/5xx — o ConnectTEF pode ter recebido; o
--                 webhook ainda pode resolver
--   falhou        o ConnectTEF recusou o pedido (400/401/403/404/409): nada foi
--                 enviado ao aparelho
--   aprovado | recusado   resultado definitivo (terminais; nunca mudam)
--
-- Leitura: usuário da empresa (RLS por company_id). Escrita: só service role.
-- Dados de autorização (código, NSU, dadosFinalizacao — necessários para estorno)
-- ficam em outra tabela, sem nenhum acesso do cliente.

create table if not exists public.connecttef_payments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  -- Enviada ao ConnectTEF; volta nos eventos de webhook. Uma por operação.
  referencia uuid not null,
  smartpos_id text not null,
  documento_cliente text not null,
  valor_centavos integer not null check (valor_centavos > 0),
  forma_pagamento text not null check (forma_pagamento in ('credito', 'debito', 'pix', 'voucher')),
  parcelas integer not null default 1 check (parcelas between 1 and 24),
  parcelamento text check (parcelamento in ('estabelecimento', 'administradora')),
  status text not null default 'pendente'
    check (status in ('pendente', 'processando', 'indeterminado', 'falhou', 'aprovado', 'recusado')),
  -- Chave opcional do cliente: o mesmo pedido repetido (duplo clique, retry) não
  -- cobra duas vezes no aparelho.
  idempotency_key text,
  http_status integer,
  erro text,
  bandeira text,
  motivo text,
  requested_at timestamptz,
  finalized_at timestamptz,
  final_event_id text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists connecttef_payments_referencia_idx
  on public.connecttef_payments (referencia);
create unique index if not exists connecttef_payments_idem_idx
  on public.connecttef_payments (company_id, idempotency_key) where idempotency_key is not null;
create index if not exists connecttef_payments_company_idx
  on public.connecttef_payments (company_id, created_at desc);

alter table public.connecttef_payments enable row level security;
revoke all on public.connecttef_payments from public, anon, authenticated;
grant select on public.connecttef_payments to authenticated;

drop policy if exists "connecttef_payments_tenant_select" on public.connecttef_payments;
create policy "connecttef_payments_tenant_select" on public.connecttef_payments
  for select to authenticated
  using (company_id = public.current_company_id());

-- Dados da autorização devolvidos no pagamento.aprovado. Só servidor: o estorno
-- precisa deles e o navegador não deve ver.
create table if not exists public.connecttef_payment_authorizations (
  payment_id uuid primary key references public.connecttef_payments(id) on delete cascade,
  codigo_autorizacao text,
  numero_transacao text,
  dados_finalizacao text,
  resultado_smartpos jsonb,
  created_at timestamptz not null default now()
);

alter table public.connecttef_payment_authorizations enable row level security;
revoke all on public.connecttef_payment_authorizations from public, anon, authenticated;

-- Processa um evento já registrado em connecttef_events.
--   smartpos.identificado                    -> vincula o Smart POS (migration 073)
--   pagamento.aprovado | pagamento.recusado  -> aplica o resultado à operação
--   (também aceita pagamento.rejeitado como sinônimo de recusado)
-- Qualquer outro tipo é ignorado e fica sem processar.
--
-- Idempotente em duas camadas: o evento (processed_at, linha travada) e a
-- operação (linha travada; resultado terminal nunca muda). Dois eventos
-- diferentes para a mesma operação, ou o mesmo evento entregue em paralelo,
-- aprovam UMA vez: só uma chamada devolve 'approved'.
--
-- Resultados: linked | approved | declined | already_final | conflict | invalid |
--             already_processed | ignored | not_found.
-- Evento inválido ou conflitante fica marcado como processado COM `error` e não
-- altera nada.
create or replace function public.process_connecttef_event(p_event_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  e public.connecttef_events%rowtype;
  p public.connecttef_smartpos%rowtype;
  pay public.connecttef_payments%rowtype;
  v_smartpos text;
  v_documento text;
  v_erro text;
  v_alvo text;
  v_valor_txt text;
  v_smartpos_ev text;
begin
  select * into e from public.connecttef_events where event_id = p_event_id for update;
  if not found then
    return jsonb_build_object('result', 'not_found');
  end if;
  if e.processed_at is not null then
    return jsonb_build_object('result', 'already_processed');
  end if;

  -- ===== Pagamento =====
  if e.event_type in ('pagamento.aprovado', 'pagamento.recusado', 'pagamento.rejeitado') then
    v_alvo := case when e.event_type = 'pagamento.aprovado' then 'aprovado' else 'recusado' end;
    v_valor_txt := coalesce(e.payload -> 'dados' ->> 'valorCentavos', e.payload ->> 'valorCentavos');
    v_smartpos_ev := nullif(btrim(coalesce(e.payload -> 'dados' ->> 'smartposId', e.payload ->> 'smartposId')), '');

    if e.referencia is null or e.referencia !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      v_erro := 'referencia ausente ou não é um UUID';
    else
      select * into pay from public.connecttef_payments where referencia = e.referencia::uuid for update;
      if not found then
        v_erro := 'referencia desconhecida';
      elsif v_valor_txt is not null and v_valor_txt !~ '^[0-9]+$' then
        v_erro := 'valorCentavos em formato inválido';
      elsif v_valor_txt is not null and v_valor_txt::bigint <> pay.valor_centavos then
        v_erro := 'valorCentavos do evento diverge da operação';
      elsif v_smartpos_ev is not null and v_smartpos_ev <> pay.smartpos_id then
        v_erro := 'smartposId do evento diverge da operação';
      elsif pay.status = 'falhou' then
        v_erro := 'a operação falhou na solicitação ao ConnectTEF';
      elsif pay.status in ('aprovado', 'recusado') then
        if pay.status = v_alvo then
          update public.connecttef_events set processed_at = now(), error = null where id = e.id;
          return jsonb_build_object('result', 'already_final', 'payment_id', pay.id, 'status', pay.status);
        end if;
        v_erro := 'resultado conflitante: a operação já está ' || pay.status;
        update public.connecttef_events set processed_at = now(), error = v_erro where id = e.id;
        return jsonb_build_object('result', 'conflict', 'payment_id', pay.id, 'error', v_erro);
      end if;
    end if;

    if v_erro is not null then
      update public.connecttef_events set processed_at = now(), error = v_erro where id = e.id;
      return jsonb_build_object('result', 'invalid', 'error', v_erro);
    end if;

    -- pendente / processando / indeterminado -> resultado definitivo (uma vez).
    update public.connecttef_payments
       set status = v_alvo,
           finalized_at = now(),
           final_event_id = e.event_id,
           bandeira = nullif(btrim(coalesce(e.payload -> 'dados' ->> 'bandeiraCartao', '')), ''),
           motivo = case when v_alvo = 'recusado'
                         then left(nullif(btrim(coalesce(e.payload -> 'dados' ->> 'mensagem',
                                                          e.payload -> 'dados' ->> 'motivo', '')), ''), 300)
                    end,
           updated_at = now()
     where id = pay.id;

    if v_alvo = 'aprovado' then
      insert into public.connecttef_payment_authorizations
        (payment_id, codigo_autorizacao, numero_transacao, dados_finalizacao, resultado_smartpos)
      values (
        pay.id,
        e.payload -> 'dados' -> 'autorizacao' ->> 'codigo',
        e.payload -> 'dados' -> 'autorizacao' ->> 'numeroTransacao',
        e.payload -> 'dados' -> 'autorizacao' ->> 'dadosFinalizacao',
        e.payload -> 'dados' -> 'resultadoSmartPOS'
      )
      on conflict (payment_id) do nothing;
    end if;

    update public.connecttef_events set processed_at = now(), error = null where id = e.id;
    return jsonb_build_object(
      'result', case when v_alvo = 'aprovado' then 'approved' else 'declined' end,
      'payment_id', pay.id, 'company_id', pay.company_id);
  end if;

  -- ===== Smart POS (migration 073, sem alteração) =====
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
