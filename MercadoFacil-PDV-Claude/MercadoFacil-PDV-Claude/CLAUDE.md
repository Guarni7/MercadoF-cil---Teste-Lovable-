# See AGENTS.md

Follow the instructions in `AGENTS.md`.

## Codebase Overview

MercadoFácil PDV is a React/Vite SPA for minimercado POS. Branch `migration/supabase` runs on **Supabase** (Auth/Postgres/Storage/Edge) behind `api.*` (`src/api/dataClient.js`). Production cutover (GitHub `main` → Vercel → Supabase) is pending validation — do not promote preview to production yet.

**Stack**: React 18, Vite, Dexie (offline), Supabase, Electron (SPA empacotada + auto-update), Vercel preview.

**Structure**: `src/pages` + `src/components` UI; `src/api` + `src/lib` auth/data/sync; `supabase/migrations` + `supabase/functions`; Base44 artifacts only under `legacy/` and `scripts/migrate/`.

For detailed architecture, see [docs/CODEBASE_MAP.md](docs/CODEBASE_MAP.md).

## graphify
<!-- aia-harness:graphify-root — knowledge-graph usage; merged section, do not remove -->

When graphify-out/graph.json has been generated, it holds a knowledge graph of this project — god nodes, community structure, and cross-file relationships.

Rules:

- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
- Investigating code (file search, implementations, call sites, "where is X"): alongside graphify, dispatch specialist subagents (`model: haiku`) in parallel — never one at a time, never generic-only. Cuts investigation time.

## obsidian-vault
<!-- aia-harness:obsidian-root — vault memory pillar; merged section, do not remove -->

- **obsidian-vault** (`.claude/rules/obsidian.md`) - this project's long-term memory at `vault-obsidian/`, MCP-only access via `mcp__obsidian__*` tools, never direct file access.

Before answering anything that touches a past decision, a failed approach, or a convention spanning modules, or when resuming work from an earlier session, call `mcp__obsidian__search_notes_tool` first. See `.claude/rules/obsidian.md` for the full trigger table, write-tool traps, and access rules.
