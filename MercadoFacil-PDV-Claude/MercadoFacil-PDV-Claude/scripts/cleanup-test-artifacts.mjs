/**
 * Remove usuários/empresas descartáveis criados pelos smokes e testes E2E.
 * Preserva contas reais e as empresas migradas do Base44.
 *
 * Uso:
 *   node scripts/cleanup-test-artifacts.mjs --dry   (só lista)
 *   node scripts/cleanup-test-artifacts.mjs         (remove)
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

// E-mails gerados pelos scripts de smoke/E2E sempre usam o sufixo "+mf.".
const USER_PATTERN = /\+mf\./i;
// Contas reais que nunca devem ser removidas.
const KEEP_EMAILS = new Set([
  "guarni07@gmail.com",
  "mariaclaudia2507@gmail.com",
  "guarni07+demo@gmail.com",
  "guarni07+instalador@gmail.com",
]);

const COMPANY_PATTERNS = [
  /^Empresa guarni07\+mf\./i,
  /^Loja Smoke \d+/i,
  /^Offline Smoke \d+/i,
  /^Cat Smoke \d+/i,
  /^Plans Smoke \d+/i,
  /^Sale E2E \d+/i,
  /^Ent [ab] \d+/i,
  /^Invite Co \d+/i,
  /^Role Co \d+/i,
  /^Isolamento \d+/i,
  /^Migração Smoke \d+/i,
  /^Gate (sem|com) plano \d+/i,
  /^E2E Preview$/i,
];
const KEEP_COMPANIES = [/^MiniMercado Guarnieri$/i, /^Maria Claudia$/i, /^Loja Demo MercadoFácil$/i];

// Filhas antes da empresa: as FKs de tenant não têm cascade.
// Itens de venda ficam embutidos em `sales.items`, não há tabela separada.
const CHILD_TABLES = [
  "sales",
  "stock_movements",
  "products",
  "categories",
  "brands",
  "customers",
  "bills",
  "cash_registers",
  "delivery_orders",
  "nfces",
  "activity_logs",
];

const report = { dry, users: [], companies: [], errors: [] };

let page = 1;
const matchedUsers = [];
for (;;) {
  const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
  if (error) throw error;
  const users = data?.users || [];
  matchedUsers.push(
    ...users.filter(
      (u) => USER_PATTERN.test(u.email || "") && !KEEP_EMAILS.has((u.email || "").toLowerCase())
    )
  );
  if (users.length < 200) break;
  page += 1;
}

for (const u of matchedUsers) {
  report.users.push(u.email);
  if (dry) continue;
  await admin.from("profiles").delete().eq("id", u.id);
  const { error } = await admin.auth.admin.deleteUser(u.id);
  if (error) report.errors.push(`user ${u.email}: ${error.message}`);
}

const { data: companies, error: cErr } = await admin.from("companies").select("id, trade_name");
if (cErr) throw cErr;

for (const c of companies || []) {
  const name = c.trade_name || "";
  if (KEEP_COMPANIES.some((p) => p.test(name))) continue;
  if (!COMPANY_PATTERNS.some((p) => p.test(name))) continue;
  report.companies.push(name);
  if (dry) continue;

  for (const t of CHILD_TABLES) {
    const { error } = await admin.from(t).delete().eq("company_id", c.id);
    if (
      error &&
      !/column .* does not exist|relation .* does not exist|Could not find the table/i.test(
        error.message
      )
    ) {
      report.errors.push(`${t}@${name}: ${error.message}`);
    }
  }
  await admin.from("profiles").update({ company_id: null }).eq("company_id", c.id);
  const { error } = await admin.from("companies").delete().eq("id", c.id);
  if (error) report.errors.push(`company ${name}: ${error.message}`);
}

console.log(
  JSON.stringify(
    {
      ok: report.errors.length === 0,
      removed_users: report.users.length,
      removed_companies: report.companies.length,
      errors: report.errors,
    },
    null,
    2
  )
);
process.exit(report.errors.length === 0 ? 0 : 1);
