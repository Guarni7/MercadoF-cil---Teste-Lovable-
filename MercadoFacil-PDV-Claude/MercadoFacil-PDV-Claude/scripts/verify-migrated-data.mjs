/**
 * Confere que os dados migrados do Base44 continuam íntegros no Supabase —
 * usado depois de rodar limpezas de artefatos de teste.
 *
 * Uso: node scripts/verify-migrated-data.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

const raw = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
const env = {};
for (const line of raw.split(/\r?\n/)) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m) env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, "");
}
const admin = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

// Empresas migradas = as que aparecem no id_map do dump do Base44.
const mapPath = resolve(process.cwd(), "migration-dump", "id_map.json");
if (!existsSync(mapPath)) {
  // Sem o dump local não há o que conferir (ele não vai para o repositório).
  console.log(JSON.stringify({ ok: true, skipped: "migration-dump/id_map.json ausente" }));
  process.exit(0);
}
const idMap = JSON.parse(readFileSync(mapPath, "utf8"));
const companyIds = Object.entries(idMap)
  .filter(([k]) => k.startsWith("Company:"))
  .map(([, v]) => v);

const tables = ["products", "customers", "sales", "activity_logs", "categories", "brands"];
const perCompany = [];
for (const companyId of companyIds) {
  const { data: company } = await admin
    .from("companies")
    .select("id,trade_name,plan,plan_status,status")
    .eq("id", companyId)
    .maybeSingle();
  if (!company) {
    perCompany.push({ company_id: companyId, present: false });
    continue;
  }
  const counts = {};
  for (const table of tables) {
    const { count, error } = await admin
      .from(table)
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId);
    if (!error) counts[table] = count ?? 0;
  }
  const { count: users } = await admin
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId);
  perCompany.push({ ...company, present: true, counts, users: users ?? 0 });
}

const withData = perCompany.filter(
  (c) => c.present && Object.values(c.counts || {}).some((n) => n > 0)
);

console.log(
  JSON.stringify(
    {
      ok: perCompany.every((c) => c.present) && withData.length > 0,
      companies_migradas: perCompany.length,
      companies_com_dados: withData.length,
      detalhe: perCompany,
    },
    null,
    2
  )
);
process.exit(perCompany.every((c) => c.present) ? 0 : 1);
