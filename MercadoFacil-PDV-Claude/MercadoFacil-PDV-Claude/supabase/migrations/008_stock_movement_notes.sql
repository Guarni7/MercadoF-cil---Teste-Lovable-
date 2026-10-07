-- Observações da movimentação de estoque.
-- A UI (entrada/saída manual, conversão de estoque) e o sync offline sempre
-- enviaram `notes`; sem a coluna o PostgREST rejeitava o insert e a baixa de
-- estoque offline ficava com a fila em erro.
alter table public.stock_movements
  add column if not exists notes text;
