# Checkpoint técnico — Rodada 3 — 18/09/2026 (UTC-3)

Terceira rodada: finalização técnica da migração — zerar o typecheck,
investigar a suíte de smoke, investigar CVE-2026-84375 (js-yaml), revisão
final de segurança e busca final por Base44. Nada revertido, nada apagado,
nenhum merge ou push para `main`. Branch: **`migration/supabase`**.

- **Commit de referência:** `5c41fb7` (fim da Rodada 2)
- **HEAD atual:** `69105a8`
- **Commit desta rodada:** `69105a8` — 41 arquivos, 0 migrations, 0 Edge
  Functions alteradas (rodada puramente frontend/tipos).

## TypeScript: 215 → 0

Mesma disciplina de causa-raiz da Rodada 2. Achados principais:
- Rodada 2 só cobria `React.forwardRef` em `src/components/ui/`; o padrão
  shadcn também usa componentes de função simples (Header/Footer/Shortcut)
  para partes sem ref — mesmo problema, mesmo fix, arquivos diferentes
  (badge.jsx, dialog.jsx, sheet.jsx, dropdown-menu.jsx, currency-input.jsx).
- `src/vite-env.d.ts` não existia — `import.meta.env` estava completamente
  sem tipo em 6 arquivos. Adicionado + incluído no `jsconfig.json`.
- APIs de navegador não padronizadas sem tipo: `window.fbq`,
  `navigator.serial`/`usb`, `navigator.standalone`, `window.electronAPI`
  (novo `src/lib/electronWindow.js`, compartilhado).
- ~15 componentes locais (Campo, StatCard, InfoRow, AuthLayout...) com o
  mesmo problema de prop opcional inferida como obrigatória.

4 bugs reais encontrados pelos próprios erros de tipo (não são gaps de
tipagem, são comportamento errado hoje) — ver commit `69105a8` para detalhe:
`scale.js` (chamada com argumento que a função não aceita), `PaymentDialog.jsx`
(`payment_method` vs `paymentMethod` — log de atividade perdia o método de
pagamento), `ImportCustomersDialog.jsx` (`.data.company_id` morto, mascarado
pelo auto-fill do `create()` genérico), `AniversariantesReport.jsx`
(`iconClass` vs `iconColor` — cor do ícone nunca aplicada).

Verificado: `npm run typecheck` (0 erros), `npm run lint` (limpo),
`npm run build` (sucesso), console do browser sem erro novo (só o gate
esperado de env ausente, idêntico a antes da rodada).

## smoke-all.mjs — mesmo bloqueio da Rodada 2, agora verificado a fundo

Confirmado que não há forma segura de obter `SUPABASE_SERVICE_ROLE_KEY`
nesta sessão: nenhuma ferramenta MCP disponível expõe a service role key
(o conector Supabase só expõe anon/publishable, por design), não existe
`.env.local` nem `SUPABASE_SERVICE_ROLE_KEY` em variável de ambiente em
lugar nenhum do sistema. Nenhum resultado foi fabricado.

## CVE-2026-84375 (js-yaml) — já corrigido, alerta do Dependabot desatualizado

`js-yaml@4.3.2` é a única versão presente em toda a árvore (`npm ls
js-yaml --all` confirma — nenhuma instância antiga), puxada transitivamente
por `electron-builder`, `electron-updater` e `eslint` (nenhum é dependência
direta do app). Os dois alertas abertos do Dependabot para js-yaml
(GHSA-2883-xcg3-v3hh = CVE-2026-84375, e GHSA-5p4m-2wfm-xmqj) têm
`first_patched_version` **4.3.2** — a versão já instalada — confirmado via
`gh api .../dependabot/alerts`. Não há upgrade a fazer: já estamos na versão
corrigida. O estado "open" nos dois alertas é o Dependabot ainda não ter
re-escaneado o commit mais recente, não uma vulnerabilidade real presente.
Nenhuma mudança de dependência foi feita.

## Segurança — revisão de regressão

