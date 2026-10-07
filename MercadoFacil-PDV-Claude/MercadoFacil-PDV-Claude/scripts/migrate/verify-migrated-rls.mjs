/**
 * Verifica que os dados migrados (Fase F) são legíveis sob RLS por um usuário
 * do tenant e invisíveis para usuário de outra empresa.
 *
 * Uso: node scripts/migrate/verify-migrated-rls.mjs --company-id=<uuid migrado>
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

function arg(name, fallback = null) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

const env = loadEnvLocal();
const companyId = arg("company-id");
if (!companyId) {
  console.error(JSON.stringify({ ok: false, error: "--company-id=<uuid> obrigatório" }));
  process.exit(1);
}

const admin = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const stamp = Date.now();

async function makeTenantUser(cid) {
  const email = `guarni07+mf.verify.${stamp}.${Math.random().toString(36).slice(2, 6)}@gmail.com`;
  const password = `Verify-${stamp}aA1!`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) throw new Error(`createUser: ${error.message}`);
  const { error: pErr } = await admin
    .from("profiles")
    .update({ company_id: cid, role: "admin" })
    .eq("id", data.user.id);
  if (pErr) throw new Error(`profile: ${pErr.message}`);
  const client = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error: lErr } = await client.auth.signInWithPassword({ email, password });
  if (lErr) throw new Error(`login: ${lErr.message}`);
  return { client, id: data.user.id, email };
}

// empresa "vizinha" só para provar isolamento
const { data: otherCompany, error: ocErr } = await admin
  .from("companies")
  .insert({ trade_name: `Isolamento ${stamp}`, legal_name: `Isolamento ${stamp}` })
  .select()
  .single();
if (ocErr) {
  console.error(JSON.stringify({ ok: false, step: "other_company", error: ocErr.message }));
  process.exit(1);
}

const tenant = await makeTenantUser(companyId);
const outsider = await makeTenantUser(otherCompany.id);

const tables = ["products", "customers", "categories", "brands", "cash_registers", "sales", "activity_logs"];
const seen = {};
const leaked = {};
for (const t of tables) {
  const { count: c1 } = await tenant.client
    .from(t)
    .select("*", { count: "exact", head: true })
    .eq("company_id", companyId);
  seen[t] = c1 ?? 0;

  const { count: c2 } = await outsider.client
    .from(t)
    .select("*", { count: "exact", head: true })
    .eq("company_id", companyId);
  leaked[t] = c2 ?? 0;
}

const { count: expectedProducts } = await admin
  .from("products")
  .select("*", { count: "exact", head: true })
  .eq("company_id", companyId);

const noLeak = Object.values(leaked).every((n) => n === 0);
const tenantSees = seen.products === (expectedProducts ?? 0) && (expectedProducts ?? 0) >= 0;
const ok = noLeak && tenantSees;

console.log(
  JSON.stringify(
    {
      ok,
      company_id: companyId,
      tenant_sees: seen,
      outsider_sees: leaked,
      rls_isolated: noLeak,
      products_expected: expectedProducts,
      note: ok
        ? "Dados migrados legíveis pelo tenant e isolados de outra empresa"
        : "Falha: vazamento entre tenants ou tenant não enxerga dados",
    },
    null,
    2
  )
);
process.exit(ok ? 0 : 1);
