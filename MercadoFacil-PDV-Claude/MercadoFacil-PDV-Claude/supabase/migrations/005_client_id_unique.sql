-- 005: idempotência forte no sync offline (client_id único por tabela)
-- Partial unique indexes: vários NULLs permitidos; valores preenchidos são únicos.

create unique index if not exists sales_client_id_uidx
  on public.sales (client_id)
  where client_id is not null and length(trim(client_id)) > 0;

create unique index if not exists stock_movements_client_id_uidx
  on public.stock_movements (client_id)
  where client_id is not null and length(trim(client_id)) > 0;

create unique index if not exists customers_client_id_uidx
  on public.customers (client_id)
  where client_id is not null and length(trim(client_id)) > 0;

create unique index if not exists cash_registers_client_id_uidx
  on public.cash_registers (client_id)
  where client_id is not null and length(trim(client_id)) > 0;