`git diff --name-only` entre o commit de referência e o HEAD confirma **zero
arquivos** em `supabase/` ou `.github/` tocados nesta rodada — toda a
superfície de segurança (RLS, SECURITY DEFINER, rate limiting, Zod, CI,
Dependabot, headers) permanece exatamente como na Rodada 2. O único arquivo
de lógica compartilhada tocado (`src/api/supabaseData.js`) teve apenas
casts/anotações JSDoc — diff revisado linha a linha, comportamento em
runtime idêntico (comentários JSDoc são apagados na transpilação).

## Base44 — busca final

Repetida a busca completa (código + dados). Resultado idêntico à Rodada 2:
zero dependência viva. Query no banco desta vez incluiu `fiscal_documents`
(tabela nova desde a Rodada 1) — também zero.

---



- **Commit de referência (início da Rodada 1):** `6ed4285` (checkpoint before
  Security Gate remediation)
- **HEAD atual:** `e7f1447`
- **Commits da Rodada 2** (`119a2a7..e7f1447`, 8 commits):
  1. `bc7ec0d` — rate limiting + validação zod em 8 Edge Functions
     (activate-company, assign-role, invite-user, list-companies,
     fiscal-diagnostics, save-fiscal-settings, check-pix-payment, fiscal-document)
  2. `6eaf043` — troca de `xlsx` (HIGH: prototype pollution + ReDoS, sem fix
     upstream) por `exceljs`; corrigido de brinde um bug real de roteamento
     (`.xlsx` caindo no parser de XML por causa da substring "xml" no
     content-type OOXML)
  3. `1ae5396` — script local de verificação de headers de segurança
     (`scripts/serve-with-vercel-headers.mjs`) — sem preview Vercel linkado
     nesta sessão
  4. `06ff2b0` — validação zod em `fiscal-emit` (achado durante a auditoria
     SECURITY DEFINER; não estava no lote original de 8)
  5. `c9d37db` — causa raiz de ~1281 dos 1701 erros de typecheck: JSDoc nos
     42 componentes `forwardRef` de `src/components/ui/`
  6. `a8cd08c` — mais dois root causes de typecheck: tabelas do Dexie e
     `useState({})` em 14 arquivos (420 → 215 erros)
  7. `887017e` — `npm audit --audit-level=high` deixou de ser
     `continue-on-error` (0 high/critical agora); `.github/dependabot.yml`
     criado (alerts já estavam ativos, version-updates não)
  8. `e7f1447` — README.md reescrito (não é mais o guia do Base44 CLI),
     `BASE44_API_KEY` removido da lista de bloqueios atuais em AGENTS.md
     (migração de dados já concluída)

- **Arquivos alterados na rodada:** 76 (9 Edge Functions, 42 componentes
  `ui/`, 14 arquivos com `useState({})`, `src/lib/localdb.js`,
  `src/lib/exportTable.js`, `src/lib/extractUploadedFile.js`, CI, Dependabot,
  README, AGENTS.md, `package.json`/`package-lock.json`, script novo de
  verificação de headers).
- **Migrations criadas nesta rodada:** nenhuma (0 arquivos em
  `supabase/migrations/` tocados — só Edge Functions e frontend).
- **Edge Functions alteradas e deployadas (ACTIVE):** `activate-company`,
  `assign-role`, `invite-user`, `list-companies`, `fiscal-diagnostics`,
  `save-fiscal-settings`, `check-pix-payment`, `fiscal-document`,
  `fiscal-emit`.

## Testes executados nesta rodada (reais, não simulados)

- **Rate limiting**: usuário real criado via SQL + JWT real via
  `/auth/v1/token`, rajadas paralelas de HTTP contra `fiscal-document`
  (20/60s) e `save-fiscal-settings` (10/300s) — 429 aparece exatamente no
  limiar configurado nos dois.
