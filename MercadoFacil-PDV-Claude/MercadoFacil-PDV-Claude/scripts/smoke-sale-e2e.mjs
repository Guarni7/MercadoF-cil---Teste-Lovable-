/**
 * Smoke E2E venda (API real Supabase): produto → venda → estoque.
 * Uso: node scripts/smoke-sale-e2e.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { resolve } from "path";
import { randomUUID } from "crypto";

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

function assert(c, m) {
  if (!c) throw new Error(m);
}

const env = loadEnvLocal();
const stamp = Date.now();
const email = `guarni07+mf.sale.${stamp}@gmail.com`;
const password = `Sale-${stamp}aA1!`;
const saleClientId = `sale-${randomUUID()}`;
const stockClientId = `stk-${randomUUID()}`;
const terminalId = `term-e2e-${stamp}`;

const admin = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
await admin.auth.admin.createUser({ email, password, email_confirm: true });
const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
await sb.auth.signInWithPassword({ email, password });
const { data: company, error: bootErr } = await sb.rpc("bootstrap_company", {
  p_trade_name: `Sale E2E ${stamp}`,
  p_email: email,
});
if (bootErr) throw bootErr;

const { data: product, error: pErr } = await sb
  .from("products")
  .insert({
    name: `E2E Prod ${stamp}`,
    price: 12.5,
    stock: 10,
    company_id: company.id,
  })
  .select()
  .single();
if (pErr) throw pErr;

const { data: cash, error: cErr } = await sb
  .from("cash_registers")
  .insert({
    status: "aberto",
    opening_balance: 50,
    opened_at: new Date().toISOString(),
    terminal_id: terminalId,
    company_id: company.id,
    client_id: `cash-${randomUUID()}`,
  })
  .select()
  .single();
if (cErr) throw cErr;

const { data: sale, error: sErr } = await sb
  .from("sales")
  .insert({
    total: 12.5,
    subtotal: 12.5,
    status: "concluida",
    payment_method: "dinheiro",
    amount_received: 20,
    change: 7.5,
    client_id: saleClientId,
    terminal_id: terminalId,
    cash_register_id: cash.id,
    company_id: company.id,
    items: [
      {
        product_id: product.id,
        name: product.name,
        quantity: 1,
        price: 12.5,
        total: 12.5,
      },
    ],
  })
  .select()
  .single();
if (sErr) throw sErr;

// subtotal/total são recalculados pelo trigger (migration 049) a partir de
// items, não do que foi enviado — aqui bate com o enviado (12.5) porque o
// item já é legítimo; o teste adversarial dedicado
// (smoke-sale-total-integrity.mjs) cobre o caso de valor fraudado.
assert(Number(sale.subtotal) === 12.5, `subtotal recalculado ${sale.subtotal}`);
assert(Number(sale.total) === 12.5, `total recalculado ${sale.total}`);

await sb
  .from("products")
  .update({ stock: product.stock - 1 })
  .eq("id", product.id);
await sb.from("stock_movements").insert({
  product_id: product.id,
  product_name: product.name,
  type: "saida",
  quantity: 1,
  reason: "venda",
  client_id: stockClientId,
  terminal_id: terminalId,
  company_id: company.id,
});
// Tenta forçar um total fraudado — o trigger (migration 049) deve ignorar
// isso e recalcular a partir das vendas reais do caixa (12.5, 1 venda).
await sb
  .from("cash_registers")
  .update({
    sales_total: 999999,
    sales_count: 999,
  })
  .eq("id", cash.id);

const { data: prodAfter } = await sb
  .from("products")
  .select("stock")
  .eq("id", product.id)
  .single();
const { data: cashAfter } = await sb
  .from("cash_registers")
  .select("sales_total,sales_count")
  .eq("id", cash.id)
  .single();

assert(prodAfter.stock === 9, `stock ${prodAfter.stock}`);
assert(Number(cashAfter.sales_total) === 12.5, `cash total (esperado 12.5, veio ${cashAfter.sales_total})`);
assert(Number(cashAfter.sales_count) === 1, `cash count (esperado 1, veio ${cashAfter.sales_count})`);
assert(sale.client_id === saleClientId, "sale client_id");

console.log(
  JSON.stringify(
    {
      ok: true,
      company_id: company.id,
      sale_id: sale.id,
      product_id: product.id,
      stock_after: prodAfter.stock,
      cash_sales_total: cashAfter.sales_total,
      destination: "supabase",
      base44: false,
    },
    null,
    2
  )
);
