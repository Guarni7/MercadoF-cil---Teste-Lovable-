-- Logo da empresa (menu lateral e cupom).
-- Ficava só no localStorage do navegador: trocar de terminal, limpar o cache ou
-- instalar o app no caixa novo apagava a logo sem forma de recuperá-la.
alter table public.companies
  add column if not exists logo_url text;