- **Validação zod**: payloads inválidos/maliciosos (enum errado, uuid
  inválido, email inválido, `"action":"DROP TABLE"`) rejeitados com 400 +
  detalhe de campo, em todas as 9 funções alteradas.
- **xlsx → exceljs**: 5 testes funcionais reais contra o código de produção
  (`extractDataFromUploadedFile`) — round-trip .xlsx real, .xls legado
  tratado sem crash, CSV sem regressão, roteamento por content-type OOXML,
  roteamento de XML real via content-sniff. `npm run build` verde.
- **Headers de segurança**: `dist/` real servido localmente com os headers
  exatos do `vercel.json` — CSP/HSTS/X-Frame-Options/etc. confirmados via
  `fetch().headers` real no browser, zero violação de CSP no console em `/`
  e `/login`.
- **SECURITY DEFINER (segunda auditoria)**: as 12 funções revisadas —
  `search_path` fixo em todas, zero grant para `anon`, sem SQL dinâmico
  injetável, todas as RPCs de service-role derivam `company_id` do profile
  do chamador (nunca aceitam do payload do cliente).
- **RLS / isolamento multi-tenant**: confirmado que as 29 tabelas públicas
  têm RLS habilitado; teste real com duas empresas + dois usuários reais —
  empresa B recebe `[]` ao consultar/buscar por id um produto da empresa A,
  empresa A vê o próprio produto normalmente.
- **CI/Dependabot**: confirmado via `gh api` que vulnerability-alerts e
  automated-security-fixes estão genuinamente ligados (não só o toggle —
  há um alerta real aberto, js-yaml transitivo do electron-builder).
- **Base44**: zero referência viva no código; confirmado também por query
  direta no banco (`products.image_url`, `companies.logo_url`, scan JSON
  completo de `companies`/`profiles`) — 0 ocorrências.

## Pendências internas (sem bloqueio externo)

- **Typecheck**: 215 erros restantes (de 1701), heterogêneos — helpers
  locais com prop opcional inferida como obrigatória, literais de estado
  inicial não-vazios faltando campos usados condicionalmente depois. Sem
  causa raiz única como os três já corrigidos; precisa de julgamento
  arquivo a arquivo.
- **`select("*")` em `src/api/supabaseData.js`**: avaliado e deliberadamente
  não alterado — os únicos segredos reais (certificado, token MP) já vivem
  em tabelas separadas fora do `TABLE_MAP` (Vault-backed), então é questão
  de bandwidth/hygiene, não de segurança; refatorar as ~20 entidades
  genéricas tem risco de regressão desproporcional ao ganho.
- **`scripts/smoke-all.mjs`** (suite completa de ~30 smokes): não executado
  nesta sessão — sem `.env.local`/`SUPABASE_SERVICE_ROLE_KEY` disponível
  neste ambiente. Cobertura equivalente feita manualmente via MCP + HTTP
  real para o que este round tocou (ver seção de testes acima); os smokes
  que não tocam código alterado nesta rodada (offline sync, PDV, etc.)
  seguem sem re-execução.
- **js-yaml (CVE-2026-84375, high)**: alerta real do Dependabot, transitivo
  de `electron-builder`/`electron-updater` (devDependency de empacotamento
  do desktop). Risco real baixo — só processa o `electron-builder.yml` do
  próprio projeto, nunca YAML de origem externa/usuário. Não corrigido
  nesta rodada; acompanhar até `electron-builder` puxar um `js-yaml`
  corrigido.

## Bloqueios externos (inalterados desde a Rodada 1)

Cloudflare Turnstile; leaked password protection no dashboard do Supabase;
GitHub Secret Scanning/GHAS (se necessário); certificado A1 real; homologação
fiscal; token real do Mercado Pago; credenciais de plataforma.

---

# Checkpoint da migração — 17/09/2026, 01:44 (UTC-3)

Estado congelado a pedido do usuário. Nada foi revertido, nada foi apagado,
nenhum merge ou push para `main`. Branch preservada: **`migration/supabase`**
(HEAD `2665bac`, em dia com `origin/migration/supabase`).

