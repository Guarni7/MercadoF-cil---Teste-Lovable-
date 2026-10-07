-- Vendedor da venda. No Base44 vinha de graça em created_by_id/created_by_name;
-- sem as colunas o Gerenciador mostrava "—" em toda venda e o relatório de
-- comissão jogava todo mundo em "Vendedor unknown".
alter table public.sales
  add column if not exists created_by_id text,
  add column if not exists created_by_name text;
