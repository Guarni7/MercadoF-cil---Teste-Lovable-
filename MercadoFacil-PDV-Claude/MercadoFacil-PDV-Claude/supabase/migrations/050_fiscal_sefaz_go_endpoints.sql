-- Endereços oficiais da SEFAZ-GO para homologação e produção.
--
-- Goiás mantém webservice próprio (não usa SVRS como outros estados). URLs
-- confirmadas em 2026-09-21 por fonte oficial (goias.gov.br/economia —
-- "Endereços da versão 4.0 em homologação") e cruzadas com a relação de
-- endpoints do projeto nfephp-org/sped-nfe (wsnfe_4.00_mod55.xml e
-- wsnfe_4.00_mod65.xml), que usam o mesmo endereço para NF-e e NFC-e.
--
-- QR Code (service "qrcode"): URL de consulta pública da NFC-e mudou em
-- 16/06/2025 (Informe Técnico SEFAZ-GO 2025.003) — a antiga (http://,
-- domínio homolog./nfe.) expirou em 30/06/2025 (homologação) e 30/08/2025
-- (produção); só a nova (https://, domínio nfewebhomolog./nfeweb.) vale.
insert into public.fiscal_sefaz_endpoints (uf, environment, model, service, url, source)
values
  ('GO', 'homologacao', '55', 'autorizacao',    'https://homolog.sefaz.go.gov.br/nfe/services/NFeAutorizacao4', 'goias.gov.br/economia — Endereços da versão 4.0 em homologação'),
  ('GO', 'homologacao', '55', 'retautorizacao', 'https://homolog.sefaz.go.gov.br/nfe/services/NFeRetAutorizacao4', 'goias.gov.br/economia — Endereços da versão 4.0 em homologação'),
  ('GO', 'homologacao', '55', 'status',         'https://homolog.sefaz.go.gov.br/nfe/services/NFeStatusServico4', 'goias.gov.br/economia — Endereços da versão 4.0 em homologação'),
  ('GO', 'homologacao', '55', 'consulta',       'https://homolog.sefaz.go.gov.br/nfe/services/NFeConsultaProtocolo4', 'goias.gov.br/economia — Endereços da versão 4.0 em homologação'),
  ('GO', 'homologacao', '55', 'inutilizacao',   'https://homolog.sefaz.go.gov.br/nfe/services/NFeInutilizacao4', 'goias.gov.br/economia — Endereços da versão 4.0 em homologação'),

  ('GO', 'producao', '55', 'autorizacao',    'https://nfe.sefaz.go.gov.br/nfe/services/NFeAutorizacao4', 'nfephp-org/sped-nfe — wsnfe_4.00_mod55.xml'),
  ('GO', 'producao', '55', 'retautorizacao', 'https://nfe.sefaz.go.gov.br/nfe/services/NFeRetAutorizacao4', 'nfephp-org/sped-nfe — wsnfe_4.00_mod55.xml'),
  ('GO', 'producao', '55', 'status',         'https://nfe.sefaz.go.gov.br/nfe/services/NFeStatusServico4', 'nfephp-org/sped-nfe — wsnfe_4.00_mod55.xml'),
  ('GO', 'producao', '55', 'consulta',       'https://nfe.sefaz.go.gov.br/nfe/services/NFeConsultaProtocolo4', 'nfephp-org/sped-nfe — wsnfe_4.00_mod55.xml'),
  ('GO', 'producao', '55', 'inutilizacao',   'https://nfe.sefaz.go.gov.br/nfe/services/NFeInutilizacao4', 'nfephp-org/sped-nfe — wsnfe_4.00_mod55.xml'),

  -- NFC-e (65) usa o mesmo webservice de autorização que NF-e (55) em GO.
  ('GO', 'homologacao', '65', 'autorizacao',    'https://homolog.sefaz.go.gov.br/nfe/services/NFeAutorizacao4', 'goias.gov.br/economia — Endereços da versão 4.0 em homologação'),
  ('GO', 'homologacao', '65', 'retautorizacao', 'https://homolog.sefaz.go.gov.br/nfe/services/NFeRetAutorizacao4', 'goias.gov.br/economia — Endereços da versão 4.0 em homologação'),
  ('GO', 'homologacao', '65', 'status',         'https://homolog.sefaz.go.gov.br/nfe/services/NFeStatusServico4', 'goias.gov.br/economia — Endereços da versão 4.0 em homologação'),
  ('GO', 'homologacao', '65', 'consulta',       'https://homolog.sefaz.go.gov.br/nfe/services/NFeConsultaProtocolo4', 'goias.gov.br/economia — Endereços da versão 4.0 em homologação'),
  ('GO', 'homologacao', '65', 'inutilizacao',   'https://homolog.sefaz.go.gov.br/nfe/services/NFeInutilizacao4', 'goias.gov.br/economia — Endereços da versão 4.0 em homologação'),
  ('GO', 'homologacao', '65', 'qrcode',         'https://nfewebhomolog.sefaz.go.gov.br/nfeweb/sites/nfce/danfeNFCe', 'Informe Técnico SEFAZ-GO 2025.003 (nova URL do QR Code, vigente desde 16/06/2025)'),

  ('GO', 'producao', '65', 'autorizacao',    'https://nfe.sefaz.go.gov.br/nfe/services/NFeAutorizacao4', 'nfephp-org/sped-nfe — wsnfe_4.00_mod65.xml'),
  ('GO', 'producao', '65', 'retautorizacao', 'https://nfe.sefaz.go.gov.br/nfe/services/NFeRetAutorizacao4', 'nfephp-org/sped-nfe — wsnfe_4.00_mod65.xml'),
  ('GO', 'producao', '65', 'status',         'https://nfe.sefaz.go.gov.br/nfe/services/NFeStatusServico4', 'nfephp-org/sped-nfe — wsnfe_4.00_mod65.xml'),
  ('GO', 'producao', '65', 'consulta',       'https://nfe.sefaz.go.gov.br/nfe/services/NFeConsultaProtocolo4', 'nfephp-org/sped-nfe — wsnfe_4.00_mod65.xml'),
  ('GO', 'producao', '65', 'inutilizacao',   'https://nfe.sefaz.go.gov.br/nfe/services/NFeInutilizacao4', 'nfephp-org/sped-nfe — wsnfe_4.00_mod65.xml'),
  ('GO', 'producao', '65', 'qrcode',         'https://nfeweb.sefaz.go.gov.br/nfeweb/sites/nfce/danfeNFCe', 'Informe Técnico SEFAZ-GO 2025.003 (nova URL do QR Code, vigente desde 16/06/2025)')
on conflict (uf, environment, model, service) do update
  set url = excluded.url, source = excluded.source, updated_at = now();
