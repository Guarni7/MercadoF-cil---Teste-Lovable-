/**
 * Cria um usuário de teste E2E ligado a uma empresa existente (ex.: dados migrados).
 * Imprime credenciais para uso no navegador contra o preview Vercel.
 *
 * Uso: node scripts/make-e2e-user.mjs --company-id=<uuid>
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
const admin = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const stamp = Date.now();
const email = `guarni07+mf.e2e.${stamp}@gmail.com`;
const password = `E2e-${stamp}aA1!`;

const { data, error } = await admin.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
});
if (error) {
  console.error(JSON.stringify({ ok: false, error: error.message }));
  process.exit(1);
}

if (companyId) {
  const { error: pErr } = await admin
    .from("profiles")
    .update({ company_id: companyId, role: "admin" })
    .eq("id", data.user.id);
  if (pErr) {
    console.error(JSON.stringify({ ok: false, step: "profile", error: pErr.message }));
    process.exit(1);
  }
}

const counts = {};
for (const t of ["products", "sales", "customers"]) {
  const { count } = await admin
    .from(t)
    .select("*", { count: "exact", head: true })
    .eq("company_id", companyId);
  counts[t] = count || 0;
}

console.log(
  JSON.stringify({ ok: true, email, password, company_id: companyId, counts }, null, 2)
);
