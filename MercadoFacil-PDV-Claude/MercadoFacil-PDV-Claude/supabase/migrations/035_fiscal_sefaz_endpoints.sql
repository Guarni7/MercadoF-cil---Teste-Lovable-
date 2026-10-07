-- Endereços dos webservices da SEFAZ por UF, ambiente e modelo.
--
-- Por que em tabela e não no código: cada UF publica o próprio endereço, o
-- endereço muda por ambiente (homologação/produção) e por modelo (NF-e 55 e
-- NFC-e 65 têm serviços distintos), estados migram para SVRS/SVAN, e a lista é
-- republicada pelo Portal Nacional da NF-e. URL escrita no código vira, no
-- melhor caso, erro de conexão e, no pior, nota enviada para o lugar errado.
--
-- Nasce vazia: quem popula é scripts/fiscal/import-sefaz-endpoints.mjs a partir
-- da relação oficial de webservices. Sem linha para a UF, a emissão para com
-- mensagem explicando — nunca com uma nota "autorizada".
--
-- Fonte: Portal Nacional da NF-e → Serviços → Webservices; MOC 7.0.
create table if not exists public.fiscal_sefaz_endpoints (
  uf text not null,
  environment text not null check (environment in ('homologacao', 'producao')),
  model text not null check (model in ('55', '65')),
  service text not null,
  url text not null,
  source text,
  updated_at timestamptz not null default now(),
  primary key (uf, environment, model, service)
);

alter table public.fiscal_sefaz_endpoints enable row level security;

-- Tabela de referência: igual para todas as empresas. Leitura liberada para
-- usuário autenticado (a tela de diagnóstico mostra se está carregada), escrita
-- apenas por service role.
drop policy if exists "fiscal_sefaz_endpoints_read" on public.fiscal_sefaz_endpoints;
create policy "fiscal_sefaz_endpoints_read" on public.fiscal_sefaz_endpoints
  for select to authenticated using (true);
