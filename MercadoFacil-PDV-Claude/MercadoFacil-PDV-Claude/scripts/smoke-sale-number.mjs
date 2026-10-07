/**
 * Smoke da numeração de vendas no servidor:
 *  - venda sem número recebe sequência por empresa (1, 2, 3...)
 *  - dois "terminais" inserindo em paralelo não repetem número
 *  - número explícito (dados migrados) é preservado
 *  - a sequência é por tenant (outra empresa recomeça em 1)
 *
 * Uso: node scripts/smoke-sale-number.mjs
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

async function makeTenant(tag) {
  const email = `guarni07+mf.salenum.${tag}.${stamp}@gmail.com`;
  const password = `Num-${stamp}aA1!`;
  const { error: uErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (uErr) throw uErr;
  const client = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error: lErr } = await client.auth.signInWithPassword({ email, password });
  if (lErr) throw lErr;
  const { data: company, error: cErr } = await client.rpc("bootstrap_company", {
    p_trade_name: `Sale E2E ${stamp}${tag}`,
    p_email: email,
  });
  if (cErr) throw cErr;
  return { client, companyId: typeof company === "string" ? company : company?.id };
}

const a = await makeTenant("a");
const b = await makeTenant("b");

const report = { ok: false, steps: {} };

async function createSale(tenant, extra = {}) {
  const { data, error } = await tenant.client
    .from("sales")
    .insert({ total: 10, payment_method: "dinheiro", company_id: tenant.companyId, ...extra })
    .select("number")
    .single();
  if (error) throw new Error(error.message);
  return data.number;
}

report.steps.sequential = [await createSale(a), await createSale(a)];

// Duas vendas simultâneas (dois caixas) não podem colidir.
const [p1, p2] = await Promise.all([createSale(a), createSale(a)]);
report.steps.concurrent = [p1, p2].sort((x, y) => x - y);

// Número explícito (import de dados migrados) é respeitado.
report.steps.explicit = await createSale(a, { number: 99 });
report.steps.after_explicit = await createSale(a);

// Sequência é isolada por empresa.
report.steps.other_tenant_first = await createSale(b);

report.ok =
  report.steps.sequential[0] === 1 &&
  report.steps.sequential[1] === 2 &&
  report.steps.concurrent[0] === 3 &&
  report.steps.concurrent[1] === 4 &&
  report.steps.explicit === 99 &&
  report.steps.after_explicit === 100 &&
  report.steps.other_tenant_first === 1;

report.note = report.ok
  ? "Numeração sequencial por empresa, sem colisão entre terminais"
  : "Numeração de vendas incorreta";

console.log(JSON.stringify(report, null, 2));
process.exit(report.ok ? 0 : 1);
