/**
 * Smoke do detalhamento de pagamentos mistos (split-payment) em sales.payments.
 *
 * Verifica:
 *  1. venda simples sem payments[] continua funcionando (compatibilidade);
 *  2. dinheiro, PIX, cartão isolados — 1 lançamento, soma bate com o total;
 *  3. dinheiro+cartão, dinheiro+PIX, cartão+PIX — 2 lançamentos;
 *  4. 3 formas de pagamento — 3 lançamentos;
 *  5. transactionId (TEF) e pix_payment_id de cada lançamento preservados;
 *  6. soma de payments divergente do total é REJEITADA pelo banco;
 *  7. lançamento sem method/amount válido é REJEITADO.
 *
 * Uso: node scripts/smoke-sales-payments.mjs
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
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    env[m[1].trim()] = v;
  }
  return env;
}

const env = loadEnvLocal();
const admin = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const falhas = [];
const ok = [];
const check = (cond, msg) => (cond ? ok.push(msg) : falhas.push(msg));

const stamp = Date.now();
const email = `guarni07+mf.split.${stamp}@gmail.com`;
const password = `Split-${stamp}aA1!`;
await admin.auth.admin.createUser({ email, password, email_confirm: true });

const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
await sb.auth.signInWithPassword({ email, password });
const { data: bootstrap } = await sb.rpc("bootstrap_company", {
  p_trade_name: `Split ${stamp}`,
  p_email: email,
});
const companyId = typeof bootstrap === "string" ? bootstrap : bootstrap?.id;

const items = (total) => [{ product_id: null, name: "Item teste", quantity: 1, total }];

const criarVenda = async (total, payments) => {
  return sb.from("sales").insert({
    company_id: companyId,
    items: items(total),
    subtotal: total,
    total,
    payment_method: payments[0]?.method || "dinheiro",
    amount_received: total,
    status: "concluida",
    payments,
  }).select().single();
};

// 1. Venda simples, sem payments[] — compatibilidade mantida
{
  const { data, error } = await criarVenda(30, []);
  check(!error, `venda simples sem payments[] é aceita (${error?.message || "ok"})`);
  check(data?.total === 30, "total recalculado a partir de items, como antes (049)");
}

// 2. Métodos isolados
for (const method of ["dinheiro", "pix", "credito"]) {
  const { data, error } = await criarVenda(50, [{ method, amount: 50, label: method }]);
  check(!error, `${method} isolado (1 lançamento) é aceito (${error?.message || "ok"})`);
  check(data?.payments?.length === 1 && data.payments[0].method === method, `${method} isolado gravado corretamente`);
}

// 3. Combinações de 2
const combos2 = [
  [{ method: "dinheiro", amount: 50 }, { method: "credito", amount: 50 }],
  [{ method: "dinheiro", amount: 30 }, { method: "pix", amount: 70 }],
  [{ method: "credito", amount: 40 }, { method: "pix", amount: 60 }],
];
for (const combo of combos2) {
  const total = combo.reduce((s, p) => s + p.amount, 0);
  const { data, error } = await criarVenda(total, combo);
  const nomes = combo.map((p) => p.method).join("+");
  check(!error, `${nomes} (split de 2) é aceito (${error?.message || "ok"})`);
  check(data?.payments?.length === 2, `${nomes} grava os 2 lançamentos`);
}

// 4. 3 formas de pagamento
{
  const combo = [
    { method: "dinheiro", amount: 20 },
    { method: "credito", amount: 30 },
    { method: "pix", amount: 50 },
  ];
  const { data, error } = await criarVenda(100, combo);
  check(!error, `split de 3 formas é aceito (${error?.message || "ok"})`);
  check(data?.payments?.length === 3, "split de 3 formas grava os 3 lançamentos");
}

// 5. transactionId (TEF) e pixPaymentId preservados por lançamento
{
  const combo = [
    { method: "credito", amount: 40, transactionId: "tef-abc-123" },
    { method: "pix", amount: 60, pixPaymentId: "mp-999", pixConfirmationType: "gateway" },
  ];
  const { data, error } = await criarVenda(100, combo);
  check(!error, `split com transactionId/pixPaymentId é aceito (${error?.message || "ok"})`);
  const credito = data?.payments?.find((p) => p.method === "credito");
  const pix = data?.payments?.find((p) => p.method === "pix");
  check(credito?.transactionId === "tef-abc-123", "transactionId do TEF preservado no lançamento");
  check(pix?.pixPaymentId === "mp-999" && pix?.pixConfirmationType === "gateway", "pixPaymentId/pixConfirmationType preservados no lançamento");
}

// 6. Valores inválidos — soma diferente do total é rejeitada
{
  const { error } = await criarVenda(100, [{ method: "dinheiro", amount: 40 }, { method: "credito", amount: 40 }]);
  check(!!error && /não confere/i.test(error.message), `soma divergente do total (80 ≠ 100) é rejeitada (${error?.message})`);
}
{
  const { error } = await criarVenda(100, [{ method: "dinheiro", amount: 60 }, { method: "credito", amount: 60 }]);
  check(!!error && /não confere/i.test(error.message), `soma maior que o total (120 ≠ 100) é rejeitada (${error?.message})`);
}

// 7. Lançamento malformado é rejeitado
{
  const { error } = await criarVenda(50, [{ method: "dinheiro" }]);
  check(!!error && /method\/amount/i.test(error.message), `lançamento sem amount é rejeitado (${error?.message})`);
}
{
  const { error } = await criarVenda(50, [{ amount: 50 }]);
  check(!!error && /method\/amount/i.test(error.message), `lançamento sem method é rejeitado (${error?.message})`);
}

await admin.from("companies").delete().eq("id", companyId);

console.log("\nSmoke — split-payment (sales.payments)\n");
for (const m of ok) console.log(`  PASS  ${m}`);
for (const m of falhas) console.log(`  FAIL  ${m}`);
console.log(`\n${ok.length} passaram, ${falhas.length} falharam\n`);
process.exit(falhas.length ? 1 : 0);
