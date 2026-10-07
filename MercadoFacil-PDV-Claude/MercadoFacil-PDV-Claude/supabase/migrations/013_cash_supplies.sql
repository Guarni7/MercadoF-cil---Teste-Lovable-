-- Total de suprimentos (reforço de troco) do caixa.
-- Era somado em `sales_total`, inflando o faturamento do dia e o relatório de
-- vendas com dinheiro que não veio de venda nenhuma.
alter table public.cash_registers
  add column if not exists supplies_total numeric default 0;
