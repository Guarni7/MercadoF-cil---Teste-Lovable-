/**
 * Reaplica `change_amount` (troco) e `user_role` nos logs de atividade migrados.
 *
 * Na primeira importação a tabela não tinha essas colunas, então o troco do
 * Base44 (`changeAmount`) foi gravado em `discrepancy` — campo que na tela
 * significa divergência de fechamento de caixa. Agora que as colunas existem
 * (migração 011), este script corrige as linhas já migradas a partir do dump.
 *
 * Uso: node scripts/migrate/fix-activity-log-fields.mjs [--apply]
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const APPLY = process.argv.includes("--apply");

function loadEnvLocal() {
  const raw = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
  const env = {};
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) env[m[1].trim()] = m[2].trim().replace(/^"|"$/g, "");
  }
  return env;
}

const env = loadEnvLocal();
const admin = createClient(
  env.VITE_SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const dump = JSON.parse(
  readFileSync(resolve(process.cwd(), "migration-dump/ActivityLog.json"), "utf8"),
);
const rows = Array.isArray(dump) ? dump : dump.records || [];
const idMap = JSON.parse(
  readFileSync(resolve(process.cwd(), "migration-dump/id_map.json"), "utf8"),
);
// id_map.json é plano: "Entity:idAntigo" -> uuid novo.
const logMap = Object.fromEntries(
  Object.entries(idMap)
    .filter(([k]) => k.startsWith("ActivityLog:"))
    .map(([k, v]) => [k.slice("ActivityLog:".length), v]),
);

let fixed = 0;
let skipped = 0;
for (const r of rows) {
  const change = Number(r.changeAmount ?? r.change_amount ?? 0);
  const target = logMap[r.id];
  if (!target) {
    skipped += 1;
    continue;
  }
  const patch = { change_amount: change };
  // O troco nunca foi divergência de caixa: zera o campo onde ele foi parar.
  if (change > 0) patch.discrepancy = Number(r.discrepancy ?? 0);
  if (APPLY) {
    const { error } = await admin
      .from("activity_logs")
      .update(patch)
      .eq("id", target);
    if (error) {
      console.error("falhou", target, error.message);
      continue;
    }
  }
  fixed += 1;
}

console.log(
  JSON.stringify(
    { apply: APPLY, dump_rows: rows.length, fixed, skipped },
    null,
    2,
  ),
);