## Objetivo geral

Migrar o MercadoFácil PDV do Base44 para Supabase, com arquitetura final
GitHub → Vercel → Supabase e zero dependência funcional do Base44. Produção só
é cortada depois que todas as fases estiverem validadas.

## Fases A–I

| Fase | Escopo | Situação |
| --- | --- | --- |
| **A — PIX / Mercado Pago** | Cobrança PIX por loja, webhook, isolamento | Implementado e testado; falta apenas cobrança real com token de lojista/sandbox |
| **B — Planos / Assinaturas** | registerCompany, activateCompany, trial, papéis | Concluída (smokes verdes) |
| **C — Storage** | Bucket, upload por empresa, RLS | Concluída (smokes verdes) |
| **D — Offline / Sincronização** | Dexie, `sync_queue`, idempotência, estoque | Concluída (smokes verdes) |
| **E — Electron** | SPA empacotada, offline, auto-update por GitHub Releases | Implementada e verificada por script; falta E2E no instalador novo |
| **F — Migração de dados** | Export/import Base44 → Supabase, integridade | Concluída (`verify-migrated-data` verde) |
| **G — Remoção do Base44** | SDK, URLs, entidades, dados | Concluída (`check-base44-urls` verde) |
| **H — Produção** | Build, E2E, cutover GitHub → Vercel | **Não iniciada** — depende de A (token real) e E (E2E instalado) |
| **I — Fiscal** | NFS-e Nacional, NFC-e/NF-e, certificado A1, motor tributário | Implementada; **não commitada**; bloqueio externo por certificado/homologação |

## Concluído

- Auth, perfis, empresa, trial, papéis e RLS multi-tenant.
- CRUD completo: produtos, clientes, categorias, marcas, vendas, estoque, caixa,
  financeiro, crediário, delivery, logs de atividade.
- Relatórios: filtros reais (período, busca, status), exportação CSV/XLSX/PDF,
  erros de carga visíveis em vez de relatório vazio.
- Importação de XML de compra persistida como `bills` com custo unitário e
  bloqueio de chave de acesso duplicada.
- Configuração da empresa e logo no banco (não mais `localStorage`).
- Recuperação de senha corrigida (`/reset-password` com sessão de recuperação do
  Supabase, sem o parâmetro `token` que não existia).
- **PIX por lojista**: token do Mercado Pago da própria empresa, guardado em
  `company_payment_secrets` (tabela sem policy — só `service_role` lê), nunca
  devolvido ao navegador. Cobrança de assinatura/add-on separada por
  `purpose: "platform"`.
- Removidos os caminhos falsos de pagamento: "Simular pagamento recebido" no
  upgrade de plano, aprovação automática de cartão após 2s e o QR decorativo do
  PDV quando o PIX não está configurado.
- **Módulo fiscal** (Fase I): configuração por empresa, certificado A1 validado
  no servidor, assinatura XMLDSig, numeração atômica, motor tributário
  versionado (ICMS/PIS/COFINS/ISS/IBS/CBS), tabela cClassTrib oficial (164
  códigos), cadastro fiscal de produto e serviço, transmissão mTLS para SEFAZ e
  Sefin Nacional, trilha de auditoria e tela de diagnóstico.

## Em andamento (trabalho não commitado na árvore)

Todo o módulo fiscal está na árvore de trabalho, **sem commit**:

- `supabase/migrations/030_fiscal_settings.sql` … `035_fiscal_sefaz_endpoints.sql`
- `supabase/functions/_shared/fiscal/` (certificate, documents, flow, signature,
  taxEngine, transmitters, validation)
- `supabase/functions/fiscal-emit`, `fiscal-document`, `fiscal-diagnostics`,
  `save-fiscal-settings`
