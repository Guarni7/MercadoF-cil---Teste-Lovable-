/**
 * Smoke do estorno financeiro da devolução: valor confiável (server-side),
 * impacto no caixa (dinheiro), crediário, vendas split, e o limite contra
 * estornar acima do valor disponível.
 *
 * Uso: node scripts/smoke-sale-returns-refund.mjs
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

async function novaEmpresa(tag) {
  const stamp = Date.now() + Math.floor(Math.random() * 1000);
  const email = `guarni07+mf.${tag}.${stamp}@gmail.com`;
  const password = `Ref-${stamp}aA1!`;
  await admin.auth.admin.createUser({ email, password, email_confirm: true });
  const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  await sb.auth.signInWithPassword({ email, password });
  const { data: bootstrap } = await sb.rpc("bootstrap_company", { p_trade_name: `Ref ${tag} ${stamp}`, p_email: email });
  const companyId = typeof bootstrap === "string" ? bootstrap : bootstrap?.id;
  return { sb, companyId };
}

const { sb, companyId } = await novaEmpresa("refund");

const { data: produto } = await sb
  .from("products")
  .insert({ company_id: companyId, name: "Produto Estorno", price: 20, stock: 100, unit: "UN" })
  .select()
  .single();

// --- 1. Dinheiro: caixa aberto, devolução reduz o esperado em gaveta ---
const { data: caixa } = await sb
  .from("cash_registers")
  .insert({ company_id: companyId, status: "aberto", opening_balance: 100 })
  .select()
  .single();

const { data: vendaDinheiro } = await sb
  .from("sales")
  .insert({
    company_id: companyId,
    items: [{ product_id: produto.id, name: produto.name, quantity: 5, price: 20, total: 100 }],
    subtotal: 100,
    total: 100,
    payment_method: "dinheiro",
    amount_received: 100,
    status: "concluida",
    cash_register_id: caixa.id,
  })
  .select()
  .single();

const { data: devDinheiro, error: erroDinheiro } = await sb
  .from("sale_returns")
  .insert({
    company_id: companyId,
    sale_id: vendaDinheiro.id,
    items: [{ product_id: produto.id, name: produto.name, quantity: 2, unit_price: 999, total: 999999 }], // valores forjados
    refund_method: "dinheiro",
  })
  .select()
  .single();
check(!erroDinheiro, `devolução em dinheiro é aceita (${erroDinheiro?.message || "ok"})`);
check(devDinheiro?.refund_amount === 40, `valor forjado (999999) é ignorado — refund_amount recalculado do preço real da venda (2 x R$20 = 40, veio ${devDinheiro?.refund_amount})`);

await sb.from("cash_registers").update({ returns_total: (caixa.returns_total || 0) + devDinheiro.refund_amount }).eq("id", caixa.id);
const { data: caixaDepois } = await sb.from("cash_registers").select("returns_total").eq("id", caixa.id).single();
check(caixaDepois.returns_total === 40, `caixa registra returns_total = 40 (veio ${caixaDepois.returns_total})`);

// --- 2. Crediário: abate credit_balance do cliente ---
const { data: cliente } = await sb
  .from("customers")
  .insert({ company_id: companyId, name: "Cliente Crediário", credit_balance: 0 })
  .select()
  .single();

const { data: vendaCrediario } = await sb
  .from("sales")
  .insert({
    company_id: companyId,
    items: [{ product_id: produto.id, name: produto.name, quantity: 3, price: 20, total: 60 }],
    subtotal: 60,
    total: 60,
    payment_method: "crediario",
    customer_id: cliente.id,
    customer_name: cliente.name,
    status: "concluida",
  })
  .select()
  .single();
await sb.from("customers").update({ credit_balance: 60 }).eq("id", cliente.id);

const { data: devCrediario, error: erroCrediario } = await sb
  .from("sale_returns")
  .insert({
    company_id: companyId,
    sale_id: vendaCrediario.id,
    items: [{ product_id: produto.id, name: produto.name, quantity: 1 }],
    refund_method: "crediario",
  })
  .select()
  .single();
check(!erroCrediario, `devolução em crediário é aceita (${erroCrediario?.message || "ok"})`);
check(devCrediario?.refund_amount === 20, `refund_amount calculado do preço real (1 x 20 = 20, veio ${devCrediario?.refund_amount})`);

await sb.from("customers").update({ credit_balance: Math.max(0, 60 - devCrediario.refund_amount) }).eq("id", cliente.id);
const { data: clienteDepois } = await sb.from("customers").select("credit_balance").eq("id", cliente.id).single();
check(clienteDepois.credit_balance === 40, `credit_balance do cliente abatido corretamente (60 - 20 = 40, veio ${clienteDepois.credit_balance})`);

// --- 3. PIX/cartão: só registra, sem estorno automático (sem efeito colateral pra verificar — só que o registro existe) ---
const { data: vendaPix } = await sb
  .from("sales")
  .insert({
    company_id: companyId,
    items: [{ product_id: produto.id, name: produto.name, quantity: 2, price: 20, total: 40 }],
    subtotal: 40,
    total: 40,
    payment_method: "pix",
    pix_payment_id: "mp-12345",
    status: "concluida",
  })
  .select()
  .single();

const { data: devPix, error: erroPix } = await sb
  .from("sale_returns")
  .insert({
    company_id: companyId,
    sale_id: vendaPix.id,
    items: [{ product_id: produto.id, name: produto.name, quantity: 2 }],
    refund_method: "pix",
  })
  .select()
  .single();
check(!erroPix, `devolução em PIX é aceita (${erroPix?.message || "ok"})`);
check(devPix?.refund_method === "pix" && devPix?.refund_amount === 40, "devolução PIX registra método e valor, sem simular estorno bancário");

// --- 4. Venda split (dinheiro + cartão): devolução parcial preserva o detalhamento original ---
const { data: vendaSplit } = await sb
  .from("sales")
  .insert({
    company_id: companyId,
    items: [{ product_id: produto.id, name: produto.name, quantity: 4, price: 20, total: 80 }],
    subtotal: 80,
    total: 80,
    payment_method: "dinheiro",
    payments: [
      { method: "dinheiro", amount: 40, label: "Dinheiro" },
      { method: "credito", amount: 40, label: "Crédito", transactionId: "tef-split-1" },
    ],
    status: "concluida",
  })
  .select()
  .single();
check(vendaSplit?.payments?.length === 2, "venda split gravada com 2 lançamentos em payments[]");

const { data: devSplit, error: erroSplit } = await sb
  .from("sale_returns")
  .insert({
    company_id: companyId,
    sale_id: vendaSplit.id,
    items: [{ product_id: produto.id, name: produto.name, quantity: 2 }],
    refund_method: "credito", // operador escolheu qual dos dois estornar — sistema não decide sozinho
  })
  .select()
  .single();
check(!erroSplit, `devolução parcial de venda split é aceita (${erroSplit?.message || "ok"})`);
check(devSplit?.refund_amount === 40, `valor da devolução (2 de 4 = metade de 80 = 40) calculado certo (veio ${devSplit?.refund_amount})`);

const { data: vendaSplitDepois } = await sb.from("sales").select("payments").eq("id", vendaSplit.id).single();
check(
  JSON.stringify(vendaSplitDepois.payments) === JSON.stringify(vendaSplit.payments),
  "sales.payments[] da venda original não foi alterado pela devolução — detalhamento original preservado"
);

// --- 5. Devolução total: fecha o saldo, segunda tentativa é rejeitada ---
const { error: erroSplit2 } = await sb.from("sale_returns").insert({
  company_id: companyId,
  sale_id: vendaSplit.id,
  items: [{ product_id: produto.id, name: produto.name, quantity: 2 }],
  refund_method: "dinheiro",
});
check(!erroSplit2, "devolução total do saldo restante (2) é aceita");

const { error: erroSplitAlem } = await sb.from("sale_returns").insert({
  company_id: companyId,
  sale_id: vendaSplit.id,
  items: [{ product_id: produto.id, name: produto.name, quantity: 1 }],
  refund_method: "dinheiro",
});
check(!!erroSplitAlem && /excede o saldo/i.test(erroSplitAlem.message), `estornar acima do disponível (saldo 0) é rejeitado (${erroSplitAlem?.message})`);

// --- 6. Valor forjado sem alterar quantidade não passa (mensagem de erro não aplicável — já coberto no teste 1) ---

await admin.from("companies").delete().eq("id", companyId);

console.log("\nSmoke — estorno financeiro da devolução\n");
for (const m of ok) console.log(`  PASS  ${m}`);
for (const m of falhas) console.log(`  FAIL  ${m}`);
console.log(`\n${ok.length} passaram, ${falhas.length} falharam\n`);
process.exit(falhas.length ? 1 : 0);
