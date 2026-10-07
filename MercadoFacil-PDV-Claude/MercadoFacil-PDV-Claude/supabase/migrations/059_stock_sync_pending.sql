-- Pendência de estoque da sincronização offline.
--
-- syncUpdateStock (syncService.js) já não lança mais quando
-- apply_stock_movement (057) recusa por saldo insuficiente — evita travar a
-- fila retentando pra sempre o mesmo item. Mas isso deixava a falha visível
-- só no console: a venda offline sincroniza, aparece como concluída, e a
-- baixa de estoque que não aconteceu não fica registrada em lugar nenhum
-- consultável. stock_sync_pending é esse registro — vinculado à venda,
-- persistente, visível na tela de Sincronização, com campo para o lojista
-- marcar como resolvido depois de conferir manualmente.
--
-- Não inventa baixa nenhuma: o produto continua com o estoque real (nunca
-- negativo, garantido por 057); isto só documenta que uma venda ficou sem
-- baixa correspondente, pra reconciliação manual.
create table if not exists public.stock_sync_pending (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,

  sale_id uuid references public.sales(id) on delete set null,
  -- client_id da venda offline (sales.client_id) — guardado mesmo quando
  -- sale_id não foi resolvido ainda (corrida rara: UPDATE_STOCK processado
  -- antes de CREATE_SALE terminar de gravar), pra permitir achar a venda
  -- depois de qualquer forma.
  sale_client_id text,

  product_id uuid references public.products(id) on delete set null,
  product_name text,
  quantity numeric not null,

  -- client_id da tentativa de movimentação (mesmo que syncUpdateStock manda
  -- pro apply_stock_movement) — único por empresa, pra reprocessar o mesmo
  -- item da fila não duplicar a pendência.
  client_id text,

  reason text not null default 'insufficient_stock',
  terminal_id text,

  resolved boolean not null default false,
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id) on delete set null,
  resolution_notes text,

  created_at timestamptz not null default now()
);

create unique index if not exists stock_sync_pending_client_id_idx
  on public.stock_sync_pending (company_id, client_id)
  where client_id is not null;

create index if not exists stock_sync_pending_sale_idx
  on public.stock_sync_pending (sale_id);

create index if not exists stock_sync_pending_unresolved_idx
  on public.stock_sync_pending (company_id, resolved, created_at desc);

alter table public.stock_sync_pending enable row level security;

-- Mesmo padrão de stock_movements (stock_tenant_all, 002_tenant_rls.sql):
-- syncService.js roda no navegador do lojista, sem service role — qualquer
-- membro autenticado da empresa pode registrar e resolver a própria
-- pendência, sem gate de admin (mesmo nível de acesso que já existe pra
-- estoque hoje).
drop policy if exists "stock_sync_pending_tenant_all" on public.stock_sync_pending;
create policy "stock_sync_pending_tenant_all" on public.stock_sync_pending
  for all to authenticated
  using (company_id = public.current_company_id())
  with check (company_id = public.current_company_id());