- `scripts/fiscal/import-class-trib.mjs`, `scripts/fiscal/import-sefaz-endpoints.mjs`
- 7 smokes fiscais + `scripts/smoke-all.mjs` atualizado
- `src/lib/fiscalConfig.js`, `src/pages/Servicos.jsx`, `src/components/config/FiscalTab.jsx`,
  `src/components/pos/NfceDialog.jsx`, `src/components/sales/ItemFiscalDialog.jsx`,
  `src/components/products/ProductDialog.jsx`, `src/lib/safePayload.js`,
  `src/api/supabaseData.js`, `src/App.jsx`, `src/components/Layout.jsx`
- `src/lib/nfce.js` **deletado** (substituído pela emissão no servidor)
- `docs/FISCAL.md` (estado real por documento)
- Arquivos soltos de investigação, ainda não avaliados: `cookies.txt`, `ws.html`

## O que falta

1. Commitar o módulo fiscal (Fase I) — nada dele está versionado.
2. Cobrança PIX real com token (sandbox `TEST-` ou conta de lojista).
3. Gerar instalador desktop novo e rodar E2E no app instalado.
4. Validar no preview os relatórios reescritos e a importação de XML.
5. Validar páginas ainda não exercitadas: Plano, Ajuda, Compostos.
6. Ciclo fiscal ponta a ponta com certificado A1 real (homologação).
7. Fase H: build final, E2E e cutover GitHub → Vercel.

## Últimos arquivos modificados

| Hora | Arquivo |
| --- | --- |
| 01:14 | `scripts/smoke-fiscal-config.mjs` |
| 01:09 | `docs/FISCAL.md` |
| 01:08 | `scripts/smoke-all.mjs` |
| 01:07 | `scripts/smoke-fiscal-sefaz.mjs` |
| 01:05 | `supabase/functions/fiscal-diagnostics/index.ts` |
| 01:03 | `scripts/fiscal/import-sefaz-endpoints.mjs` |
| 01:02 | `supabase/functions/fiscal-emit/index.ts` |
| 01:02 | `supabase/migrations/035_fiscal_sefaz_endpoints.sql` |
| 01:02 | `supabase/functions/_shared/fiscal/transmitters.ts` |
| 00:57 | `scripts/fiscal/import-class-trib.mjs` |

## Migrations aplicadas

`001` a `035`, todas confirmadas no banco remoto (`supabase migration list`:
local e remoto idênticos, sem pendência).

Do bloco recente:

- `027_payment_settings.sql` — config de pagamento por empresa + segredos sem acesso do cliente
- `028_pix_charges.sql` — registro das cobranças PIX (é como o webhook acha a loja)
- `029_payment_webhook_flag.sql` — espelho de "chave do webhook cadastrada"
- `030`–`035` — fiscal: settings, documents, tax rules, produtos/serviços,
  documento do cliente na venda, endpoints da SEFAZ

## Edge Functions (todas ACTIVE no projeto `rrawbkhdinsvzbdsknon`)

| Função | Versão | JWT |
| --- | --- | --- |
| `generate-pix-payment` | 5 | sim |
| `check-pix-payment` | 4 | sim |
| `mercadopago-webhook` | 3 | não (público, valida assinatura) |
| `save-payment-settings` | 3 | sim |
| `register-company` | 2 | sim |
| `list-companies` | 1 | sim |
| `activate-company` | 2 | sim |
| `invite-user` | 1 | sim |
| `assign-role` | 1 | sim |
| `fiscal-emit` | 7 | sim |
| `fiscal-diagnostics` | 3 | sim |
| `fiscal-document` | 1 | sim |
| `save-fiscal-settings` | 1 | sim |

## Smoke tests — última execução completa

`node scripts/smoke-all.mjs` em 17/09/2026 01:18 (UTC-3): **31 de 31 verdes,
exit 0**, em 3m22s.

Cobertura: registerCompany, list/activate, gate de trial, sessão revogada, baixa
de estoque transacional, numeração de vendas, invite-user, assign-role,
idempotência offline, catálogo, venda ponta a ponta, RLS de
clientes/delivery/nfce, storage (extract e upload com sessão), visibilidade de
equipe, cadastro da empresa ida e volta, compra por XML, PIX por loja, webhook,
7 smokes fiscais, desktop offline sem Base44, schema × UI, integridade dos dados
migrados e ausência de URLs Base44.

