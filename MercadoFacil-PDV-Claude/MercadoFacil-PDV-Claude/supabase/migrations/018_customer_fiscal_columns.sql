-- Campos fiscais/comerciais do cliente que a lista já sabe exibir e que a
-- importação em lote por CNPJ preenche (customer_type = "PJ"). Sem a coluna,
-- a atualização em lote falhava inteira.
alter table public.customers
  add column if not exists ie_indicator text,
  add column if not exists customer_type text,
  add column if not exists final_consumer boolean default false,
  add column if not exists vale_troca numeric default 0,
  add column if not exists active boolean default true;
