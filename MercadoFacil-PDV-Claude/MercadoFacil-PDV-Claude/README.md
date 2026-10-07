# MercadoFácil PDV

React/Vite SPA for minimercado point-of-sale, running on Supabase (Auth/Postgres/Storage/Edge Functions). Also ships as a packaged Electron desktop app with offline support (Dexie) and auto-update.

> This project originally ran on the Base44 platform. The `migration/supabase` branch replaced that backend with Supabase; `legacy/` and `scripts/migrate/` hold the historical Base44 artifacts and one-time migration tooling. There is no live Base44 dependency in the running app — see [docs/CODEBASE_MAP.md](docs/CODEBASE_MAP.md) for the full architecture.

## Prerequisites

1. Clone the repository.
2. `npm install`
3. Create `.env.local` in the project root with your Supabase project's credentials:
   ```
   VITE_SUPABASE_URL=https://<your-project-ref>.supabase.co
   VITE_SUPABASE_ANON_KEY=<your-anon-key>
   ```
   These come from your Supabase project's API settings. There is no fallback — the app refuses to start without them.

## Run Locally

```bash
npm run dev
```

Opens the Vite dev server (default `http://localhost:5173`), talking directly to your configured Supabase project.

## Build

```bash
npm run build      # production web build (dist/)
npm run lint        # ESLint
npm run typecheck   # tsc via jsconfig.json (checkJs)
npm run preview      # serve the production build locally
```

## Desktop (Electron)

```bash
npm run electron     # run the packaged SPA in Electron
npm run dist:win      # build the Windows installer
```

## Docs

- [docs/CODEBASE_MAP.md](docs/CODEBASE_MAP.md) — architecture, structure, stack.
- [AGENTS.md](AGENTS.md) — contributor/agent instructions.
