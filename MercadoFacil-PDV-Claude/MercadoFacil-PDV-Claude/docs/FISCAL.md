# Módulo fiscal — o que funciona, o que depende de terceiros

Este documento diz, documento por documento, o que está implementado e testado,
o que só falta credencial do lojista, o que depende de homologação junto ao
autorizador e o que não está integrado. Ele existe porque a pergunta "o sistema
emite nota?" só tem resposta útil quando separada assim.

Regra que vale para tudo abaixo: **nenhum documento é marcado como autorizado sem
protocolo do autorizador**. Não há caminho de sucesso simulado em lugar nenhum do
fluxo — nem em desenvolvimento.

Última revisão: setembro de 2026.

## Situação por documento

| Documento | Situação | O que já funciona | O que falta |
| --- | --- | --- | --- |
| **NFS-e Nacional** | BLOQUEIO EXTERNO — implementação pronta | Montagem da DPS, assinatura XMLDSig, compactação gzip+base64, POST autenticado por mTLS no Sefin Nacional, leitura do retorno oficial, consulta por chave e cancelamento por evento | Certificado A1 da loja e homologação em produção restrita |
| **NFC-e (modelo 65)** | BLOQUEIO EXTERNO — implementação pronta | Montagem do XML 4.00 com grupo UB (IBS/CBS), chave de acesso, assinatura XMLDSig, envelope SOAP do NFeAutorizacao4, envio por mTLS, leitura de `protNFe`/`cStat` | Certificado A1, relação oficial de webservices da UF carregada e homologação na SEFAZ da UF |
| **NF-e (modelo 55)** | BLOQUEIO EXTERNO — implementação pronta | Mesmo caminho da NFC-e (mesmo serviço de autorização, mesmo layout 4.00) | Além do acima: campos de destinatário e transporte específicos de operação interestadual ainda não exercitados |
| **Cancelamento de NFS-e** | BLOQUEIO EXTERNO — implementação pronta | Evento `e101101` montado, assinado e registrado via API oficial; status só muda quando o autorizador confirma | Certificado A1 |
| **Cancelamento de NFC-e/NF-e** | NÃO INTEGRADO | — | Evento de cancelamento da SEFAZ (`RecepcaoEvento4`) ainda não implementado |
| **Inutilização de numeração** | NÃO INTEGRADO | — | Serviço `NfeInutilizacao4` ainda não implementado |
| **Contingência** | NÃO INTEGRADO | O status existe no fluxo | Regras de entrada e saída de contingência (FS-DA, EPEC) não implementadas |
| **DANFE / DANFSE** | PARCIAL | Impressão do cupom da venda | DANFE oficial a partir do XML autorizado e DANFSE do ADN não implementados |

## O que está pronto e testado sem depender de terceiros

Estes pontos são exercitados por smoke test a cada rodada de `scripts/smoke-all.mjs`:

- **Configuração fiscal por empresa** (`company_fiscal_settings`): CNPJ, razão
  social, IE, IM, UF, município e código IBGE, CNAE, regime, CRT, tipo de
  contribuinte, ambiente, documentos habilitados, escopo do MEI.
- **Isolamento multiempresa**: toda tabela fiscal tem `company_id` e RLS. Uma
  loja não lê configuração, documento, série nem certificado de outra.
- **Certificado digital A1**: recebido, aberto e validado no servidor. Senha
  errada, certificado vencido e certificado de outro CNPJ são recusados com
  mensagem específica. O `.pfx` e a senha ficam em tabela sem RLS acessível
  apenas por `service_role` — nem o dono da loja consegue lê-los de volta.
- **Assinatura XMLDSig**: `infNFe`, `infDPS` e `infPedReg` assinados com SHA-1/
  SHA-256, canonicalização C14N e certificado X.509 embutido.
- **Numeração fiscal**: reservada atomicamente por empresa, modelo, série e
  ambiente. Documento reprovado na validação não queima número.
- **Motor tributário versionado**: ICMS, PIS, COFINS, ISS, IBS e CBS calculados
  a partir de regras com vigência. Não há alíquota escrita no código. Item sem
  regra vigente é recusado em vez de receber alíquota chutada.
- **Tabela oficial cClassTrib**: 164 códigos do IT 2025.002 carregados do Portal
  DF-e do SVRS por `scripts/fiscal/import-class-trib.mjs`.
- **Cadastro fiscal de produto**: NCM, CEST, CFOP, origem, CSOSN/CST, GTIN e
  CST/cClassTrib do IBS/CBS, com formato cobrado pelo banco.
- **Cadastro de serviço**: item da LC 116, código de tributação nacional, NBS,
  município de incidência, ISS e exigibilidade, retenções federais e IBS/CBS. A
  classificação usada na emissão vem do cadastro, nunca do corpo da requisição.
