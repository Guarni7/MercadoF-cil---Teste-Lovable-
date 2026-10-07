/**
 * Exporta entidades Base44 → JSON (NÃO apaga origem).
 * Requer no .env.local:
 *   BASE44_APP_ID=
 *   BASE44_API_KEY=   (service / server key com leitura)
 *   BASE44_API_URL=   (opcional; default https://app.base44.com/api)
 *
 * Uso:
 *   node scripts/migrate/export-base44.mjs --out=./migration-dump
 *
 * Depois: node scripts/migrate/import-dump.mjs --dir=./migration-dump --company-id=<uuid>
 */
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { resolve, join } from "path";
import { readFileSync } from "fs";
import { IMPORT_ORDER, ENTITY_TABLE_MAP } from "./entityMap.mjs";

function loadEnvLocal() {
  const raw = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
  const env = {};
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    )
      v = v.slice(1, -1);
    env[m[1].trim()] = v;
  }
  return env;
}

function arg(name, fallback = null) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

const env = loadEnvLocal();
const appId = env.BASE44_APP_ID || env.VITE_BASE44_APP_ID;
const apiKey = env.BASE44_API_KEY;
const apiUrl = (env.BASE44_API_URL || "https://app.base44.com/api").replace(/\/$/, "");
const outDir = resolve(process.cwd(), arg("out", "migration-dump"));

// fallback: app id conhecido do projeto (não é secret)
let resolvedAppId = appId;
if (!resolvedAppId) {
  try {
    const meta = JSON.parse(
      readFileSync(resolve(process.cwd(), "scripts/migrate/base44-app-id.json"), "utf8")
    );
    resolvedAppId = meta.id;
  } catch {}
}

if (!resolvedAppId || !apiKey) {
  console.error(
    JSON.stringify(
      {
        ok: false,
        error: "BASE44_API_KEY ausente no .env.local (APP_ID pode usar fallback do projeto)",
        has_app_id: !!resolvedAppId,
        hint: "Cole BASE44_API_KEY=... (leitura). Origem não será apagada.",
        entities: Object.keys(ENTITY_TABLE_MAP),
      },
      null,
      2
    )
  );
  process.exit(2);
}

mkdirSync(outDir, { recursive: true });

async function listEntity(entity) {
  // Tentativa REST comum Base44: /apps/:id/entities/:Entity
  const url = `${apiUrl}/apps/${resolvedAppId}/entities/${entity}?limit=5000`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "x-api-key": apiKey,
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${entity}: HTTP ${res.status} ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.items)) return data.items;
  if (Array.isArray(data?.data)) return data.data;
  return [];
}

const report = { ok: true, out: outDir, counts: {}, errors: [] };
const all = {};

for (const entity of IMPORT_ORDER) {
  try {
    const rows = await listEntity(entity);
    all[entity] = rows;
    report.counts[entity] = rows.length;
    writeFileSync(join(outDir, `${entity}.json`), JSON.stringify(rows, null, 2), "utf8");
  } catch (e) {
    report.errors.push({ entity, error: e.message });
    report.ok = false;
  }
}

writeFileSync(join(outDir, "all.json"), JSON.stringify(all, null, 2), "utf8");
writeFileSync(join(outDir, "export-report.json"), JSON.stringify(report, null, 2), "utf8");
console.log(JSON.stringify(report, null, 2));
process.exit(report.ok ? 0 : 1);
