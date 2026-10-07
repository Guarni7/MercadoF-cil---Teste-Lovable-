/**
 * Smoke da baixa de estoque transacional (apply_stock_movement):
 *  - aplica a baixa e grava a movimentação (com notes) numa transação
 *  - reprocessar o mesmo client_id não baixa o estoque de novo
 *  - entrada devolve estoque
 *  - tenant de fora não enxerga nem aplica nada (RLS)
 *
 * Uso: node scripts/smoke-stock-movement.mjs
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
  const email = `guarni07+mf.stock.${tag}.${stamp}@gmail.com`;
  const password = `Stock-${stamp}aA1!`;
  const { data: user, error: uErr } = await admin.auth.admin.createUser({
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
    p_trade_name: `Cat Smoke ${stamp}${tag}`,
    p_email: email,
  });
  if (cErr) throw cErr;
  const companyId = typeof company === "string" ? company : company?.id;
  return { client, email, companyId, userId: user.user.id };
}

const owner = await makeTenant("own");
const outsider = await makeTenant("out");

const { data: product, error: pErr } = await owner.client
  .from("products")
  .insert({ name: `Produto Estoque ${stamp}`, price: 10, stock: 20, company_id: owner.companyId })
  .select()
  .single();
if (pErr) throw pErr;

const report = { ok: false, steps: {} };
const clientId = `stock-${stamp}-1`;

const first = await owner.client.rpc("apply_stock_movement", {
  p_client_id: clientId,
  p_product_id: product.id,
  p_quantity: 3,
  p_product_name: product.name,
  p_type: "saida",
  p_reason: "venda",
  p_notes: "Sync offline",
  p_terminal_id: "TERM-SMOKE",
});
report.steps.first_apply = { error: first.error?.message || null, result: first.data };

const replay = await owner.client.rpc("apply_stock_movement", {
  p_client_id: clientId,
  p_product_id: product.id,
  p_quantity: 3,
  p_product_name: product.name,
  p_type: "saida",
  p_reason: "venda",
  p_notes: "Sync offline",
  p_terminal_id: "TERM-SMOKE",
});
report.steps.replay_is_noop = { error: replay.error?.message || null, result: replay.data };

const entrada = await owner.client.rpc("apply_stock_movement", {
  p_client_id: `stock-${stamp}-2`,
  p_product_id: product.id,
  p_quantity: 5,
  p_product_name: product.name,
  p_type: "entrada",
  p_reason: "compra",
  p_notes: "Reposição",
  p_terminal_id: "TERM-SMOKE",
});
report.steps.entrada = { error: entrada.error?.message || null, result: entrada.data };

const { data: finalProduct } = await owner.client
  .from("products")
  .select("stock")
  .eq("id", product.id)
  .single();
report.steps.final_stock = finalProduct?.stock;

const { data: movements } = await owner.client
  .from("stock_movements")
  .select("type, quantity, notes, client_id")
  .eq("company_id", owner.companyId)
  .order("created_at");
report.steps.movements = movements;

const outsiderApply = await outsider.client.rpc("apply_stock_movement", {
  p_client_id: `stock-${stamp}-out`,
  p_product_id: product.id,
  p_quantity: 1,
  p_product_name: "invasor",
  p_type: "saida",
  p_reason: "venda",
  p_notes: null,
  p_terminal_id: null,
});
const { data: afterOutsider } = await owner.client
  .from("products")
  .select("stock")
  .eq("id", product.id)
  .single();
report.steps.outsider_blocked = {
  errored: !!outsiderApply.error,
  error: outsiderApply.error?.message || null,
  stock_unchanged: afterOutsider?.stock === finalProduct?.stock,
};

report.ok =
  !report.steps.first_apply.error &&
  report.steps.first_apply.result?.applied === true &&
  report.steps.replay_is_noop.result?.applied === false &&
  report.steps.entrada.result?.applied === true &&
  report.steps.final_stock === 22 &&
  (report.steps.movements || []).length === 2 &&
  (report.steps.movements || []).every((m) => !!m.notes) &&
  report.steps.outsider_blocked.stock_unchanged === true;

report.note = report.ok
  ? "Baixa transacional idempotente, notes gravado e RLS isolando o tenant"
  : "Falha na baixa de estoque transacional";

console.log(JSON.stringify(report, null, 2));
process.exit(report.ok ? 0 : 1);
