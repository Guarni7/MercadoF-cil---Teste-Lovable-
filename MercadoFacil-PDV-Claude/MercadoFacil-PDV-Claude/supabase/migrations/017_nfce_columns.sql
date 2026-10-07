-- Estrutura completa da NFC-e (mesmos campos do Base44).
-- A tabela tinha só sale_id/status/xml/key, então toda emissão era recusada:
-- o cupom fiscal nunca chegava a ser gravado.
alter table public.nfces
  add column if not exists number integer,
  add column if not exists series integer,
  add column if not exists issue_date timestamptz,
  add column if not exists sale_number bigint,
  add column if not exists customer_id text,
  add column if not exists customer_name text,
  add column if not exists customer_document text,
  add column if not exists items jsonb default '[]'::jsonb,
  add column if not exists subtotal numeric default 0,
  add column if not exists discount numeric default 0,
  add column if not exists total numeric default 0,
  add column if not exists payment_method text,
  add column if not exists cfop text,
  add column if not exists access_key text,
  add column if not exists protocol text,
  add column if not exists environment text;

-- `key` era o apelido antigo de access_key no schema inicial.
update public.nfces set access_key = key where access_key is null and key is not null;
