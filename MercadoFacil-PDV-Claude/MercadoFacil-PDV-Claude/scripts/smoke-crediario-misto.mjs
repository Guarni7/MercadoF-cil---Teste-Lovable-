/**
 * Smoke do crediário em venda com várias formas de pagamento.
 *
 * Só o valor lançado como crediário vira dívida (e é abatido no cancelamento/devolução) —
 * R$ 100 = R$ 60 PIX + R$ 40 crediário mexe em R$ 40, não em R$ 100.
 *
 * Parte A (sem rede): src/lib/crediario.js + os pontos do app que o usam (checagem de código).
 * Parte B (Supabase real, empresa de teste apagada no fim): o mesmo fluxo de dívida/cancelamento/
 * devolução sobre clientes e vendas de verdade, com refund_amount calculado pelo banco.
 *
 * Uso: node scripts/smoke-crediario-misto.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";
import { readFileSync } from "fs";
import { resolve } from "path";
import { valorCrediarioDaVenda, crediarioRestanteDaVenda } from "../src/lib/crediario.js";

const falhas = [];
const ok = [];
const check = (cond, msg) => (cond ? ok.push(msg) : falhas.push(msg));
const igual = (a, b) => Math.abs(a - b) < 0.0001;

// ---------- Parte A ----------
check(igual(valorCrediarioDaVenda({ payments: [{ method: "crediario", amount: 100 }], payment_method: "crediario", total: 100 }), 100), "venda 100% crediário: 100");
check(igual(valorCrediarioDaVenda({ payments: [{ method: "pix", amount: 60 }, { method: "crediario", amount: 40 }], payment_method: "pix", total: 100 }), 40), "venda mista PIX primeiro (60 PIX + 40 crediário): 40");
check(igual(valorCrediarioDaVenda({ payments: [{ method: "crediario", amount: 40 }, { method: "pix", amount: 60 }], payment_method: "crediario", total: 100 }), 40), "venda mista crediário primeiro (40 crediário + 60 PIX): 40, não 100");
check(valorCrediarioDaVenda({ payments: [{ method: "pix", amount: 60 }, { method: "dinheiro", amount: 40 }], payment_method: "pix", total: 100 }) === 0, "venda sem crediário: 0");
check(igual(valorCrediarioDaVenda({ payments: [], payment_method: "crediario", total: 25 }), 25), "venda antiga sem payments[] em crediário: total");
check(valorCrediarioDaVenda({ payments: [], payment_method: "pix", total: 25 }) === 0, "venda antiga sem payments[] em PIX: 0");
check(valorCrediarioDaVenda({ payments: [{ method: "crediario", amount: 0.1 }, { method: "crediario", amount: 0.2 }], total: 0.3 }) === 0.3, "somas em centavos (0,1 + 0,2 = 0,30)");
{
  const venda = { payments: [{ method: "pix", amount: 60 }, { method: "crediario", amount: 40 }], payment_method: "pix", total: 100 };
  check(igual(crediarioRestanteDaVenda(venda, []), 40), "restante do crediário sem devoluções: 40");
  check(igual(crediarioRestanteDaVenda(venda, [{ refund_method: "crediario", refund_amount: 25 }, { refund_method: "pix", refund_amount: 30 }]), 15), "restante: desconta só devoluções estornadas em crediário (40 − 25 = 15)");
  check(crediarioRestanteDaVenda(venda, [{ refund_method: "crediario", refund_amount: 90 }]) === 0, "restante nunca fica negativo");
}
{ // pontos do app que mexem no saldo do cliente
  const ler = (p) => readFileSync(resolve(process.cwd(), p), "utf8").split("\r\n").join("\n");
  const pdv = ler("src/pages/PDV.jsx"), dl = ler("src/lib/dataLayer.js"), sales = ler("src/pages/Sales.jsx"), dev = ler("src/components/sales/ReturnExchangeDialog.jsx");
  check(pdv.includes("valorCrediarioDaVenda({ payments: paymentData.payments") && pdv.includes("(customer.credit_balance || 0) + valorCrediario"), "PDV online: dívida = valor do crediário");
  check(dl.includes("credit_balance: (customer.credit_balance || 0) + valorCrediario") && dl.includes("credit_delta: valorCrediario"), "venda offline (saldo local e fila de sincronização): valor do crediário");
  check(sales.includes("valorCrediarioDaVenda(sale)") && sales.includes("(customer.credit_balance || 0) - valorCrediario"), "cancelamento: abate o valor do crediário");
  check(dev.includes("crediarioRestanteDaVenda(selectedSale, priorReturns)") && dev.includes("(customer.credit_balance || 0) - abatimento"), "devolução em crediário: abate no máximo o restante do crediário da venda");
  check(dev.includes('} else if (refundMethod === "crediario" && selectedSale.customer_id) {'), "devolução em PIX/cartão/dinheiro não passa pelo abatimento de crediário (só refund_method = crediario)");
  check(![pdv, dl, sales].some((c) => /payment_method === "crediario"[^\n]*\n[^\n]*credit/.test(c)) && !sales.includes("- sale.total"), "nenhum ponto ainda usa payment_method + total inteiro para o saldo");
}

// ---------- Parte B ----------
const env = {};
for (const line of readFileSync(resolve(process.cwd(), ".env.local"), "utf8").split(/\r?\n/)) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (!m) continue;
  let v = m[2].trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  env[m[1].trim()] = v;
}
const admin = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const stamp = Date.now();
let userId = null;
let companyId = null;
try {
  const email = `guarni07+mf.crediario.${stamp}@gmail.com`;
  const password = `Crd-${stamp}aA1!`;
  const { data: u } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  userId = u.user.id;
  const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  await sb.auth.signInWithPassword({ email, password });
  const { data: c } = await sb.rpc("bootstrap_company", { p_trade_name: `Crediario ${stamp}`, p_email: email });
  companyId = typeof c === "string" ? c : c?.id;

  const novoCliente = async (saldo) => (await sb.from("customers").insert({ company_id: companyId, name: `Cliente ${randomUUID().slice(0, 6)}`, credit_balance: saldo }).select("id").single()).data.id;
  const saldo = async (id) => Number((await sb.from("customers").select("credit_balance").eq("id", id).single()).data.credit_balance);
  const prod = randomUUID();
  const novaVenda = async (clienteId, payments, metodo, itens = [{ product_id: prod, name: "item", quantity: 10, price: 10, total: 100 }]) => {
    const { data, error } = await sb.from("sales").insert({
      company_id: companyId, customer_id: clienteId, status: "concluida", payment_method: metodo, client_id: randomUUID(), payments, items: itens,
    }).select("*").single();
    if (error) throw new Error(`venda de teste: ${error.message}`);
    return data;
  };
  // os mesmos passos do app: dívida ao vender, abatimento ao cancelar
  const venderNoCrediario = async (venda) => {
    const v = valorCrediarioDaVenda(venda);
    if (v > 0 && venda.customer_id) await sb.from("customers").update({ credit_balance: (await saldo(venda.customer_id)) + v }).eq("id", venda.customer_id);
  };
  const cancelarVenda = async (venda) => {
    const v = valorCrediarioDaVenda(venda);
    if (v > 0 && venda.customer_id) await sb.from("customers").update({ credit_balance: Math.max(0, (await saldo(venda.customer_id)) - v) }).eq("id", venda.customer_id);
    await sb.from("sales").update({ status: "cancelada" }).eq("id", venda.id);
  };

  // 100% crediário: dívida e cancelamento de 100
  const cA = await novoCliente(0);
  const vA = await novaVenda(cA, [{ method: "crediario", amount: 100 }], "crediario");
  await venderNoCrediario(vA);
  check(igual(await saldo(cA), 100), "venda 100% crediário: dívida de 100");
  await cancelarVenda(vA);
  check(igual(await saldo(cA), 0), "cancelamento da venda 100% crediário: dívida volta a 0");

  // mista: R$ 100 = 60 PIX + 40 crediário (cliente já devia 70 de antes)
  const cB = await novoCliente(70);
  const vB = await novaVenda(cB, [{ method: "pix", amount: 60 }, { method: "crediario", amount: 40 }], "pix");
  await venderNoCrediario(vB);
  check(igual(await saldo(cB), 110), "venda mista: só 40 entram na dívida (70 + 40 = 110, não 170 nem 70)");
  await cancelarVenda(vB);
  check(igual(await saldo(cB), 70), "cancelamento da venda mista: abate só 40 (volta a 70, não a 10 nem a 0)");
  check((await admin.from("sales").select("status").eq("id", vB.id).single()).data.status === "cancelada", "a venda mista ficou cancelada");

  // mista com crediário primeiro: o total (100) não pode ir para a dívida
  const cC = await novoCliente(0);
  const vC = await novaVenda(cC, [{ method: "crediario", amount: 40 }, { method: "pix", amount: 60 }], "crediario");
  await venderNoCrediario(vC);
  check(igual(await saldo(cC), 40), "mista com crediário primeiro: dívida de 40 (não 100)");

  // devolução com estorno em crediário numa venda mista (refund_amount calculado pelo banco)
  const cD = await novoCliente(0);
  const vD = await novaVenda(cD, [{ method: "pix", amount: 60 }, { method: "crediario", amount: 40 }], "pix");
  await venderNoCrediario(vD);
  const devolver = async (qtd, metodo) => (await sb.from("sale_returns").insert({
    company_id: companyId, sale_id: vD.id, refund_method: metodo,
    items: [{ product_id: prod, name: "item", quantity: qtd, unit_price: 10, total: qtd * 10 }],
  }).select("refund_amount, refund_method").single());
  const abater = async (venda, devolucao, anteriores) => {
    const abatimento = Math.min(Number(devolucao.refund_amount), crediarioRestanteDaVenda(venda, anteriores));
    await sb.from("customers").update({ credit_balance: Math.max(0, (await saldo(venda.customer_id)) - abatimento) }).eq("id", venda.customer_id);
    return abatimento;
  };
  const r1 = await devolver(5, "crediario"); // refund 50 > 40 de crediário
  check(!r1.error && igual(r1.data.refund_amount, 50), `devolução de 5 itens estorna 50 (veio ${r1.data?.refund_amount})`);
  const ab1 = await abater(vD, r1.data, []);
  check(igual(ab1, 40) && igual(await saldo(cD), 0), `estorno em crediário de 50 abate só os 40 do crediário (abateu ${ab1}; saldo ${await saldo(cD)})`);
  const r2 = await devolver(2, "crediario"); // já abateu tudo
  const ab2 = await abater(vD, r2.data, [r1.data]);
  check(ab2 === 0, `nova devolução em crediário depois de zerar o crediário da venda não abate nada (abateu ${ab2})`);
} catch (e) {
  falhas.push(`Parte B abortou: ${e.message}`);
} finally {
  if (companyId) {
    await admin.from("sale_returns").delete().eq("company_id", companyId);
    await admin.from("companies").delete().eq("id", companyId);
  }
  if (userId) await admin.auth.admin.deleteUser(userId);
}

console.log("\nSmoke — crediário em venda com várias formas\n");
for (const m of ok) console.log(`  PASS  ${m}`);
for (const m of falhas) console.log(`  FAIL  ${m}`);
console.log(`\n${ok.length} passaram, ${falhas.length} falharam\n`);
process.exit(falhas.length ? 1 : 0);