Ressalva: `smoke-pix-edge.mjs` passa **pulando** a cobrança real — sem
`MERCADO_PAGO_TEST_TOKEN` ele não chega a criar pagamento no Mercado Pago.

## Pendências fiscais

Detalhe completo em `docs/FISCAL.md`. Resumo:

- **Depende do lojista**: certificado A1 (.pfx) e senha, inscrição municipal
  (NFS-e) e estadual (NFC-e/NF-e), credenciamento na SEFAZ da UF.
- **Depende de homologação**: NFS-e Nacional em produção restrita e NFC-e/NF-e
  em homologação da SEFAZ, com a relação oficial de webservices carregada.
- **Não integrado**: cancelamento/inutilização na SEFAZ (`RecepcaoEvento4`,
  `NfeInutilizacao4`), contingência (FS-DA/EPEC), DANFE/DANFSE oficiais,
  download automático de NF-e de fornecedor.
- **Aguardando legislação**: alíquotas de IBS/CBS para Simples e MEI (art. 348
  da LC 214/25 adia para 2027) — estrutura pronta, alíquota entra como dado.

## Pendências Electron

- `verify-electron.mjs` verde: SPA empacotada carrega offline e não há Base44.
- Instalador atual é o **1.3.2**; as correções de relatórios, XML, pagamento e o
  módulo fiscal ainda **não** foram empacotadas.
- Falta: gerar release nova (`node scripts/release-desktop.mjs`, publicação em
  GitHub Releases) e rodar E2E no app instalado — login, venda, modo offline,
  atualização preservando o banco local.

## Pendências PIX

- Fluxo por loja implementado e isolado por tenant; falta **uma cobrança real**
  com token `TEST-` (sandbox) ou de conta de lojista para fechar a Fase A.
- Confirmação automática depende de o lojista cadastrar a URL do webhook e a
  chave secreta no painel do Mercado Pago (campo já existe em Configurações →
  Pagamento).
- Cobrança de assinatura/add-on usa a conta **da plataforma**
  (`MERCADO_PAGO_ACCESS_TOKEN` + `MERCADO_PAGO_WEBHOOK_SECRET` nos Secrets do
  Supabase) — esses secrets ainda não foram definidos, então upgrade de plano e
  add-on respondem "indisponível" em vez de liberar sem pagar.
- Pagamento de plano por cartão foi desativado na interface: não existia
  cobrança real por trás.

## Pendências de produção (Fase H)

- Build de produção e E2E completo ainda não executados nesta rodada.
- Cutover GitHub `main` → Vercel → Supabase **não** realizado, conforme a regra
  de não promover antes da validação.
- Secrets de produção da plataforma pendentes (Mercado Pago).
- Preview da Vercel continua sendo o único ambiente publicado.

## Ponto exato onde o trabalho parou

Última ação concluída: rodada completa de `scripts/smoke-all.mjs` às **01:18**,
verde nos 31 testes, logo após ajustar `scripts/smoke-fiscal-config.mjs`
(01:14) e revisar `docs/FISCAL.md` (01:09).

O trabalho foi interrompido **com o módulo fiscal inteiro na árvore de trabalho
e sem commit** — 6 migrations já aplicadas no banco remoto, 4 Edge Functions já
deployadas e ativas, mas nenhum desses arquivos versionado em git. O banco e o
ambiente estão à frente do repositório.

## Próxima tarefa ao retomar

Commitar a Fase I na `migration/supabase`: revisar o diff completo do módulo
fiscal, decidir o destino de `cookies.txt` e `ws.html` (arquivos de investigação,
provavelmente descartáveis e fora do commit), e registrar um commit único do
módulo fiscal. Só depois disso seguir para a cobrança PIX real e o instalador
desktop novo com E2E.
