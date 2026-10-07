-- Eventos recebidos do ConnectTEF (webhook).
--
-- Só registra: nada aqui processa pagamento, vincula Smart POS nem mexe em
-- venda. A tabela existe para receber e guardar cada evento com idempotência
-- pelo X-ConnectTEF-Event-Id (o ConnectTEF pode reenviar o mesmo evento, e o
-- reenvio manual pelo portal também), preparando o processamento futuro.
--
-- Não é por empresa: no recebimento ainda não se sabe de qual loja é o evento
-- (isso vem depois, pela `referencia` do pagamento). Por isso a tabela é só da
-- plataforma: RLS ligada, ZERO policies e nenhum grant para anon/authenticated
-- — nem o lojista lê. Só o service role das Edge Functions.

create table if not exists public.connecttef_events (
  id uuid primary key default gen_random_uuid(),
  -- X-ConnectTEF-Event-Id (ou o `id` do corpo): chave de idempotência.
  event_id text not null,
  event_type text,
  -- `dados.referencia` do corpo, quando vier: liga o evento ao pagamento depois.
  referencia text,
  payload jsonb not null,
  -- Quantas vezes o mesmo evento chegou (reenvios contam aqui, não viram linha).
  delivery_count integer not null default 1,
  received_at timestamptz not null default now(),
  last_received_at timestamptz not null default now(),
  -- Reservados para o processamento futuro.
  processed_at timestamptz,
  error text
);

create unique index if not exists connecttef_events_event_id_idx
  on public.connecttef_events (event_id);
create index if not exists connecttef_events_referencia_idx
  on public.connecttef_events (referencia) where referencia is not null;
create index if not exists connecttef_events_pending_idx
  on public.connecttef_events (received_at) where processed_at is null;

alter table public.connecttef_events enable row level security;
-- ALTER DEFAULT PRIVILEGES (migration 003) concede acesso a authenticated/anon em
-- tabelas novas; revoke explícito.
revoke all on public.connecttef_events from public, anon, authenticated;

-- Grava o evento de forma atômica e idempotente: primeira vez insere; repetição só
-- incrementa o contador. Devolve true quando é a primeira vez.
create or replace function public.record_connecttef_event(
  p_event_id text,
  p_event_type text,
  p_referencia text,
  p_payload jsonb
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inserted boolean;
begin
  if p_event_id is null or btrim(p_event_id) = '' then
    raise exception 'event_id obrigatório';
  end if;

  insert into public.connecttef_events (event_id, event_type, referencia, payload)
  values (p_event_id, p_event_type, p_referencia, p_payload)
  on conflict (event_id) do update
    set delivery_count = public.connecttef_events.delivery_count + 1,
        last_received_at = now()
  returning (xmax = 0) into v_inserted;

  return v_inserted;
end;
$$;

revoke all on function public.record_connecttef_event(text, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.record_connecttef_event(text, text, text, jsonb)
  to service_role;
