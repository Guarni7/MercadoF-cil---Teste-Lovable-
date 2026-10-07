/**
 * Smoke do Fechar Caixa (valores calculados, não digitados).
 *
 * Parte A (sem rede): src/lib/cashClose.js — totais por forma a partir de sales.payments[],
 * exclusão de canceladas, venda com várias formas, venda antiga sem payments[], dinheiro
 * esperado na gaveta, união de vendas local/servidor e paginação.
 * Parte B (Supabase real, empresa de teste apagada no fim): mesma consulta que a tela faz,
 * com vendas de verdade (dinheiro, PIX, crédito, débito, múltiplas formas, cancelada, venda
 * ConnectTEF, venda antiga), sangria/suprimento pelo RPC apply_cash_movement e caixa com
 * mais de mil vendas.
 *
 * Uso: node scripts/smoke-cash-close.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";
import { readFileSync } from "fs";
import { resolve } from "path";
import { totaisPorForma, esperadoNaGaveta, resumoDoCaixa, pagamentosDaVenda, unirVendas, lerTodasAsPaginas, vendaConcluida } from "../src/lib/cashClose.js";

const falhas = [];
const ok = [];
const check = (cond, msg) => (cond ? ok.push(msg) : falhas.push(msg));
const igual = (a, b) => Math.abs(a - b) < 0.0001;

// ---------- Parte A ----------
const v = (payment_method, total, payments, status = "concluida", extra = {}) => ({ id: randomUUID(), payment_method, total, payments, status, ...extra });
{
  const t = totaisPorForma([v("dinheiro", 10, [{ method: "dinheiro", amount: 10 }])]);
  check(igual(t.porForma.dinheiro, 10) && igual(t.total, 10) && t.vendas === 1 && igual(t.porForma.pix, 0), "venda em dinheiro: só dinheiro soma");
}
{
  const t = totaisPorForma([v("pix", 20, [{ method: "pix", amount: 20 }])]);
  check(igual(t.porForma.pix, 20) && igual(t.porForma.dinheiro, 0), "venda em PIX: só PIX soma");
}
{
  const t = totaisPorForma([v("credito", 30, [{ method: "credito", amount: 30 }]), v("debito", 40, [{ method: "debito", amount: 40 }])]);
  check(igual(t.porForma.credito, 30) && igual(t.porForma.debito, 40) && igual(t.total, 70), "venda em crédito e em débito");
}
{
  // venda mista: payment_method guarda só a 1ª forma — a distribuição vem de payments[]
  const t = totaisPorForma([v("dinheiro", 100, [{ method: "dinheiro", amount: 25 }, { method: "pix", amount: 15 }, { method: "credito", amount: 60 }])]);
  check(igual(t.porForma.dinheiro, 25) && igual(t.porForma.pix, 15) && igual(t.porForma.credito, 60) && igual(t.total, 100) && t.vendas === 1, "venda com múltiplas formas é distribuída pelos valores de cada pagamento");
}
{
  const t = totaisPorForma([v("dinheiro", 500, [{ method: "dinheiro", amount: 500 }], "cancelada"), v("pix", 9, [{ method: "pix", amount: 9 }], "estornada"), v("pix", 8, [{ method: "pix", amount: 8 }], "pendente")]);
  check(t.total === 0 && t.vendas === 0, "cancelada, estornada e não concluída não entram");
  check(vendaConcluida({ status: "concluida" }) && vendaConcluida({}) && !vendaConcluida({ status: "cancelada" }), "só 'concluida' (ou status vazio, padrão do banco) conta");
}
{
  const t = totaisPorForma([v("crediario", 7.5, [])]);
  check(igual(t.porForma.crediario, 7.5), "venda antiga sem payments[]: usa payment_method e total");
  check(pagamentosDaVenda({ payments: null, payment_method: "pix", total: 3 })[0].method === "pix", "payments nulo também cai no payment_method");
}
{
  const t = totaisPorForma([v("x", 5, [{ method: "cheque", amount: 5 }]), v("dinheiro", 1, [{ method: "dinheiro", amount: 1 }])]);
  check(igual(t.outros, 5) && igual(t.total, 6), "forma desconhecida vai para 'outros' e não some do total");
}
{
  const t = totaisPorForma([v("dinheiro", 0.1, [{ method: "dinheiro", amount: 0.1 }]), v("dinheiro", 0.2, [{ method: "dinheiro", amount: 0.2 }])]);
  check(t.porForma.dinheiro === 0.3, "soma em centavos sem erro de ponto flutuante (0,1 + 0,2 = 0,30)");
}
{
  const t = totaisPorForma([]);
  check(t.total === 0 && t.vendas === 0 && Object.values(t.porForma).every((x) => x === 0), "caixa sem vendas: tudo zero");
}
check(igual(esperadoNaGaveta({ abertura: 100, vendasDinheiro: 35, suprimentos: 50, sangrias: 30 }), 155), "gaveta = abertura + dinheiro + suprimento − sangria");
check(igual(esperadoNaGaveta({ abertura: 100, vendasDinheiro: 35, suprimentos: 50, sangrias: 30, devolucoesDinheiro: 5 }), 150), "devolução paga em dinheiro sai da gaveta");
check(igual(esperadoNaGaveta({ abertura: 100 }), 100), "caixa sem vendas e sem movimentos: esperado = abertura");
{
  // PIX/crédito/débito/vale/crédito loja não mexem na gaveta
  const t = totaisPorForma([v("pix", 20, [{ method: "pix", amount: 20 }]), v("credito", 30, [{ method: "credito", amount: 30 }]), v("debito", 40, [{ method: "debito", amount: 40 }]), v("valepresente", 5, [{ method: "valepresente", amount: 5 }]), v("crediario", 6, [{ method: "crediario", amount: 6 }])]);
  check(igual(esperadoNaGaveta({ abertura: 50, vendasDinheiro: t.porForma.dinheiro }), 50) && igual(t.total, 101), "outras formas aumentam o total vendido, nunca a gaveta");
}
{
  const a = { id: "1", client_id: "c1" }, b = { id: "2", client_id: "c2" }, semClient = { id: "9" }, localPendente = { id: "local_c3", client_id: "c3" }, localJaSubiu = { id: "local_c1", client_id: "c1" }, cacheSemClient = { id: "9" };
  const r = unirVendas([a, b, semClient], [localPendente, localJaSubiu, cacheSemClient]);
  check(r.length === 4 && r.some((s) => s.client_id === "c3"), "união: venda local pendente entra; a que já subiu e o cache da mesma venda não duplicam");
  check(unirVendas([], [localPendente, cacheSemClient]).length === 2, "offline: usa as vendas locais");
}
{
  const tabela = Array.from({ length: 2503 }, (_, i) => i);
  let chamadas = 0;
  const todas = await lerTodasAsPaginas(async (de, ate) => { chamadas++; return tabela.slice(de, ate + 1); }, 1000);
  check(todas.length === 2503 && chamadas === 3, "paginação lê 2503 linhas em 3 páginas");
  const exata = await lerTodasAsPaginas(async (de, ate) => Array.from({ length: 2000 }, (_, i) => i).slice(de, ate + 1), 1000);
  check(exata.length === 2000, "paginação com total múltiplo do tamanho da página não perde nem repete linhas");
}
{ // a tela: nada digitável no fechamento, só valores calculados
  const dlg = readFileSync(resolve(process.cwd(), "src/components/cash/CashDialog.jsx"), "utf8").split("\r\n").join("\n");
  const fechar = dlg.slice(dlg.indexOf("// ---------- MODO FECHAR"));
  check(!/CurrencyInput|<input|countedByMethod|Informado/i.test(fechar), "tela Fechar Caixa: sem campo digitável nem coluna 'Informado'");
  check(fechar.includes("Total vendido") && fechar.includes("Não podem ser editados") && fechar.includes("Esperado em caixa (dinheiro)"), "tela deixa claro que os valores são calculados e o dinheiro esperado em caixa");
  check(dlg.includes("setErroCarga(true)") && dlg.includes("disabled={saving || loadingSales || erroCarga}"), "sem conseguir carregar as vendas, o fechamento fica bloqueado");
}

{ // resumoDoCaixa: a regra única do dinheiro esperado (Fechar Caixa e tela do caixa)
  const vendas = [
    v("dinheiro", 10, [{ method: "dinheiro", amount: 10 }]),
    v("pix", 20, [{ method: "pix", amount: 20 }]),
    v("credito", 30, [{ method: "credito", amount: 30 }]),
    v("debito", 40, [{ method: "debito", amount: 40 }]),
    v("valepresente", 5, [{ method: "valepresente", amount: 5 }]),
    v("crediario", 6, [{ method: "crediario", amount: 6 }]),
    v("dinheiro", 100, [{ method: "dinheiro", amount: 25 }, { method: "pix", amount: 15 }, { method: "credito", amount: 60 }]),
    v("dinheiro", 500, [{ method: "dinheiro", amount: 500 }], "cancelada"),
  ];
  const caixa = { opening_balance: 100, supplies_total: 50, withdrawals_total: 30, returns_total: 5, sales_total: 999 };
  const r = resumoDoCaixa(caixa, vendas);
  check(igual(r.expectedInDrawer, 150) && igual(r.vendasDinheiro, 35), "resumoDoCaixa: 100 + 35 (dinheiro) + 50 − 30 − 5 = 150");
  check(igual(r.total, 211) && igual(r.porForma.pix, 35) && igual(r.porForma.credito, 90), "resumoDoCaixa: total vendido e formas (PIX 20+15, crédito 30+60)");
  check(igual(resumoDoCaixa({ ...caixa, sales_total: 123456 }, vendas).expectedInDrawer, 150), "resumoDoCaixa ignora cash_registers.sales_total (que soma todas as formas)");
  check(igual(resumoDoCaixa({ opening_balance: 80 }, []).expectedInDrawer, 80), "resumoDoCaixa: caixa sem vendas = abertura");
  check(igual(resumoDoCaixa(null, []).expectedInDrawer, 0), "resumoDoCaixa: sem caixa não quebra");
  const so = (m, valor) => resumoDoCaixa({ opening_balance: 10 }, [v(m, valor, [{ method: m, amount: valor }])]).expectedInDrawer;
  check(igual(so("pix", 50), 10) && igual(so("credito", 50), 10) && igual(so("debito", 50), 10) && igual(so("valepresente", 50), 10) && igual(so("crediario", 50), 10) && igual(so("dinheiro", 50), 60), "só dinheiro aumenta o esperado em caixa");
}
{ // as duas telas usam a MESMA função e não reimplementam a conta
  const ler = (p) => readFileSync(resolve(process.cwd(), p), "utf8").split("\r\n").join("\n");
  const tela = ler("src/pages/CashRegister.jsx"), dlg = ler("src/components/cash/CashDialog.jsx");
  check(tela.includes("resumoDoCaixa(caixa, sales)") && tela.includes("carregarDadosDoCaixa(currentRegister)"), "CashRegister: calcula com resumoDoCaixa e carrega com carregarDadosDoCaixa");
  check(dlg.includes("resumoDoCaixa(reg, sales)") && dlg.includes("carregarDadosDoCaixa(register)"), "CashDialog (Fechar Caixa): mesma função e mesma carga");
  check(!/expectedBalance|esperadoNaGaveta|sales_total \|\| 0\) \+/.test(tela) && !/esperadoNaGaveta/.test(dlg), "nenhuma das telas reimplementa a conta");
  check(tela.includes('saldo.estado === "erro"') && tela.includes("Tentar de novo") && tela.includes('estado: "carregando"'), "CashRegister trata carregando e erro sem quebrar a tela");
}

{ // CaixaReport: mesma regra do Fechar Caixa, busca em lote, loading/erro sem valor errado
  const ler = (p) => readFileSync(resolve(process.cwd(), p), "utf8").split("\r\n").join("\n");
  const rel = ler("src/components/reports/CaixaReport.jsx"), dados = ler("src/lib/cashCloseData.js");
  check(rel.includes("resumoDoCaixa(r, porCaixa.get(String(r.id)) || []).expectedInDrawer") && rel.includes("carregarVendasDasSessoes("), "CaixaReport: usa resumoDoCaixa e a busca em lote");
  check(!/\(r\.sales_total \|\| 0\) \+\s*\n\s*\(r\.supplies_total/.test(rel), "CaixaReport: a conta antiga (abertura + sales_total + suprimentos − sangrias) foi removida");
  check(rel.includes('soma("sales_total")') && rel.includes('soma("supplies_total")') && rel.includes('soma("withdrawals_total")'), "CaixaReport: KPIs de Vendas, Suprimentos e Sangrias mantidos");
  check(rel.includes('esperados.estado === "ok" ? esperados.porId[r.id] : undefined') && rel.includes('esperado === undefined ? (esperados.estado === "erro" ? "—" : "…")') && rel.includes("Tentar de novo"), "CaixaReport: carregando mostra … e erro mostra — com 'Tentar de novo' (nunca valor calculado errado)");
  check(rel.includes("dinheiro esperado em caixa") && rel.includes("dinheiro esperado no fecho"), "CaixaReport: rótulos de caixa aberto e fechado");
  check(dados.includes('.in("cash_register_id", lote)') && dados.includes("IDS_POR_CONSULTA = 50") && dados.includes("lerTodasAsPaginas(") && dados.includes("Promise.all(\n    lotes.map"), "cashCloseData: uma consulta paginada por lote de 50 sessões (não uma por sessão)");
}

// ---------- Parte B ----------
function loadEnvLocal() {
  const env = {};
  for (const line of readFileSync(resolve(process.cwd(), ".env.local"), "utf8").split(/\r?\n/)) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (!m) continue;
    let val = m[2].trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    env[m[1].trim()] = val;
  }
  return env;
}
const env = loadEnvLocal();
const admin = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const stamp = Date.now();
let userId = null;
let companyId = null;
try {
  const email = `guarni07+mf.cashclose.${stamp}@gmail.com`;
  const password = `Cls-${stamp}aA1!`;
  const { data: u } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  userId = u.user.id;
  const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  await sb.auth.signInWithPassword({ email, password });
  const { data: c } = await sb.rpc("bootstrap_company", { p_trade_name: `Fecha caixa ${stamp}`, p_email: email });
  companyId = typeof c === "string" ? c : c?.id;

  const novoCaixa = async (abertura) => {
    const { data, error } = await admin.from("cash_registers").insert({ company_id: companyId, status: "aberto", opening_balance: abertura, opened_at: new Date().toISOString() }).select("*").single();
    if (error) throw new Error(`caixa de teste: ${error.message}`);
    return data;
  };
  const vendaDb = (caixaId, payment_method, total, payments, status = "concluida") => ({
    company_id: companyId, cash_register_id: caixaId, status, payment_method, payments,
    items: [{ name: "item", price: total, quantity: 1, total }], client_id: randomUUID(),
  });
  // a mesma consulta que a tela faz (src/lib/cashCloseData.js)
  const vendasDaTela = (caixaId) => lerTodasAsPaginas(async (de, ate) => {
    const { data, error } = await sb.from("sales").select("id, client_id, status, total, payment_method, payments, cash_register_id")
      .eq("cash_register_id", caixaId).order("created_at", { ascending: true }).order("id", { ascending: true }).range(de, ate);
    if (error) throw error;
    return data;
  });

  // ----- caixa completo -----
  const caixa = await novoCaixa(100);
  const outroCaixa = await novoCaixa(0);
  const ref = randomUUID();
  const linhas = [
    vendaDb(caixa.id, "dinheiro", 10, [{ method: "dinheiro", amount: 10, label: "Dinheiro" }]),
    vendaDb(caixa.id, "pix", 20, [{ method: "pix", amount: 20 }]),
    vendaDb(caixa.id, "credito", 30, [{ method: "credito", amount: 30 }]),
    vendaDb(caixa.id, "debito", 40, [{ method: "debito", amount: 40 }]),
    vendaDb(caixa.id, "dinheiro", 100, [{ method: "dinheiro", amount: 25 }, { method: "pix", amount: 15 }, { method: "credito", amount: 60 }]),
    vendaDb(caixa.id, "dinheiro", 500, [{ method: "dinheiro", amount: 500 }], "cancelada"),
    vendaDb(caixa.id, "credito", 1, [{ method: "credito", amount: 1, provider: "connecttef", connectTefPaymentId: randomUUID(), connectTefReferencia: ref }]),
    vendaDb(caixa.id, "crediario", 7.5, []),
    vendaDb(outroCaixa.id, "dinheiro", 999, [{ method: "dinheiro", amount: 999 }]),
  ];
  const ins = await admin.from("sales").insert(linhas).select("id, total");
  if (ins.error) throw new Error(`vendas de teste: ${ins.error.message}`);

  // venda ConnectTEF aprovada de verdade, ligada à venda pelo RPC do checkout
  const vendaTef = (await admin.from("sales").select("id").eq("cash_register_id", caixa.id).eq("total", 1)).data[0].id;
  const pgTef = await admin.from("connecttef_payments").insert({ company_id: companyId, referencia: ref, smartpos_id: "POS-TESTE", documento_cliente: "11222333000181", valor_centavos: 100, forma_pagamento: "credito", status: "aprovado" }).select("id").single();
  const vinc = await sb.rpc("link_connecttef_payment_to_sale", { p_payment_id: pgTef.data.id, p_sale_id: vendaTef });
  check(!vinc.error && vinc.data === "linked", "venda ConnectTEF aprovada vinculada ao pagamento");

  // sangria e suprimento pelo mesmo RPC do app
  const sup = await sb.rpc("apply_cash_movement", { p_client_id: randomUUID(), p_cash_register_id: caixa.id, p_type: "suprimento", p_amount: 50, p_reason: "troco" });
  const san = await sb.rpc("apply_cash_movement", { p_client_id: randomUUID(), p_cash_register_id: caixa.id, p_type: "sangria", p_amount: 30, p_reason: "banco" });
  check(!sup.error && !san.error, `suprimento e sangria registrados pelo RPC (${sup.error?.message || san.error?.message || "ok"})`);
  await admin.from("cash_registers").update({ returns_total: 5 }).eq("id", caixa.id);
  const reg = (await admin.from("cash_registers").select("*").eq("id", caixa.id).single()).data;

  const vendas = await vendasDaTela(caixa.id);
  check(vendas.length === 8, `a consulta traz só as vendas deste caixa (8 com a cancelada; veio ${vendas.length})`);
  const t = totaisPorForma(vendas);
  check(igual(t.porForma.dinheiro, 35), `dinheiro = 10 + 25 da venda mista = 35 (veio ${t.porForma.dinheiro})`);
  check(igual(t.porForma.pix, 35), `PIX = 20 + 15 da venda mista = 35 (veio ${t.porForma.pix})`);
  check(igual(t.porForma.credito, 91), `crédito = 30 + 60 da venda mista + 1 ConnectTEF = 91 (veio ${t.porForma.credito})`);
  check(igual(t.porForma.debito, 40), `débito = 40 (veio ${t.porForma.debito})`);
  check(igual(t.porForma.crediario, 7.5), `crédito loja = 7,50 da venda antiga sem payments[] (veio ${t.porForma.crediario})`);
  check(igual(t.porForma.valepresente, 0) && t.outros === 0, "vale presente sem vendas = 0 e nada em 'outras formas'");
  check(igual(t.total, 208.5) && t.vendas === 7, `total vendido 208,50 em 7 vendas, sem a cancelada e sem o outro caixa (veio ${t.total} / ${t.vendas})`);
  check(!vendas.some((s) => s.cash_register_id !== caixa.id), "nenhuma venda de outro caixa");
  const gaveta = esperadoNaGaveta({ abertura: reg.opening_balance, vendasDinheiro: t.porForma.dinheiro, suprimentos: reg.supplies_total, sangrias: reg.withdrawals_total, devolucoesDinheiro: reg.returns_total });
  check(igual(reg.supplies_total, 50) && igual(reg.withdrawals_total, 30), "totais de suprimento e sangria vêm do caixa (atualizados pelo RPC)");
  check(igual(gaveta, 150), `gaveta: 100 + 35 + 50 − 30 − 5 = 150 (veio ${gaveta})`);
  const resumoTela = resumoDoCaixa(reg, vendas);
  check(igual(resumoTela.expectedInDrawer, gaveta) && igual(resumoTela.expectedInDrawer, 150), `CashRegister e Fechar Caixa dão o mesmo valor no caixa real: 150 (veio ${resumoTela.expectedInDrawer})`);
  check(!igual(Number(reg.opening_balance) + Number(reg.sales_total) + Number(reg.supplies_total) - Number(reg.withdrawals_total), resumoTela.expectedInDrawer), "a conta antiga da tela (abertura + sales_total + suprimentos − sangrias) dava outro valor neste caixa");
  // a venda ConnectTEF cai em crédito e não aumenta a gaveta
  const soTef = totaisPorForma(vendas.filter((s) => s.id === vendaTef));
  check(igual(soTef.porForma.credito, 1) && igual(soTef.porForma.dinheiro, 0) && igual(esperadoNaGaveta({ abertura: 100, vendasDinheiro: soTef.porForma.dinheiro }), 100), "venda ConnectTEF aprovada: entra em crédito e não aumenta o dinheiro da gaveta");
  // cancelar uma venda (como Sales.jsx faz) tira o valor dos totais
  const cancelar = await sb.from("sales").update({ status: "cancelada" }).eq("cash_register_id", caixa.id).eq("total", 40).select("id");
  const depois = totaisPorForma(await vendasDaTela(caixa.id));
  check(!cancelar.error && igual(depois.porForma.debito, 0) && igual(depois.total, 168.5), `cancelamento recalcula: débito 0 e total 168,50 (veio ${depois.porForma.debito} / ${depois.total})`);
  // comparação com a lógica antiga: ela atribuía a venda mista inteira a uma forma só
  const antigo = vendas.filter((s) => s.payment_method === "dinheiro" && s.status !== "cancelada").reduce((a, s) => a + s.total, 0);
  check(igual(antigo, 110) && !igual(antigo, t.porForma.dinheiro), "a lógica antiga (payment_method + total) dava 110 em dinheiro; a nova dá 35");

  // ----- devolução (parcial) e cancelamento -----
  const cxDev = await novoCaixa(100);
  const prod = randomUUID();
  const vendaDev = (await admin.from("sales").insert({
    company_id: companyId, cash_register_id: cxDev.id, status: "concluida", payment_method: "dinheiro", client_id: randomUUID(),
    payments: [{ method: "dinheiro", amount: 100 }], items: [{ product_id: prod, name: "item", quantity: 5, price: 20, total: 100 }],
  }).select("id").single()).data.id;
  const devolver = (qtd, metodo) => sb.from("sale_returns").insert({
    company_id: companyId, sale_id: vendaDev, refund_method: metodo,
    items: [{ product_id: prod, name: "item", quantity: qtd, unit_price: 999, total: 999999 }],
  }).select("refund_amount, refund_method").single();

  const d1 = await devolver(2, "dinheiro");
  check(!d1.error && igual(d1.data.refund_amount, 40), `devolução parcial em dinheiro (2 de 5 unidades) estorna 40 pelo preço da venda (veio ${d1.data?.refund_amount})`);
  // a tela (ReturnExchangeDialog) soma só devolução em DINHEIRO em returns_total do caixa aberto
  await admin.from("cash_registers").update({ returns_total: d1.data.refund_amount }).eq("id", cxDev.id);
  const d2 = await devolver(1, "pix");
  check(!d2.error && igual(d2.data.refund_amount, 20), `devolução parcial em PIX (mais 1 unidade) estorna 20 (veio ${d2.data?.refund_amount})`);
  const regDev = (await admin.from("cash_registers").select("*").eq("id", cxDev.id).single()).data;
  const tDev = totaisPorForma(await vendasDaTela(cxDev.id));
  const gavetaDev = esperadoNaGaveta({ abertura: regDev.opening_balance, vendasDinheiro: tDev.porForma.dinheiro, suprimentos: regDev.supplies_total, sangrias: regDev.withdrawals_total, devolucoesDinheiro: regDev.returns_total });
  check(igual(gavetaDev, 160), `devolução em dinheiro reduz a gaveta: 100 + 100 − 40 = 160; a de PIX não mexe (veio ${gavetaDev})`);
  check(igual(regDev.returns_total, 40), "returns_total só tem a devolução em dinheiro (PIX não entra)");
  const d3 = await devolver(3, "dinheiro");
  check(!!d3.error, `restante da venda: só sobram 2 unidades, devolver 3 é recusado (${d3.error?.message || "aceito!"})`);
  const d4 = await devolver(2, "dinheiro");
  check(!d4.error && igual(d4.data.refund_amount, 40), "devolver as 2 unidades restantes é aceito");
  // o guard do cancelamento (Sales.jsx) enxerga a devolução com a mesma consulta
  const devs = await sb.from("sale_returns").select("id").eq("sale_id", vendaDev).order("created_at", { ascending: false }).limit(1);
  check(!devs.error && devs.data.length === 1, "venda com devolução é detectada pela consulta do cancelamento");
  // venda cancelada (sem devolução) sai do total e não aceita devolução
  const vendaCanc = (await admin.from("sales").insert({
    company_id: companyId, cash_register_id: cxDev.id, status: "concluida", payment_method: "dinheiro", client_id: randomUUID(),
    payments: [{ method: "dinheiro", amount: 30 }], items: [{ product_id: prod, name: "item", quantity: 1, price: 30, total: 30 }],
  }).select("id").single()).data.id;
  check(igual(totaisPorForma(await vendasDaTela(cxDev.id)).porForma.dinheiro, 130), "antes de cancelar: dinheiro 100 + 30");
  await sb.from("sales").update({ status: "cancelada" }).eq("id", vendaCanc);
  check(igual(totaisPorForma(await vendasDaTela(cxDev.id)).porForma.dinheiro, 100), "venda cancelada sai do total em dinheiro");
  const devCanc = await sb.from("sale_returns").insert({ company_id: companyId, sale_id: vendaCanc, refund_method: "dinheiro", items: [{ product_id: prod, name: "item", quantity: 1, unit_price: 30, total: 30 }] });
  check(!!devCanc.error, "venda cancelada não aceita devolução");
  { // código: o cancelamento confere devoluções ANTES de nota fiscal/estoque/status
    const sales = readFileSync(resolve(process.cwd(), "src/pages/Sales.jsx"), "utf8").split("\r\n").join("\n");
    const iGuard = sales.indexOf("api.entities.SaleReturn.filter({ sale_id: sale.id }");
    check(iGuard > 0 && iGuard < sales.indexOf("bloqueioFiscalDaVenda(sale.id)") && iGuard < sales.indexOf('status: "cancelada"'), "Sales.jsx: a checagem de devolução vem antes da nota fiscal, do estoque e do status");
    const dlg = readFileSync(resolve(process.cwd(), "src/components/sales/ReturnExchangeDialog.jsx"), "utf8").split("\r\n").join("\n");
    check(dlg.includes('if (refundMethod === "dinheiro") {') && dlg.includes("returns_total: (register.returns_total || 0) + refundAmount"), "ReturnExchangeDialog: só devolução em dinheiro mexe em returns_total do caixa");
  }

  // ----- caixa sem vendas -----
  const vazio = await novoCaixa(80);
  const tv = totaisPorForma(await vendasDaTela(vazio.id));
  check(tv.total === 0 && tv.vendas === 0 && igual(esperadoNaGaveta({ abertura: 80, vendasDinheiro: tv.porForma.dinheiro }), 80), "caixa sem vendas: totais zero e esperado = abertura");

  // ----- caixa com mais de mil vendas -----
  const grande = await novoCaixa(0);
  const lote = Array.from({ length: 1005 }, () => vendaDb(grande.id, "dinheiro", 1, [{ method: "dinheiro", amount: 1 }]));
  const insG = await admin.from("sales").insert(lote);
  if (insG.error) throw new Error(`lote de vendas: ${insG.error.message}`);
  const tg = totaisPorForma(await vendasDaTela(grande.id));
  check(tg.vendas === 1005 && igual(tg.porForma.dinheiro, 1005), `caixa com 1005 vendas: nenhuma fica de fora (veio ${tg.vendas})`);
  const cortada = await sb.from("sales").select("id").eq("cash_register_id", grande.id).limit(100);
  check((cortada.data || []).length === 100, "sem paginação a consulta antiga (limite 100) perderia 905 vendas");

  // ----- relatório: sessões aberta, fechada, vazia e grande, buscadas em lote -----
  const fechado = await novoCaixa(20);
  await admin.from("sales").insert([
    vendaDb(fechado.id, "dinheiro", 40, [{ method: "dinheiro", amount: 40 }]),
    vendaDb(fechado.id, "pix", 60, [{ method: "pix", amount: 60 }]),
  ]);
  await admin.from("cash_registers").update({ supplies_total: 10, withdrawals_total: 5, status: "fechado", closing_balance: 100, closed_at: new Date().toISOString() }).eq("id", fechado.id);
  const vazioRel = await novoCaixa(80);
  const regsRel = (await admin.from("cash_registers").select("*").in("id", [caixa.id, fechado.id, vazioRel.id, grande.id])).data;
  // mesma consulta de carregarVendasDasSessoes (src/lib/cashCloseData.js), contando as chamadas
  let consultas = 0;
  const idsRel = regsRel.map((r) => r.id);
  const vendasRel = await lerTodasAsPaginas(async (de, ate) => {
    consultas++;
    const { data, error } = await sb.from("sales").select("id, client_id, status, total, payment_method, payments, cash_register_id")
      .in("cash_register_id", idsRel).order("created_at", { ascending: true }).order("id", { ascending: true }).range(de, ate);
    if (error) throw error;
    return data;
  });
  const porCaixa = new Map(idsRel.map((id) => [id, []]));
  for (const x of vendasRel) porCaixa.get(String(x.cash_register_id))?.push(x);
  const esperadoDe = (id) => resumoDoCaixa(regsRel.find((r) => r.id === id), porCaixa.get(id)).expectedInDrawer;
  check(consultas === 2 && vendasRel.length > 1000, `4 sessões e ${vendasRel.length} vendas vieram em ${consultas} consultas paginadas (não uma por sessão)`);
  check(igual(esperadoDe(caixa.id), 150), `relatório, sessão ABERTA: 150, igual ao Fechar Caixa (veio ${esperadoDe(caixa.id)})`);
  check(igual(esperadoDe(fechado.id), 65), `relatório, sessão FECHADA: 20 + 40 em dinheiro + 10 − 5 = 65, sem os 60 de PIX (veio ${esperadoDe(fechado.id)})`);
  const regFechado = regsRel.find((r) => r.id === fechado.id);
  const contaAntigaFechado = Number(regFechado.opening_balance) + Number(regFechado.sales_total) + Number(regFechado.supplies_total) - Number(regFechado.withdrawals_total);
  check(igual(contaAntigaFechado, 125) && !igual(contaAntigaFechado, esperadoDe(fechado.id)), "a conta antiga do relatório dava 125 para essa sessão fechada; a nova dá 65");
  check(igual(esperadoDe(vazioRel.id), 80) && porCaixa.get(vazioRel.id).length === 0, "relatório, sessão sem vendas: esperado = abertura (80)");
  check(igual(esperadoDe(grande.id), 1005), "relatório, sessão com mais de mil vendas: 1005 em dinheiro, nenhuma perdida");
  check([...porCaixa.keys()].every((id) => porCaixa.get(id).every((x) => String(x.cash_register_id) === id)), "cada venda foi agrupada na sessão certa (cash_register_id)");
} catch (e) {
  falhas.push(`Parte B abortou: ${e.message}`);
} finally {
  if (companyId) await admin.from("companies").delete().eq("id", companyId);
  if (userId) await admin.auth.admin.deleteUser(userId);
}

console.log("\nSmoke — Fechar Caixa (valores calculados)\n");
for (const m of ok) console.log(`  PASS  ${m}`);
for (const m of falhas) console.log(`  FAIL  ${m}`);
console.log(`\n${ok.length} passaram, ${falhas.length} falharam\n`);
process.exit(falhas.length ? 1 : 0);
