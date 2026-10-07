/**
 * Cria um tenant descartável para testes E2E no navegador:
 * empresa em trial + usuário com senha + produtos com estoque.
 * Os nomes seguem os padrões de scripts/cleanup-test-artifacts.mjs.
 *
 * Uso: node scripts/make-e2e-tenant.mjs
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

const env = loadEnvLocal();
const admin = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const stamp = Date.now();

const { data: company, error: cErr } = await admin
  .from("companies")
  .insert({
    trade_name: `Sale E2E ${stamp}`,
    legal_name: `Sale E2E ${stamp} LTDA`,
    status: "active",
    plan: "mei",
    plan_status: "trial",
    trial_started_at: new Date().toISOString(),
    plan_expires_at: new Date(Date.now() + 7 * 864e5).toISOString(),
  })
  .select()
  .single();
if (cErr) throw cErr;

const email = `guarni07+mf.sale.${stamp}@gmail.com`;
const password = `Sale-${stamp}aA1!`;
const { data: userData, error: uErr } = await admin.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
});
if (uErr) throw uErr;

const { error: pErr } = await admin
  .from("profiles")
  .update({
    company_id: company.id,
    role: "admin",
    plan: "mei",
    plan_status: "trial",
    plan_expires_at: new Date(Date.now() + 7 * 864e5).toISOString(),
  })
  .eq("id", userData.user.id);
if (pErr) throw pErr;

const products = [
  { name: "Arroz Teste 5kg", code: "7890000000011", price: 24.9, stock: 50 },
  { name: "Feijão Teste 1kg", code: "7890000000028", price: 8.5, stock: 40 },
  { name: "Café Teste 500g", code: "7890000000035", price: 14.9, stock: 30 },
].map((p) => ({ ...p, unit: "UN", active: true, company_id: company.id }));

const { data: created, error: prodErr } = await admin
  .from("products")
  .insert(products)
  .select("id, name, stock");
if (prodErr) throw prodErr;

console.log(
  JSON.stringify(
    {
      ok: true,
      email,
      password,
      company_id: company.id,
      company_name: company.trade_name,
      products: created,
    },
    null,
    2
  )
);