- **Fluxo de emissão com estados reais**: `draft`, `validating`, `transmitting`,
  `authorized`, `rejected`, `pending`, `cancelled`, `error`, `contingency`.
- **Trilha de auditoria**: empresa, usuário, documento, operação, data/hora,
  ambiente, status anterior e novo, protocolo, retorno, rejeição e erro. Toda
  tentativa entra, inclusive as reprovadas.
- **Diagnóstico** (`Configurações → Fiscal`): mostra, com evidência, se a
  configuração está completa, se o certificado é válido, se o runtime suporta
  mTLS, se o autorizador responde, se as tabelas oficiais estão carregadas e se
  há regra tributária vigente.

## O que depende de credencial do lojista

Nada aqui é trabalho de desenvolvimento pendente — é dado que só o lojista tem:

1. **Certificado digital A1 (.pfx) e senha.** Sem ele não há assinatura nem
   conexão autenticada com autorizador nenhum. A tela já recebe e valida.
2. **Inscrição municipal** para NFS-e (exceto MEI) e **inscrição estadual** para
   NFC-e/NF-e.
3. **Credenciamento na SEFAZ da UF** para emitir NFC-e/NF-e, e adesão à NFS-e
   Nacional quando o município for conveniado.

## O que depende de homologação

1. **NFS-e Nacional**: emitir em produção restrita com certificado real e
   validar retorno, rejeições e cancelamento ponta a ponta.
2. **NFC-e/NF-e**: mesmo ciclo no ambiente de homologação da SEFAZ da UF, que
   também exige a relação oficial de webservices carregada.

## O que não está integrado

Declarado aqui para não haver promessa implícita:

- Cancelamento, carta de correção e inutilização na SEFAZ.
- Contingência (FS-DA/EPEC).
- DANFE e DANFSE oficiais a partir do XML autorizado.
- Download automático de NF-e de fornecedor pela SEFAZ. A entrada de compra é
  por importação manual do XML.
- IBS/CBS para Simples e MEI: o art. 348 da LC 214/25 adia a tributação para
  2027 e as regras virão em nota técnica futura. A estrutura está pronta e
  carregada; as alíquotas entram como dado quando forem publicadas.

## Tabelas oficiais e como carregá-las

```bash
# Classificação tributária do IBS/CBS (IT 2025.002) — busca do portal do SVRS
node scripts/fiscal/import-class-trib.mjs

# Webservices da SEFAZ por UF — a partir da relação oficial em arquivo
node scripts/fiscal/import-sefaz-endpoints.mjs --file webservices.csv
```

O importador de webservices recusa URL que não seja HTTPS em domínio do fisco.
Endereço de autorizador não é adivinhado em lugar nenhum do código: sem a linha
da UF, a emissão para e explica o motivo.

## Segurança

- Senha do Gov.br: nunca pedida nem armazenada.
- Certificado e senha: apenas em `company_fiscal_secrets`, sem RLS de leitura,
  acessível somente por `service_role` dentro das Edge Functions.
- O frontend recebe no máximo o titular e a validade do certificado.
- Nenhum segredo fiscal em `localStorage`, em código ou em variável de build.
- Produção não pode ser ativada sem certificado válido — a Edge Function recusa.

## Testes

| Smoke | Cobre |
| --- | --- |
| `smoke-fiscal-rls.mjs` | isolamento multiempresa, numeração, segredos |
| `smoke-fiscal-config.mjs` | tela de configuração, Simples, MEI, papéis, produção sem certificado |
| `smoke-fiscal-emit.mjs` | validação, tributação por regra vigente, IBS/CBS, ausência de autorização fictícia |
| `smoke-fiscal-certificado.mjs` | certificado A1 e estrutura da assinatura XMLDSig |
| `smoke-fiscal-ciclo.mjs` | consulta e cancelamento sem cancelamento fictício |
| `smoke-fiscal-cadastros.mjs` | cadastro fiscal de produto e serviço |
| `smoke-fiscal-sefaz.mjs` | endpoint oficial, transmissão e recusa sem endereço |

## Fontes oficiais consultadas

- NT 2025.002-RTC — grupo UB (IBS/CBS) na NF-e/NFC-e
- IT 2025.002 — Tabelas de Classificação do IBS e da CBS (CST e cClassTrib),
  v1.60, e as tabelas online do Portal DF-e do SVRS
- Manual de Orientação do Contribuinte (MOC) 7.0 — NF-e layout 4.00
- gov.br/nfse — Manual dos Contribuintes e documentação da API da NFS-e Nacional
- LC 214/2025, com destaque para o art. 348 (Simples e MEI a partir de 2027)
