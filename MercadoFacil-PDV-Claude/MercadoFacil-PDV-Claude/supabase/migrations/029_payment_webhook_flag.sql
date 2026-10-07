-- Espelho de "a chave do webhook está cadastrada?".
--
-- A chave em si mora em company_payment_secrets, que o navegador não lê. A tela
-- precisa apenas saber se já existe uma, para não pedir de novo a cada visita.
alter table public.company_payment_settings
  add column if not exists mp_webhook_configured boolean default false;
