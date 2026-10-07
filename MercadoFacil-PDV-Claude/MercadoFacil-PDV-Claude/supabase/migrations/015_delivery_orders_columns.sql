-- Campos do pedido de delivery que existiam no Base44 e que a tela envia.
-- A tabela só tinha cliente/itens/total/endereço em uma linha, então nenhum
-- pedido conseguia ser salvo (o insert era recusado pelo PostgREST).
alter table public.delivery_orders
  add column if not exists number integer,
  add column if not exists customer_phone text,
  add column if not exists subtotal numeric default 0,
  add column if not exists delivery_fee numeric default 0,
  add column if not exists discount numeric default 0,
  add column if not exists payment_method text,
  add column if not exists delivery_person text,
  add column if not exists cep text,
  add column if not exists address_number text,
  add column if not exists complement text,
  add column if not exists neighborhood text,
  add column if not exists city text,
  add column if not exists state text,
  add column if not exists scheduled_for timestamptz;
