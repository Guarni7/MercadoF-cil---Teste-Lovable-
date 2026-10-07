-- Total de sangrias do caixa.
-- Antes a sangria era descontada de `sales_total`, o que falsificava o total
-- vendido e — quando ainda não havia vendas — descartava a retirada inteira
-- (Math.max(0, 0 - valor)), fazendo o caixa fechar com dinheiro a menos sem
-- explicação.
alter table public.cash_registers
  add column if not exists withdrawals_total numeric default 0;
