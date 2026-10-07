-- Pedido de delivery feito a partir de um cliente cadastrado envia customer_id.
-- Sem a coluna, escolher o cliente na busca fazia o pedido falhar ao salvar.
alter table public.delivery_orders
  add column if not exists customer_id text;
