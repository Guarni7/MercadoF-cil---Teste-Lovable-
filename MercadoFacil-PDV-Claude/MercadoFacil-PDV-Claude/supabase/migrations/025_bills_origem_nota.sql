-- Origem e identificação da nota de compra.
-- A importação de XML vivia só no estado da tela: ao recarregar, a nota sumia,
-- o histórico de "Finalizadas" voltava vazio e o relatório de Compras exibia
-- "XML importados 0" fixo, porque não havia nada gravado para contar.
alter table public.bills
  add column if not exists source text default 'manual',
  add column if not exists document_number text,
  add column if not exists access_key text,
  add column if not exists issue_date date;

-- Reimportar o mesmo XML não pode duplicar a conta a pagar.
create unique index if not exists bills_access_key_unique
  on public.bills (company_id, access_key)
  where access_key is not null;
