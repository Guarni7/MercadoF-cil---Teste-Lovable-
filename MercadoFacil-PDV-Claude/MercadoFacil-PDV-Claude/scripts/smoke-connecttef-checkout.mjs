/**
 * Smoke da integração do ConnectTEF ao checkout.
 *
 * Parte A (sem rede): CobrancaTef e as validações de venda de src/lib/connectTefCheckout.js
 * com dependências falsas — aprovado, recusado, falha, indeterminado, aprovado antes/depois
 * do 202, evento duplicado, duplo clique, Smart POS ausente, offline, chave de idempotência
 * e "venda só depois de aprovado".
 * Parte B (Supabase real, empresas de teste apagadas no fim): RPC
 * link_connecttef_payment_to_sale (vínculo pagamento→venda).
 * O servidor (webhook, 202, idempotência, corrida) é coberto por smoke-connecttef-payments.mjs.
 *
 * Uso: node scripts/smoke-connecttef-checkout.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";
import { readFileSync } from "fs";
import { resolve } from "path";
import { CobrancaTef, estadoConnectTef, MSG_OFFLINE_SMARTPOS, valorParaCentavos, validarPagamentosParaVenda, vincularPagamentosDaVenda } from "../src/lib/connectTefCheckout.js";

const falhas = [];
const ok = [];
const check = (cond, msg) => (cond ? ok.push(msg) : falhas.push(msg));
const tick = () => new Promise((r) => setImmediate(r));
async function ate(cond, max = 500) {
  for (let i = 0; i < max && !cond(); i++) await tick();
  return cond();
}

// ---------- Parte A ----------
function cenario({ solicitar, linhas = [], online = true }) {
  const chamadas = { solicitar: [], buscar: 0 };
  const transicoes = [];
  let i = 0;
  const c = new CobrancaTef({
    solicitar: async (p) => { chamadas.solicitar.push(p); return solicitar(p, chamadas.solicitar.length); },
    buscar: async () => { chamadas.buscar++; const l = linhas[Math.min(i++, linhas.length - 1)]; if (l instanceof Error) throw l; return l; },
    online: () => online,
    uuid: randomUUID,
    esperar: tick,
    onChange: (e) => transicoes.push(e.fase),
  });
  return { c, chamadas, transicoes };
}
const op202 = async () => ({ id: "op-1", referencia: "ref-1", status: "processando" });
const pedido = { valorReais: 10, formaPagamento: "credito", parcelas: 1 };
const erroCom = (body, msg = "erro") => Object.assign(new Error(msg), { body });

check(valorParaCentavos(10.1) === 1010 && valorParaCentavos(0.29) === 29 && valorParaCentavos(19.99) === 1999, "valor em reais vira centavos inteiros sem erro de ponto flutuante");

{ // aprovado — 202 NÃO aprova
  const s = cenario({ solicitar: op202, linhas: [{ status: "processando" }, { status: "processando" }, { status: "aprovado", valor_centavos: 1000 }] });
  await s.c.iniciar(pedido);
  check(s.c.estado.fase === "aguardando", "depois do 202 a fase é 'aguardando' (não aprovado)");
  check(s.transicoes.includes("aguardando") && !s.transicoes.slice(0, s.transicoes.indexOf("aguardando")).includes("aprovado"), "202 sozinho nunca aprova");
  check(await ate(() => s.c.estado.fase === "aprovado"), "aprovado: segue consultando até 'aprovado'");
  check(s.c.estado.op.id === "op-1" && s.chamadas.solicitar.length === 1, "aprovado: uma só solicitação e a operação fica guardada");
  s.c.parar();
}
{ // recusado
  const s = cenario({ solicitar: op202, linhas: [{ status: "recusado", motivo: "Saldo insuficiente" }] });
  await s.c.iniciar(pedido);
  check(await ate(() => s.c.estado.fase === "recusado"), "recusado: fase 'recusado'");
  check(s.c.estado.erro === "Saldo insuficiente", "recusado: mostra o motivo");
  const chave1 = s.chamadas.solicitar[0].chaveIdempotencia;
  await s.c.iniciar(pedido);
  check(s.chamadas.solicitar.length === 2 && s.chamadas.solicitar[1].chaveIdempotencia !== chave1, "recusado: nova tentativa usa chave de idempotência nova");
  s.c.parar();
}
{ // falhou (4xx no envio)
  const s = cenario({ solicitar: async () => { throw erroCom({ id: "op-9", status: "falhou", error: "Dados inválidos" }); } });
  await s.c.iniciar(pedido);
  check(s.c.estado.fase === "falhou" && s.c.estado.erro === "Dados inválidos", "falhou: fase 'falhou' com a mensagem");
  check(!s.c.emAndamento && s.chamadas.buscar === 0, "falhou: não fica consultando nem finaliza");
}
{ // falhou depois, visto pelo banco
  const s = cenario({ solicitar: op202, linhas: [{ status: "falhou", erro: "Smart POS recusou o pedido" }] });
  await s.c.iniciar(pedido);
  check(await ate(() => s.c.estado.fase === "falhou"), "falhou (lido do banco): fase 'falhou'");
}
{ // indeterminado: nunca cobra sozinho
  const s = cenario({
    solicitar: async () => { throw erroCom({ id: "op-3", status: "indeterminado", error: "Sem resposta do ConnectTEF" }); },
    linhas: [{ status: "indeterminado" }],
  });
  await s.c.iniciar(pedido);
  check(s.c.estado.fase === "indeterminado", "indeterminado: fase 'indeterminado'");
  for (let i = 0; i < 50; i++) await tick();
  await s.c.iniciar(pedido);
  await s.c.iniciar(pedido);
  check(s.chamadas.solicitar.length === 1, "indeterminado: nenhuma nova cobrança (nem por clique, nem automática)");
  check(s.c.emAndamento && s.chamadas.buscar > 1, "indeterminado: continua consultando");
  s.c.buscar = async () => ({ status: "aprovado", valor_centavos: 1000 });
  check(await ate(() => s.c.estado.fase === "aprovado"), "indeterminado: se depois chega a aprovação, vira 'aprovado'");
  s.c.parar();
}
{ // aprovado ANTES do 202 (webhook mais rápido que a resposta)
  const s = cenario({ solicitar: op202, linhas: [{ status: "aprovado", valor_centavos: 1000 }] });
  await s.c.iniciar(pedido);
  check(await ate(() => s.c.estado.fase === "aprovado"), "aprovado antes do 202: termina 'aprovado'");
  check(s.chamadas.solicitar.length === 1, "aprovado antes do 202: sem nova cobrança");
}
{ // evento duplicado: aprovado repetido não muda nada
  const s = cenario({ solicitar: op202, linhas: [{ status: "aprovado", valor_centavos: 1000 }] });
  await s.c.iniciar(pedido);
  await ate(() => s.c.estado.fase === "aprovado");
  await s.c.verificarAgora();
  await s.c.verificarAgora();
  check(s.c.estado.fase === "aprovado" && s.chamadas.solicitar.length === 1, "evento duplicado: continua aprovado, sem nova cobrança");
  await s.c.iniciar(pedido);
  check(s.chamadas.solicitar.length === 1, "aprovado: novo clique em Enviar não cobra de novo");
}
{ // duplo clique
  let liberar;
  const trava = new Promise((r) => (liberar = r));
  const s = cenario({ solicitar: async () => { await trava; return op202(); }, linhas: [{ status: "processando" }] });
  const p1 = s.c.iniciar(pedido);
  const p2 = s.c.iniciar(pedido);
  const p3 = s.c.iniciar(pedido);
  liberar();
  await Promise.all([p1, p2, p3]);
  check(s.chamadas.solicitar.length === 1, "duplo clique: uma única solicitação");
  s.c.parar();
}
{ // Smart POS ausente / ConnectTEF indisponível: erro sem operação, retry seguro com a mesma chave
  const s = cenario({ solicitar: async () => { throw erroCom({ error: "Nenhum Smart POS vinculado" }, "Nenhum Smart POS vinculado"); } });
  await s.c.iniciar(pedido);
  check(s.c.estado.fase === "erro" && /Smart POS/.test(s.c.estado.erro), "Smart POS ausente: fase 'erro' com a mensagem");
  check(s.c.estado.op === null && s.chamadas.buscar === 0, "Smart POS ausente: nenhuma operação, nenhuma consulta");
  await s.c.iniciar(pedido);
  check(s.chamadas.solicitar[0].chaveIdempotencia === s.chamadas.solicitar[1].chaveIdempotencia, "erro sem operação: retry reaproveita a chave (não cobra em dobro)");
}
{ // offline
  const s = cenario({ solicitar: op202, online: false });
  await s.c.iniciar(pedido);
  check(s.c.estado.fase === "offline" && s.chamadas.solicitar.length === 0, "offline: não inicia a cobrança");
}
{ // valor inválido
  const s = cenario({ solicitar: op202 });
  await s.c.iniciar({ ...pedido, valorReais: 0 });
  check(s.c.estado.fase === "erro" && s.chamadas.solicitar.length === 0, "valor zero: não cobra");
}
{ // parcelas
  const s = cenario({ solicitar: op202, linhas: [{ status: "processando" }] });
  await s.c.iniciar({ valorReais: 30, formaPagamento: "credito", parcelas: 3 });
  const p = s.chamadas.solicitar[0];
  check(p.valorCentavos === 3000 && p.parcelas === 3 && p.parcelamento === "estabelecimento" && p.formaPagamento === "credito", "parcelado: centavos, parcelas e parcelamento corretos");
  s.c.parar();
}
{ // abandonar só depois do aviso de espera longa
  let t = 0;
  const s = cenario({ solicitar: op202, linhas: [{ status: "processando" }] });
  s.c.agora = () => t;
  s.c.avisoLongoMs = 1000;
  await s.c.iniciar(pedido);
  check(s.c.abandonar() === false && s.c.emAndamento, "abandonar antes do aviso de espera: não permitido");
  t = 5000;
  await ate(() => s.c.estado.longa);
  check(s.c.estado.longa === true, "espera longa: aviso ligado");
  check(s.c.abandonar() === true && s.c.estado.fase === "ocioso", "abandonar depois do aviso: volta a 'ocioso'");
}

// ---------- venda só depois de aprovado ----------
const pg = (extra = {}) => ({ method: "credito", amount: 10, provider: "connecttef", connectTefPaymentId: "p1", ...extra });
const buscaCom = (row) => async () => row;
check((await validarPagamentosParaVenda([pg()], buscaCom({ status: "aprovado", sale_id: null, valor_centavos: 1000 }))).ok, "venda liberada: pagamento aprovado, sem venda, valor igual");
for (const st of ["pendente", "processando", "indeterminado", "recusado", "falhou"]) {
  check(!(await validarPagamentosParaVenda([pg()], buscaCom({ status: st, sale_id: null, valor_centavos: 1000 }))).ok, `venda bloqueada: pagamento '${st}'`);
}
check(!(await validarPagamentosParaVenda([pg()], buscaCom({ status: "aprovado", sale_id: "x", valor_centavos: 1000 }))).ok, "venda bloqueada: pagamento já usado em outra venda");
check(!(await validarPagamentosParaVenda([pg()], buscaCom({ status: "aprovado", sale_id: null, valor_centavos: 999 }))).ok, "venda bloqueada: valor diferente do lançado");
check(!(await validarPagamentosParaVenda([pg()], buscaCom(null))).ok, "venda bloqueada: pagamento não encontrado");
check(!(await validarPagamentosParaVenda([pg()], async () => { throw new Error("rede"); })).ok, "venda bloqueada: não conseguiu confirmar no servidor");
check(!(await validarPagamentosParaVenda([pg(), pg()], buscaCom({ status: "aprovado", sale_id: null, valor_centavos: 1000 }))).ok, "venda bloqueada: mesma operação lançada duas vezes");
check((await validarPagamentosParaVenda([{ method: "dinheiro", amount: 5 }], async () => { throw new Error("não deveria consultar"); })).ok, "pagamento sem ConnectTEF: nem consulta o servidor");
{
  const vinc = [];
  const r = await vincularPagamentosDaVenda([pg(), { method: "dinheiro", amount: 1 }, pg({ connectTefPaymentId: "p2" })], "sale-1", async (id, s) => { vinc.push([id, s]); if (id === "p2") throw new Error("falhou"); });
  check(vinc.length === 2 && vinc[0][1] === "sale-1" && !r.ok && r.falhas.length === 1, "vínculo: tenta cada pagamento ConnectTEF e relata falhas");
}


// ---------- Smart POS ativo? (nunca cair no TEF antigo sem saber) ----------
{
  const e = (o) => estadoConnectTef({ demo: false, servidor: null, cache: null, ...o });
  // Smart POS + online (servidor manda; cache vazio ou preenchido não muda)
  check(e({ online: true, servidor: true, cache: null }) === "ativo", "Smart POS + online + cache vazio: ConnectTEF");
  check(e({ online: true, servidor: true, cache: true }) === "ativo", "Smart POS + online + cache preenchido: ConnectTEF");
  check(e({ online: true, servidor: true, cache: false }) === "ativo", "Smart POS + online: o servidor vence um cache velho 'sem Smart POS'");
  // Smart POS + offline
  check(e({ online: false, cache: true }) === "ativo", "Smart POS + offline + cache preenchido: ConnectTEF (a cobrança será bloqueada, não trocada)");
  check(e({ online: false, cache: null }) === "indeterminado", "Smart POS + offline + cache vazio: indeterminado (bloqueia cartão)");
  // empresa sem Smart POS
  check(e({ online: true, servidor: false, cache: true }) === "inativo", "sem Smart POS + online: comportamento atual (servidor vence cache velho)");
  check(e({ online: false, cache: false }) === "inativo", "sem Smart POS confirmado antes + offline: comportamento atual");
  check(e({ online: true, servidor: false }) === "inativo", "sem Smart POS + online + cache vazio: comportamento atual");
  // servidor sem resposta
  check(e({ online: true, servidor: null, cache: null }) === "indeterminado", "servidor sem resposta + cache vazio: indeterminado");
  check(e({ online: true, servidor: null, cache: false }) === "indeterminado", "servidor sem resposta + cache 'sem Smart POS': indeterminado (cache não vale como segurança)");
  check(e({ online: true, servidor: null, cache: true }) === "ativo", "servidor sem resposta + cache 'com Smart POS': ConnectTEF (a cobrança exige o servidor e falha sem aprovar)");
  // conta demo
  check(e({ demo: true, online: false }) === "inativo", "conta demo: comportamento atual");
  // nenhum estado diferente de 'inativo' libera o TEF antigo
  const todos = [];
  for (const online of [true, false]) for (const servidor of [true, false, null]) for (const cache of [true, false, null]) todos.push([e({ online, servidor, cache }), servidor, online, cache]);
  check(todos.every(([est, srv, on]) => est !== "inativo" || (on ? srv === false : true)), "online: o TEF antigo só roda quando o SERVIDOR disse 'sem Smart POS'");
  check(MSG_OFFLINE_SMARTPOS === "Conexão com a internet necessária para pagamento no Smart POS.", "mensagem de bloqueio offline");
}
{ // offline com Smart POS: nenhuma operação criada, mensagem certa
  const s2 = cenario({ solicitar: op202, online: false });
  await s2.c.iniciar({ valorReais: 1, formaPagamento: "debito", parcelas: 1 });
  await s2.c.iniciar({ valorReais: 1, formaPagamento: "credito", parcelas: 1 });
  check(s2.chamadas.solicitar.length === 0 && s2.chamadas.buscar === 0 && s2.c.estado.erro === MSG_OFFLINE_SMARTPOS && s2.c.estado.op === null, "bloqueio offline (crédito e débito): nenhuma cobrança criada e mensagem exibida");
}
{ // ligação no CheckoutDialog/PDV (análise estática): sem aprovação fabricada, dinheiro/PIX intocados
  const ler = (p) => readFileSync(resolve(process.cwd(), p), "utf8").split("\r\n").join("\n");
  const dlg = ler("src/components/pos/CheckoutDialog.jsx");
  const pdv = ler("src/pages/PDV.jsx");
  check(dlg.includes('const cardApproved = usaCtef ? ctef.fase === "aprovado" : (usaTef || usaMaq) && cardStatus === TefStatus.APPROVED;'), "checkout: cartão só conta como aprovado via ConnectTEF aprovado (webhook), retorno do agente TEF ou confirmação explícita da maquininha");
  check(dlg.includes("const startCardPayment = async () => {\n    if (!usaTef) return;"), "checkout: startCardPayment (TEF) só roda com o canal tef liberado");
  check(/\{usaTef && \(\n\s+<div className="space-y-3">/.test(dlg), "checkout: bloco do TEF só renderiza com o canal tef liberado");
  check(dlg.includes('const ehCartao = method === "credito" || method === "debito";\n  const cartaoOk = ehCartao && resolucao.liberado;\n  const usaCtef = cartaoOk && canalCartao === "smartpos";'), "checkout: ConnectTEF só afeta crédito/débito e só com o canal smartpos liberado (dinheiro e PIX intocados)");
  check(dlg.includes("<ConnectTefCardPanel") && dlg.includes("useCobrancaTef(open)") && dlg.includes('provider: "connecttef", connectTefPaymentId: ctef.op.id'), "checkout: o painel e o registro do pagamento ConnectTEF continuam como na homologação");
  check(pdv.includes('p.provider === "connecttef" || p.channel === "smartpos"') && !pdv.includes("cartaoLivreDoConnectTef"), "PDV: venda offline com pagamento do Smart POS continua bloqueada");
}

// ---------- Parte B: RPC de vínculo ----------
function loadEnvLocal() {
  const raw = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
  const env = {};
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    env[m[1].trim()] = v;
  }
  return env;
}
const env = loadEnvLocal();
const admin = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const stamp = Date.now();
const usuarios = [];
const empresas = [];
const novoSb = () => createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
async function empresa(tag) {
  const email = `guarni07+mf.ctefchk.${tag}.${stamp}@gmail.com`;
  const password = `Chk-${stamp}aA1!`;
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  usuarios.push(data.user.id);
  const sb = novoSb();
  await sb.auth.signInWithPassword({ email, password });
  const { data: c } = await sb.rpc("bootstrap_company", { p_trade_name: `Checkout ${tag} ${stamp}`, p_email: email });
  const companyId = typeof c === "string" ? c : c?.id;
  empresas.push(companyId);
  return { sb, companyId };
}
try {
  const A = await empresa("a");
  const B = await empresa("b");
  const venda = async (companyId, total) => {
    const { data, error } = await admin.from("sales").insert({ company_id: companyId, total, subtotal: total, items: [{ name: "item teste", price: total, quantity: 1, total }], payment_method: "credito", status: "concluida" }).select("id").single();
    if (error) throw new Error(`venda de teste: ${error.message}`);
    return data.id;
  };
  const pagamento = async (companyId, status, valor) => {
    const { data, error } = await admin.from("connecttef_payments").insert({
      company_id: companyId, referencia: randomUUID(), smartpos_id: "POS-TESTE", documento_cliente: "11222333000181",
      valor_centavos: valor, forma_pagamento: "credito", status,
    }).select("id").single();
    if (error) throw new Error(`pagamento de teste: ${error.message}`);
    return data.id;
  };
  const vendaA1 = await venda(A.companyId, 10);
  const vendaA2 = await venda(A.companyId, 10);
  const vendaB = await venda(B.companyId, 10);
  const pAprovado = await pagamento(A.companyId, "aprovado", 1000);
  const link = (u, p, v) => u.sb.rpc("link_connecttef_payment_to_sale", { p_payment_id: p, p_sale_id: v });

  const r1 = await link(A, pAprovado, vendaA1);
  check(!r1.error && r1.data === "linked", `RPC: vincula pagamento aprovado à venda (${r1.error?.message})`);
  const row = (await admin.from("connecttef_payments").select("sale_id, sale_linked_at").eq("id", pAprovado)).data?.[0];
  check(row?.sale_id === vendaA1 && !!row?.sale_linked_at, "RPC: sale_id e sale_linked_at gravados");
  const r2 = await link(A, pAprovado, vendaA1);
  check(!r2.error && r2.data === "already_linked", "RPC: repetir na mesma venda é idempotente");
  const r3 = await link(A, pAprovado, vendaA2);
  check(!!r3.error && /outra venda/.test(r3.error.message), "RPC: segunda venda com o mesmo pagamento é recusada");
  check((await admin.from("connecttef_payments").select("sale_id").eq("id", pAprovado)).data?.[0]?.sale_id === vendaA1, "RPC: a venda original continua vinculada");

  const pProc = await pagamento(A.companyId, "processando", 1000);
  const r4 = await link(A, pProc, vendaA2);
  check(!!r4.error && /não está aprovado/.test(r4.error.message), "RPC: pagamento não aprovado não vincula");
  const pAlto = await pagamento(A.companyId, "aprovado", 5000);
  const r5 = await link(A, pAlto, vendaA2);
  check(!!r5.error && /maior que o total/.test(r5.error.message), "RPC: valor maior que o total da venda é recusado");
  const pOutra = await pagamento(A.companyId, "aprovado", 1000);
  const r6 = await link(A, pOutra, vendaB);
  check(!!r6.error, "RPC: venda de outra empresa é recusada");
  const r7 = await link(B, pOutra, vendaB);
  check(!!r7.error, "RPC: pagamento de outra empresa é recusado");
  const anon = await novoSb().rpc("link_connecttef_payment_to_sale", { p_payment_id: pOutra, p_sale_id: vendaA2 });
  check(!!anon.error, "RPC: anônimo não executa");
  const escrita = await A.sb.from("connecttef_payments").update({ sale_id: vendaA2 }).eq("id", pOutra).select();
  check(!!escrita.error || (escrita.data || []).length === 0, "navegador não escreve em connecttef_payments");
} catch (e) {
  falhas.push(`Parte B abortou: ${e.message}`);
} finally {
  for (const id of empresas) if (id) await admin.from("companies").delete().eq("id", id);
  for (const id of usuarios) await admin.auth.admin.deleteUser(id);
}

console.log("\nSmoke — ConnectTEF no checkout (controlador, validação da venda, vínculo)\n");
for (const m of ok) console.log(`  PASS  ${m}`);
for (const m of falhas) console.log(`  FAIL  ${m}`);
console.log(`\n${ok.length} passaram, ${falhas.length} falharam\n`);
process.exit(falhas.length ? 1 : 0);
