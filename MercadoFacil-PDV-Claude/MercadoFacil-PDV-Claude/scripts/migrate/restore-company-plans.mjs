/**
 * Reaplica nas empresas migradas os campos de plano exatamente como vieram do
 * dump do Base44 (fidelidade da migração), desfazendo qualquer alteração feita
 * por scripts de teste.
 *
 * Uso: node scripts/migrate/restore-company-plans.mjs [--dry]
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { resolve } from "path";

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

const dry = process.argv.includes("--dry");
const env = loadEnvLocal();
const admin = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const dump = JSON.parse(readFileSync(resolve("migration-dump/all.json"), "utf8"));
// id_map usa chaves "Entidade:idBase44" → uuid do Supabase.
const idMap = JSON.parse(readFileSync(resolve("migration-dump/id_map.json"), "utf8"));
const companyMap = Object.fromEntries(
  Object.entries(idMap)
    .filter(([k]) => k.startsWith("Company:"))
    .map(([k, v]) => [k.slice("Company:".length), v])
);

const results = [];
for (const c of dump.Company || []) {
  const targetId = companyMap[c.id] || c.id;
  const desired = {
    plan: c.plan ?? null,
    plan_status: c.plan_status ?? "none",
    status: c.status ?? "active",
    trial_started_at: c.trial_started_at ?? null,
    plan_expires_at: c.plan_expires_at ?? null,
  };

  const { data: current, error: readErr } = await admin
    .from("companies")
    .select("id, trade_name, plan, plan_status, status, trial_started_at, plan_expires_at")
    .eq("id", targetId)
    .maybeSingle();
  if (readErr || !current) {
    results.push({ company: c.trade_name, id: targetId, found: false });
    continue;
  }

  const drifted = Object.keys(desired).filter(
    (k) => (current[k] ?? null) !== (desired[k] ?? null)
  );
  if (drifted.length && !dry) {
    const { error } = await admin.from("companies").update(desired).eq("id", targetId);
    if (error) {
      results.push({ company: current.trade_name, id: targetId, error: error.message });
      continue;
    }
    // Espelha no profile do tenant para o app não divergir da empresa.
    await admin
      .from("profiles")
      .update({
        plan: desired.plan,
        plan_status: desired.plan_status,
        trial_started_at: desired.trial_started_at,
        plan_expires_at: desired.plan_expires_at,
      })
      .eq("company_id", targetId);
  }

  results.push({
    company: current.trade_name,
    id: targetId,
    drifted,
    restored: drifted.length > 0 && !dry,
    source: desired,
  });
}

const ok = results.every((r) => !r.error && r.found !== false);
console.log(JSON.stringify({ ok, dry, results }, null, 2));
process.exit(ok ? 0 : 1);
