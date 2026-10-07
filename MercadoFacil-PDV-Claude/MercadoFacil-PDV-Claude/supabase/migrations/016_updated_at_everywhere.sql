-- `api.entities.*.update()` sempre carimba updated_at; nas tabelas que não
-- tinham a coluna qualquer edição falharia. Padroniza as três que ficaram de
-- fora do schema inicial.
alter table public.stock_movements
  add column if not exists updated_at timestamptz default now();
alter table public.activity_logs
  add column if not exists updated_at timestamptz default now();
alter table public.nfces
  add column if not exists updated_at timestamptz default now();
