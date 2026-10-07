/**
 * Smoke adversarial: sales.total/subtotal e cash_registers.sales_total/
 * sales_count não podem ser confiados do cliente (migration 049).
 *
 * Cobre:
 *  - venda "online" normal (total real vindo dos itens)
 *  - venda "offline sincronizada" com total adulterado antes do sync
 *  - repetição da mesma sincronização (mesmo client_id) — sem duplicar
 *  - insert direto com subtotal/total/discount fraudados — banco ignora
 *  - UPDATE tentando alterar total/subtotal depois de gravado — banco ignora
 *  - update direto e fraudado em cash_registers.sales_total/sales_count —
 *    banco recalcula a partir das vendas reais
 *
 * Uso: node scripts/smoke-sale-total-integrity.mjs
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
const email = `guarni07+mf.totalfraud.${stamp}@gmail.com`;
const password = `Fraud-${stamp}aA1!`;

const admin = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
await admin.auth.admin.createUser({ email, password, email_confirm: true });

// Client normal (anon key + login) — nada de service role aqui: o objetivo é
// provar que a proteção segura mesmo um usuário autenticado comum (o mesmo
// papel que o PDV usa no navegador), sem privilégio elevado.
const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
await sb.auth.signInWithPassword({ email, password });

const { data: company, error: bootErr } = await sb.rpc("bootstrap_company", {
  p_trade_name: `Total Fraud ${stamp}`,
  p_email: email,
});
if (bootErr) throw bootErr;

const { data: cash, error: cErr } = await sb
  .from("cash_registers")
  .insert({
    status: "aberto",
    opening_balance: 0,
    opened_at: new Date().toISOString(),
    company_id: company.id,
    client_id: `cash-${randomUUID()}`,
  })
  .select()
  .single();
if (cErr) throw cErr;

const report = { ok: false, steps: {} };

function makeItems(unitPrice, qty) {
  return [
    {
      product_id: randomUUID(),
      name: "Produto teste",
      price: unitPrice,
      quantity: qty,
      total: unitPrice * qty,
    },
  ];
}

// --- A) venda "online" normal: total real vem dos itens (10 * 2 = 20) ---
const { data: saleA, error: aErr } = await sb
  .from("sales")
  .insert({
    items: makeItems(10, 2),
    subtotal: 20,
    discount: 0,
    total: 20,
    status: "concluida",
    payment_method: "dinheiro",
    cash_register_id: cash.id,
    company_id: company.id,
    client_id: `sale-a-${randomUUID()}`,
  })
  .select()
  .single();
if (aErr) throw aErr;
report.steps.a_total_legitimo = { subtotal: saleA.subtotal, total: saleA.total };
assert(Number(saleA.total) === 20, `A: total deveria ser 20, veio ${saleA.total}`);
assert(Number(saleA.subtotal) === 20, `A: subtotal deveria ser 20, veio ${saleA.subtotal}`);

// --- B) venda "offline sincronizada" com total adulterado antes do sync ---
// Simula exatamente o insert que syncService.js faz ao processar a fila
// offline (mesmo client_id de idempotência) — só que aqui o total/subtotal
// enviados foram adulterados (1 centavo) enquanto os itens reais somam 50.
const clientIdB = `sale-b-${randomUUID()}`;
const { data: saleB, error: bErr } = await sb
  .from("sales")
  .insert({
    items: makeItems(25, 2), // real: 50
    subtotal: 0.01,
    discount: 0,
    total: 0.01, // fraudado
    status: "concluida",
    payment_method: "dinheiro",
    cash_register_id: cash.id,
    company_id: company.id,
    client_id: clientIdB,
  })
  .select()
  .single();
if (bErr) throw bErr;
report.steps.b_total_adulterado_persistido = { subtotal: saleB.subtotal, total: saleB.total };
assert(Number(saleB.total) === 50, `B: total deveria ser 50 (real), veio ${saleB.total}`);
assert(Number(saleB.subtotal) === 50, `B: subtotal deveria ser 50 (real), veio ${saleB.subtotal}`);

// --- C) cash_registers reflete A + B reais (20 + 50 = 70), não o fraudado ---
const { data: cashAfterAB } = await sb
  .from("cash_registers")
  .select("sales_total,sales_count")
  .eq("id", cash.id)
  .single();
report.steps.c_caixa_apos_a_b = cashAfterAB;
assert(Number(cashAfterAB.sales_total) === 70, `C: caixa deveria ser 70, veio ${cashAfterAB.sales_total}`);
assert(Number(cashAfterAB.sales_count) === 2, `C: caixa deveria contar 2 vendas, veio ${cashAfterAB.sales_count}`);

// --- D) repetir a "sincronização" da venda B (mesmo client_id) — idempotência ---
// syncService.js trata 23505 (unique_violation) como "já sincronizado, ok".
// Aqui só confirmamos que o banco recusa o duplicado e nada muda no caixa.
const { error: dupErr } = await sb.from("sales").insert({
  items: makeItems(25, 2),
  subtotal: 50,
  discount: 0,
  total: 50,
  status: "concluida",
  payment_method: "dinheiro",
  cash_register_id: cash.id,
  company_id: company.id,
  client_id: clientIdB,
});
assert(dupErr?.code === "23505", `D: reinserir client_id duplicado deveria falhar com 23505, veio ${JSON.stringify(dupErr)}`);

const { data: cashAfterDup } = await sb
  .from("cash_registers")
  .select("sales_total,sales_count")
  .eq("id", cash.id)
  .single();
report.steps.d_caixa_apos_duplicata = cashAfterDup;
assert(Number(cashAfterDup.sales_total) === 70, `D: caixa não deveria mudar, veio ${cashAfterDup.sales_total}`);
assert(Number(cashAfterDup.sales_count) === 2, `D: contagem não deveria mudar, veio ${cashAfterDup.sales_count}`);

// --- E) insert direto com subtotal/total/discount agressivamente fraudados ---
const { data: saleE, error: eErr } = await sb
  .from("sales")
  .insert({
    items: makeItems(5, 1), // real: 5
    subtotal: -999999,
    discount: 999999,
    total: -999999,
    status: "concluida",
    payment_method: "dinheiro",
    cash_register_id: cash.id,
    company_id: company.id,
    client_id: `sale-e-${randomUUID()}`,
  })
  .select()
  .single();
if (eErr) throw eErr;
report.steps.e_insert_agressivo = { subtotal: saleE.subtotal, total: saleE.total };
assert(Number(saleE.subtotal) === 5, `E: subtotal deveria ser 5, veio ${saleE.subtotal}`);
// discount (999999) > subtotal (5) => total nunca fica negativo (greatest(...,0))
assert(Number(saleE.total) === 0, `E: total deveria ser 0 (discount > subtotal), veio ${saleE.total}`);

// --- F) UPDATE tentando alterar total/subtotal depois de gravado ---
const { data: saleAUpdated, error: fErr } = await sb
  .from("sales")
  .update({ total: 1, subtotal: 1 })
  .eq("id", saleA.id)
  .select()
  .single();
if (fErr) throw fErr;
report.steps.f_update_fraudado = { subtotal: saleAUpdated.subtotal, total: saleAUpdated.total };
assert(Number(saleAUpdated.total) === 20, `F: total deveria continuar 20, veio ${saleAUpdated.total}`);
assert(Number(saleAUpdated.subtotal) === 20, `F: subtotal deveria continuar 20, veio ${saleAUpdated.subtotal}`);

// --- G) update direto e fraudado em cash_registers ---
await sb
  .from("cash_registers")
  .update({ sales_total: 1234567, sales_count: 42 })
  .eq("id", cash.id);
const { data: cashAfterFraud } = await sb
  .from("cash_registers")
  .select("sales_total,sales_count")
  .eq("id", cash.id)
  .single();
report.steps.g_caixa_apos_fraude_direta = cashAfterFraud;
// A(20) + B(50) + E(total 0, discount>subtotal zera; mas ENTRA na contagem) = 70
assert(Number(cashAfterFraud.sales_total) === 70, `G: caixa deveria ser 70, veio ${cashAfterFraud.sales_total}`);
assert(Number(cashAfterFraud.sales_count) === 3, `G: caixa deveria contar 3 vendas, veio ${cashAfterFraud.sales_count}`);

report.ok = true;
console.log(JSON.stringify(report, null, 2));
