# AGENTS.md

## Project Context

MercadoFácil PDV — app de PDV para minimercados. Branch ativa de migração: `migration/supabase` (Supabase + Vercel preview). Produção em `main` ainda não cortada.

Start with `README.md` for local setup. Architecture: [docs/CODEBASE_MAP.md](docs/CODEBASE_MAP.md).

## Codebase Overview

**Stack**: React/Vite SPA, Dexie offline sync, **Supabase** (Auth/Postgres/Storage/Edge Functions) nesta branch, Electron (SPA empacotada + auto-update), Vercel preview.

**Structure**: `src/` frontend (`src/api/dataClient.js` + `supabaseData.js`); `supabase/migrations` + `supabase/functions`; legado Base44 em `legacy/`.

## Key Files

- `src/api/dataClient.js` — cliente `api.*` (Supabase)
- `src/api/supabaseData.js` — CRUD/auth/Edge invoke
- `supabase/migrations/` — schema + RLS
- `.env.local` — `VITE_SUPABASE_*` + `SUPABASE_SERVICE_ROLE_KEY` (nunca commit)
- `scripts/smoke-all.mjs` — suíte de smoke da migração
- `docs/FISCAL.md` — estado real do módulo fiscal por documento (o que funciona, o que depende de certificado/homologação)
- `scripts/fiscal/` — importadores das tabelas oficiais (cClassTrib, webservices da SEFAZ)
- `scripts/migrate/` — export/import Base44→Supabase (Fase F)

## Working Notes

- Dev local: `npm run dev` com `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`.
- Smokes: `node scripts/smoke-all.mjs` (requer service role).
- Preview Vercel: não usar `vercel deploy --prod` até A+F validados.
- Desktop: `node scripts/release-desktop.mjs` gera `.exe` + feed em `public/downloads/`; `MF_URL` só para testes.
- PIX de venda usa o Access Token da própria loja (Configurações → Pagamento), guardado em `company_payment_secrets`. `MERCADO_PAGO_ACCESS_TOKEN` só cobre assinatura/add-on da plataforma.
- Fiscal: emissão roda no servidor (`fiscal-emit`), nada de autorização simulada. Endereço de autorizador e tabela cClassTrib são dados carregados, nunca constantes no código.
- Bloqueios atuais: token de sandbox para o smoke real do PIX (`MERCADO_PAGO_TEST_TOKEN`) e certificado A1 real para o ciclo fiscal ponta a ponta. (`BASE44_API_KEY` cobria o export de dados da migração — concluída, ver `docs/MIGRATION_CHECKPOINT.md` fases F/G; não é mais bloqueio.)
