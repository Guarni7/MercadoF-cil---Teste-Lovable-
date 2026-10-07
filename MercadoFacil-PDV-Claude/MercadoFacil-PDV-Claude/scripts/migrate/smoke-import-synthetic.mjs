/**
 * Gera dump sintético + importa no Supabase para validar pipeline Fase F
 * (sem BASE44_API_KEY). Não apaga dados Base44 (não há origem real).
 *
 * Uso: node scripts/migrate/smoke-import-synthetic.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { resolve, join } from "path";
import { randomUUID } from "crypto";
import { spawn } from "child_process";

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
const companyId = randomUUID();
const catOld = `cat-base44-${stamp}`;
const brandOld = `brand-base44-${stamp}`;
const prodUuid = randomUUID();
const custOld = `cust-base44-${stamp}`;

const dir = resolve(process.cwd(), "migration-dump-synthetic");
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });

const dump = {
  Company: [
    {
      id: companyId,
      trade_name: `Migração Smoke ${stamp}`,
      legal_name: `Migração Smoke LTDA ${stamp}`,
      document: "00000000000191",
      status: "trial",
      plan: "trial",
      plan_status: "trial",
      created_date: new Date().toISOString(),
    },
  ],
  Category: [
    {
      id: catOld,
      name: "Categoria Migrada",
      color: "#0d9488",
      company_id: companyId,
      created_date: new Date().toISOString(),
    },
  ],
  Brand: [
    {
      id: brandOld,
      name: "Marca Migrada",
      company_id: companyId,
    },
  ],
  Product: [
    {
      id: prodUuid,
      name: "Produto Migrado",
      price: 9.9,
      stock: 5,
      category: "Categoria Migrada",
      brand: "Marca Migrada",
      company_id: companyId,
      active: true,
    },
  ],
  Customer: [
    {
      id: custOld,
      name: "Cliente Migrado",
      phone: "62999999999",
      company_id: companyId,
      credit_limit: 100,
    },
  ],
};

writeFileSync(join(dir, "all.json"), JSON.stringify(dump, null, 2));

function runImport() {
  return new Promise((resolvePromise) => {
    const child = spawn(
      process.execPath,
      [
        resolve("scripts/migrate/import-dump.mjs"),
        `--dir=${dir}`,
        `--company-id=${companyId}`,
      ],
      { stdio: ["ignore", "pipe", "pipe"] }
    );
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("close", (code) => resolvePromise({ code: code ?? 1, out }));
  });
}

const { code, out } = await runImport();
let report;
try {
  report = JSON.parse(out.trim());
} catch {
  report = { parse_error: true, out: out.slice(0, 1500) };
}

const { count: products } = await admin
  .from("products")
  .select("*", { count: "exact", head: true })
  .eq("company_id", companyId);
const { count: customers } = await admin
  .from("customers")
  .select("*", { count: "exact", head: true })
  .eq("company_id", companyId);
const { count: categories } = await admin
  .from("categories")
  .select("*", { count: "exact", head: true })
  .eq("company_id", companyId);

const idMap = report?.id_map_entries > 0;
const ok =
  code === 0 &&
  report?.ok === true &&
  products === 1 &&
  customers === 1 &&
  categories === 1 &&
  idMap;

console.log(
  JSON.stringify(
    {
      ok,
      company_id: companyId,
      import_exit: code,
      import_report: report,
      verify: { products, customers, categories },
      non_uuid_remap: true,
      base44_api_key_required_for_real_export: true,
      note: ok
        ? "Pipeline F (transform+import+id_map) validado com dump sintético"
        : "Falha no pipeline sintético",
    },
    null,
    2
  )
);
process.exit(ok ? 0 : 1);
