-- Endereço oficial da SEFAZ-GO para o webservice de recepção de eventos
-- (NFeRecepcaoEvento4) — usado pelo cancelamento de NFC-e/NF-e (evento
-- 110111). Mesmo padrão de 050_fiscal_sefaz_go_endpoints.sql: URL vem de
-- fonte oficial, nunca escrita solta no código.
--
-- Fonte: nfephp-org/sped-nfe (wsnfe_4.00_mod55.xml e wsnfe_4.00_mod65.xml),
-- campo NFeRecepcaoEvento4 — confirmada em 2026-09-22, mesmo domínio/padrão
-- já usado pelos demais serviços de GO (nfe.sefaz.go.gov.br / homolog.).
insert into public.fiscal_sefaz_endpoints (uf, environment, model, service, url, source)
values
  ('GO', 'homologacao', '55', 'evento', 'https://homolog.sefaz.go.gov.br/nfe/services/NFeRecepcaoEvento4', 'nfephp-org/sped-nfe — wsnfe_4.00_mod55.xml'),
  ('GO', 'producao',    '55', 'evento', 'https://nfe.sefaz.go.gov.br/nfe/services/NFeRecepcaoEvento4', 'nfephp-org/sped-nfe — wsnfe_4.00_mod55.xml'),
  ('GO', 'homologacao', '65', 'evento', 'https://homolog.sefaz.go.gov.br/nfe/services/NFeRecepcaoEvento4', 'nfephp-org/sped-nfe — wsnfe_4.00_mod65.xml'),
  ('GO', 'producao',    '65', 'evento', 'https://nfe.sefaz.go.gov.br/nfe/services/NFeRecepcaoEvento4', 'nfephp-org/sped-nfe — wsnfe_4.00_mod65.xml')
on conflict (uf, environment, model, service) do update
  set url = excluded.url, source = excluded.source, updated_at = now();
