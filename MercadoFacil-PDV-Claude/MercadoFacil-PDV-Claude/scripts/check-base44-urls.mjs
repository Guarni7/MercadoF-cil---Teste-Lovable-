/**
 * Verifica se algum dado migrado ainda aponta para URLs do Base44 (imagens,
 * logos, anexos). Precisa dar zero para a remoção da Fase G ser segura.
 *
 * Uso: node scripts/check-base44-urls.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { resolve } from "path";

const raw = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
const env = {};
for (const line of raw.split(/\r?\n/)) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m) env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, "");
}

const admin = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const targets = [
  ["products", ["image_url"]],
  ["companies", ["logo_url"]],
  ["profiles", ["avatar_url"]],
  ["customers", ["photo_url"]],
];

const hits = [];
const checked = [];
for (const [table, columns] of targets) {
  for (const column of columns) {
    const { data, error } = await admin
      .from(table)
      .select(`id, ${column}`)
      .ilike(column, "%base44%");
    if (error) {
      // Coluna inexistente no schema não é problema: só não há o que apontar.
      if (!/column|does not exist|find the/i.test(error.message)) {
        console.error(JSON.stringify({ ok: false, table, column, error: error.message }));
        process.exit(1);
      }
      continue;
    }
    checked.push(`${table}.${column}`);
    if (data?.length) hits.push({ table, column, rows: data.length, sample: data[0] });
  }
}

// Configurações/logos costumam morar em colunas JSON: varre a linha inteira.
const jsonScan = ["companies", "profiles"];
for (const table of jsonScan) {
  const { data, error } = await admin.from(table).select("*").limit(1000);
  if (error) continue;
  checked.push(`${table}.* (json)`);
  const dirty = (data || []).filter((row) => JSON.stringify(row).toLowerCase().includes("base44"));
  if (dirty.length) hits.push({ table, column: "*", rows: dirty.length, sample: dirty[0].id });
}

console.log(JSON.stringify({ ok: hits.length === 0, checked, hits }, null, 2));
process.exit(hits.length === 0 ? 0 : 1);
