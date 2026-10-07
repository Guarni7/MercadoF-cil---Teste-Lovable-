-- Instagram da loja (campo já existia na tela de Configurações).
-- Sem a coluna, o que o lojista digitava era descartado no salvar.
alter table public.companies
  add column if not exists instagram text;
