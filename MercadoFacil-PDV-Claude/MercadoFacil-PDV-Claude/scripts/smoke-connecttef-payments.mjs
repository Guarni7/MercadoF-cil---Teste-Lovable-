/**
 * Smoke da solicitação de pagamento do ConnectTEF: connecttef-request-payment
 * (POST /v1/payments) + connecttef-webhook (pagamento.aprovado / .recusado) +
 * RLS de connecttef_payments.
 *
 * Auto-contido e SEM chamar o ConnectTEF real: sobe um ConnectTEF simulado (mock)
 * e as Edge Functions localmente (deno), com API Key e token de webhook de TESTE
 * gerados na hora. Banco = Supabase real (empresas de teste apagadas no fim).
 * Requer `deno` no PATH.
 *
 * O valor pedido escolhe a resposta do mock: 111=400, 222=401, 333=403 do gateway,
 * 444=404 SMARTPOS_NAO_ENCONTRADO, 555=500, 666=409, 777=sem resposta (acima do
 * timeout de 25 s), 888=202 atrasado (1,5 s), 1200=202 em 12 s (acima dos 10 s do
 * timeout antigo), 999=403 CLIENTE_NAO_AUTORIZADO; qualquer outro = 202.
 *
 * Uso: node scripts/smoke-connecttef-payments.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { createServer } from "http";
import { spawn } from "child_process";
import { randomBytes, randomUUID } from "crypto";
import { readFileSync } from "fs";
import { resolve } from "path";

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
const falhas = [];
const ok = [];
const check = (cond, msg) => (cond ? ok.push(msg) : falhas.push(msg));
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

const API_KEY = `teste-key-${randomBytes(12).toString("hex")}`;
const WEBHOOK_TOKEN = `teste-tok-${randomBytes(12).toString("hex")}`;
const PORTAS = { mock: 8205, pagar: 8206, pagarSemChave: 8207, webhook: 8203 };
const DOC_A = "11222333000181";
const DOC_B = "11444777000161";

// ---------- ConnectTEF simulado ----------
const recebidas = [];
const mock = createServer((req, res) => {
  let corpo = "";
  req.on("data", (c) => (corpo += c));
  req.on("end", async () => {
    const registro = { metodo: req.method, caminho: req.url, apiKey: req.headers["x-api-key"], corpo: corpo ? JSON.parse(corpo) : null, existiaPendente: null };
    recebidas.push(registro);
    const responder = (status, obj) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(obj));
    };
    if (req.method !== "POST" || req.url !== "/v1/payments") return responder(404, { message: "Not Found" });
    if (registro.apiKey !== API_KEY) return responder(403, { message: "Forbidden" });
    // A operação precisa estar gravada ANTES de a chamada chegar ao ConnectTEF.
    const { data } = await admin.from("connecttef_payments").select("status").eq("referencia", registro.corpo.referencia).maybeSingle();
    registro.existiaPendente = data?.status ?? null;
    const v = registro.corpo.valorCentavos;
    if (v === 111) return responder(400, { codigo: "CAMPO_OBRIGATORIO" });
    if (v === 222) return responder(401, { codigo: "API_KEY_INVALIDA" });
    if (v === 333) return responder(403, { message: "Forbidden" });
    if (v === 444) return responder(404, { codigo: "SMARTPOS_NAO_ENCONTRADO" });
    if (v === 555) return responder(500, { codigo: "ERRO_INTERNO" });
    if (v === 666) return responder(409, { codigo: "REFERENCIA_DUPLICADA" });
    if (v === 999) return responder(403, { codigo: "CLIENTE_NAO_AUTORIZADO" });
    if (v === 777) return setTimeout(() => responder(202, {}), 27_000);
    if (v === 888) await espera(1500);
    if (v === 1200) await espera(12_000);
    return responder(202, {
      referencia: registro.corpo.referencia,
      status: "processando",
      mensagem: "Pagamento enviado",
      targets: [{ smartposId: registro.corpo.smartposId, status: "enviado" }],
    });
  });
});
await new Promise((r) => mock.listen(PORTAS.mock, "127.0.0.1", r));

// ---------- funções locais ----------
const filhos = [];
let logsFuncoes = "";
const subir = (funcao, porta, extra) => {
  const p = spawn("deno", ["run", "-A", resolve(process.cwd(), `supabase/functions/${funcao}/index.ts`)], {
    env: {
      ...process.env,
      SUPABASE_URL: env.VITE_SUPABASE_URL,
      SUPABASE_ANON_KEY: env.VITE_SUPABASE_ANON_KEY,
      SUPABASE_SERVICE_ROLE_KEY: env.SUPABASE_SERVICE_ROLE_KEY,
      DENO_SERVE_ADDRESS: `tcp:127.0.0.1:${porta}`,
      ...extra,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  p.stdout.on("data", (d) => (logsFuncoes += d));
  p.stderr.on("data", (d) => (logsFuncoes += d));
  filhos.push(p);
};
subir("connecttef-request-payment", PORTAS.pagar, { CONNECTTEF_API_KEY: API_KEY, CONNECTTEF_API_BASE: `http://127.0.0.1:${PORTAS.mock}` });
subir("connecttef-request-payment", PORTAS.pagarSemChave, { CONNECTTEF_API_BASE: `http://127.0.0.1:${PORTAS.mock}` });
subir("connecttef-webhook", PORTAS.webhook, { CONNECTTEF_WEBHOOK_TOKEN: WEBHOOK_TOKEN });
for (const porta of [PORTAS.pagar, PORTAS.pagarSemChave, PORTAS.webhook]) {
  for (let i = 0; i < 60; i++) {
    try {
      await fetch(`http://127.0.0.1:${porta}`, { method: "OPTIONS" });
      break;
    } catch {
      await espera(1000);
    }
  }
}

// ---------- empresas e usuários ----------
const stamp = Date.now();
const usuarios = [];
async function entrar(tag) {
  const email = `guarni07+mf.ctefpay.${tag}.${stamp}@gmail.com`;
  const password = `Cpy-${stamp}aA1!`;
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  usuarios.push(data.user.id);
  const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: s } = await sb.auth.signInWithPassword({ email, password });
  return { sb, id: data.user.id, email, token: s.session.access_token };
}
async function empresa(tag) {
  const u = await entrar(tag);
  const { data } = await u.sb.rpc("bootstrap_company", { p_trade_name: `Pagamento ${tag} ${stamp}`, p_email: u.email });
  u.companyId = typeof data === "string" ? data : data?.id;
  return u;
}
const A = await empresa("a");
const B = await empresa("b");
const D = await empresa("d"); // sem Smart POS vinculado
const C = await entrar("caixa");
await admin.from("profiles").update({ company_id: A.companyId, role: "user", company_role: "operator" }).eq("id", C.id);

// Smart POS vinculados direto no banco (o pareamento tem smoke próprio).
await admin.from("connecttef_smartpos").insert([
  { company_id: A.companyId, documento_cliente: DOC_A, referencia: randomUUID(), smartpos_id: "POS-HML-APROVADO", status: "vinculado", linked_at: new Date().toISOString() },
  { company_id: B.companyId, documento_cliente: DOC_B, referencia: randomUUID(), smartpos_id: "POS-DA-EMPRESA-B", status: "vinculado", linked_at: new Date().toISOString() },
]);

const zerarLimite = () => admin.from("rate_limit_hits").delete().or([A, B, D].map((t) => `key.like.%${t.companyId}%`).join(","));
const pagar = async (usuario, body, porta = PORTAS.pagar, headers = {}) => {
  await zerarLimite();
  const h = { "Content-Type": "application/json", apikey: env.VITE_SUPABASE_ANON_KEY, ...headers };
  if (usuario) h.Authorization = `Bearer ${usuario.token}`;
  const res = await fetch(`http://127.0.0.1:${porta}`, { method: "POST", headers: h, body: JSON.stringify(body) });
  return { httpStatus: res.status, ...(await res.json().catch(() => ({}))) };
};
const evento = async ({ id, tipo, corpo, token = WEBHOOK_TOKEN }) => {
  const h = { "Content-Type": "application/json" };
  if (token) h.Authorization = `Bearer ${token}`;
  if (id) h["X-ConnectTEF-Event-Id"] = id;
  if (tipo) h["X-ConnectTEF-Event-Type"] = tipo;
  const res = await fetch(`http://127.0.0.1:${PORTAS.webhook}`, { method: "POST", headers: h, body: JSON.stringify(corpo) });
  return { httpStatus: res.status, ...(await res.json().catch(() => ({}))) };
};
const operacao = async (referencia) => (await admin.from("connecttef_payments").select("*").eq("referencia", referencia)).data?.[0];
const autorizacoes = async (paymentId) => (await admin.from("connecttef_payment_authorizations").select("*").eq("payment_id", paymentId)).data || [];
const eventoDb = async (id) => (await admin.from("connecttef_events").select("*").eq("event_id", id)).data?.[0];
const linhasPagamento = async (companyId) => (await admin.from("connecttef_payments").select("id", { count: "exact", head: true }).eq("company_id", companyId)).count;
const eid = (n) => `smoke-pay-${stamp}-${n}`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const aprovado = (referencia, valor, extra = {}) => ({
  evento: "pagamento.aprovado",
  dados: {
    referencia, status: "aprovado", valorCentavos: valor, formaPagamento: "credito", parcelas: 1,
    smartposId: "POS-HML-APROVADO", bandeiraCartao: "VISA",
    autorizacao: { codigo: "AUT123", numeroTransacao: "NSU987", dadosFinalizacao: "dados-finalizacao-secretos" },
    resultadoSmartPOS: { codigoResposta: "00" },
    ...extra,
  },
});
const recusado = (referencia, valor, extra = {}) => ({
  evento: "pagamento.recusado",
  dados: { referencia, status: "recusado", valorCentavos: valor, smartposId: "POS-HML-APROVADO", mensagem: "Saldo insuficiente", ...extra },
});
const novaOperacao = async (valor = 2000, extra = {}) => {
  const r = await pagar(A, { valorCentavos: valor, formaPagamento: "credito", ...extra });
  return r;
};

try {
  // ===== Autenticação =====
  const semAuth = await pagar(null, { valorCentavos: 1000, formaPagamento: "credito" });
  check(semAuth.httpStatus === 401, `sem usuário autenticado é recusado (${semAuth.httpStatus})`);
  check(recebidas.length === 0, "nenhuma chamada ao ConnectTEF antes de validar usuário");

  // ===== Validação do valor e do pedido (no servidor) =====
  const invalidos = [
    ["valor zero", { valorCentavos: 0, formaPagamento: "credito" }],
    ["valor negativo", { valorCentavos: -500, formaPagamento: "credito" }],
    ["valor fracionado", { valorCentavos: 10.5, formaPagamento: "credito" }],
    ["valor em texto", { valorCentavos: "1000", formaPagamento: "credito" }],
    ["valor acima do teto", { valorCentavos: 10_000_001, formaPagamento: "credito" }],
    ["sem valor", { formaPagamento: "credito" }],
    ["sem forma de pagamento", { valorCentavos: 1000 }],
    ["forma inexistente", { valorCentavos: 1000, formaPagamento: "dinheiro" }],
    ["crédito parcelado sem tipo de parcelamento", { valorCentavos: 1000, formaPagamento: "credito", parcelas: 3 }],
    ["parcelamento no débito", { valorCentavos: 1000, formaPagamento: "debito", parcelas: 2, parcelamento: "estabelecimento" }],
    ["zero parcelas", { valorCentavos: 1000, formaPagamento: "credito", parcelas: 0 }],
    ["parcelas demais", { valorCentavos: 1000, formaPagamento: "credito", parcelas: 25, parcelamento: "administradora" }],
    ["smartposId com caracteres inválidos", { valorCentavos: 1000, formaPagamento: "credito", smartposId: "id com espaço" }],
    ["chave de idempotência curta", { valorCentavos: 1000, formaPagamento: "credito", chaveIdempotencia: "x" }],
  ];
  for (const [nome, body] of invalidos) {
    const r = await pagar(A, body);
    check(r.httpStatus === 400, `${nome} é 400 (${r.httpStatus})`);
  }
  check(recebidas.length === 0 && (await linhasPagamento(A.companyId)) === 0, "pedido inválido não chama o ConnectTEF nem grava operação");
  const semChave = await pagar(A, { valorCentavos: 1000, formaPagamento: "credito" }, PORTAS.pagarSemChave);
  check(semChave.httpStatus === 503 && (await linhasPagamento(A.companyId)) === 0, `sem CONNECTTEF_API_KEY configurada: 503 e nada gravado (${semChave.httpStatus})`);

  // ===== Smart POS =====
  const semPos = await pagar(D, { valorCentavos: 1000, formaPagamento: "credito" });
  check(semPos.httpStatus === 409 && /vinculado/i.test(semPos.error || ""), `empresa sem Smart POS vinculado: 409 (${semPos.httpStatus})`);
  const posInexistente = await pagar(A, { valorCentavos: 1000, formaPagamento: "credito", smartposId: "POS-NAO-EXISTE" });
  check(posInexistente.httpStatus === 404, `smartposId inexistente é 404 (${posInexistente.httpStatus})`);
  const posDeOutra = await pagar(A, { valorCentavos: 1000, formaPagamento: "credito", smartposId: "POS-DA-EMPRESA-B" });
  check(posDeOutra.httpStatus === 404, `Smart POS de outra empresa é 404 (${posDeOutra.httpStatus})`);
  check(recebidas.length === 0 && (await linhasPagamento(A.companyId)) === 0, "Smart POS inválido não chama o ConnectTEF nem grava operação");

  // ===== Solicitação aceita (202) =====
  const ok1 = await pagar(A, { valorCentavos: 15990, formaPagamento: "credito", documentoCliente: "00000000000191", apiKey: "chave-do-frontend" }, PORTAS.pagar, { "x-api-key": "chave-do-frontend" });
  check(ok1.httpStatus === 202 && ok1.status === "processando" && UUID.test(ok1.referencia || ""), `solicitação aceita responde 202 "processando" (${ok1.httpStatus} ${ok1.status})`);
  const c1 = recebidas[recebidas.length - 1];
  check(c1?.metodo === "POST" && c1?.caminho === "/v1/payments", "chama POST /v1/payments do ConnectTEF");
  check(c1?.apiKey === API_KEY && c1?.apiKey !== "chave-do-frontend", "usa a API Key do secret do servidor (ignora a do navegador)");
  check(JSON.stringify(Object.keys(c1.corpo).sort()) === JSON.stringify(["documentoCliente", "formaPagamento", "modoExecucao", "referencia", "smartposId", "valorCentavos"]), `corpo enviado só com os campos documentados (${Object.keys(c1.corpo).sort().join()})`);
  check(c1.corpo.documentoCliente === DOC_A, "documentoCliente vem do pareamento, não do corpo do pedido");
  check(c1.corpo.smartposId === "POS-HML-APROVADO" && c1.corpo.valorCentavos === 15990 && c1.corpo.formaPagamento === "credito" && c1.corpo.modoExecucao === "imediato", "Smart POS vinculado, valor e forma corretos");
  check(c1.corpo.referencia === ok1.referencia, "a referencia enviada é a gravada");
  check(c1.existiaPendente === "pendente", `a operação já estava gravada (pendente) quando a chamada chegou ao ConnectTEF (${c1.existiaPendente})`);
  const { httpStatus: _h1, ...corpoOk1 } = ok1;
  check(!JSON.stringify(corpoOk1).includes(API_KEY) && !JSON.stringify(corpoOk1).includes(DOC_A), "a resposta não contém a API Key nem o documento do cliente");
  const o1 = await operacao(ok1.referencia);
  check(o1?.company_id === A.companyId && o1?.status === "processando" && o1?.valor_centavos === 15990 && o1?.created_by === A.id, "operação gravada na empresa do usuário como processando");
  check(o1?.finalized_at === null && o1?.final_event_id === null && !!o1?.requested_at, "o 202 NÃO finaliza a operação");
  check((await autorizacoes(o1.id)).length === 0, "o 202 não cria dados de autorização");

  const parcelado = await pagar(A, { valorCentavos: 30000, formaPagamento: "credito", parcelas: 3, parcelamento: "estabelecimento" });
  const cParc = recebidas[recebidas.length - 1];
  check(parcelado.httpStatus === 202 && cParc.corpo.parcelas === 3 && cParc.corpo.parcelamento === "estabelecimento", "crédito parcelado envia parcelas e parcelamento");
  const debito = await pagar(A, { valorCentavos: 4000, formaPagamento: "debito", smartposId: "POS-HML-APROVADO" });
  const cDeb = recebidas[recebidas.length - 1];
  check(debito.httpStatus === 202 && cDeb.corpo.parcelas === undefined && cDeb.corpo.formaPagamento === "debito", "débito não envia parcelas");
  check(ok1.referencia !== parcelado.referencia && parcelado.referencia !== debito.referencia, "cada operação tem uma referencia nova");

  // ===== Idempotência da solicitação =====
  const chamadasAntes = recebidas.length;
  const k1 = await pagar(A, { valorCentavos: 5000, formaPagamento: "debito", chaveIdempotencia: `chave-${stamp}-1` });
  const k2 = await pagar(A, { valorCentavos: 5000, formaPagamento: "debito", chaveIdempotencia: `chave-${stamp}-1` });
  check(k1.httpStatus === 202 && k2.httpStatus === 200 && k2.reaproveitada === true && k2.id === k1.id, "mesma chaveIdempotencia devolve a mesma operação");
  check(recebidas.length === chamadasAntes + 1, "retry com a mesma chave não cobra de novo no ConnectTEF");
  const antesConc = recebidas.length;
  const conc = await Promise.all(Array.from({ length: 4 }, () => pagar(A, { valorCentavos: 6000, formaPagamento: "debito", chaveIdempotencia: `chave-${stamp}-2` })));
  check(new Set(conc.map((r) => r.id)).size === 1 && conc.every((r) => r.httpStatus === 200 || r.httpStatus === 202), "4 pedidos simultâneos com a mesma chave resultam numa só operação");
  check(recebidas.length === antesConc + 1, "e numa só cobrança no ConnectTEF");
  const kB = await pagar(B, { valorCentavos: 5000, formaPagamento: "debito", chaveIdempotencia: `chave-${stamp}-1` });
  check(kB.httpStatus === 202 && kB.id !== k1.id, "a chave é por empresa: a empresa B usa a mesma chave sem colidir");

  // ===== Erros do ConnectTEF =====
  const casos = [
    [111, 422, "falhou", /recusou os dados/i, "400"],
    [222, 502, "falhou", /credencial/i, "401"],
    [333, 502, "falhou", /credencial/i, "403 do gateway"],
    [999, 422, "falhou", /não está autorizado/i, "403 CLIENTE_NAO_AUTORIZADO"],
    [444, 422, "falhou", /não encontrou o Smart POS/i, "404 SMARTPOS_NAO_ENCONTRADO"],
    [666, 502, "falhou", /já tem uma operação/i, "409"],
    [555, 502, "indeterminado", /não foi possível confirmar/i, "500"],
  ];
  const porValor = {};
  for (const [valor, http, estado, msg, nome] of casos) {
    const r = await pagar(A, { valorCentavos: valor, formaPagamento: "credito" });
    porValor[valor] = r;
    const o = await operacao(r.referencia);
    check(r.httpStatus === http && msg.test(r.error || "") && r.status === estado, `ConnectTEF ${nome}: HTTP ${http}, estado ${estado} (${r.httpStatus} ${r.status})`);
    check(o?.status === estado && o?.finalized_at === null, `ConnectTEF ${nome}: operação gravada como ${estado}, sem finalizar`);
    check(!JSON.stringify(r).includes(API_KEY), `ConnectTEF ${nome}: a resposta não contém a API Key`);
  }
  check(porValor[222].connecttefStatus === 401 && porValor[999].connecttefCodigo === "CLIENTE_NAO_AUTORIZADO", "preserva o status e o código do ConnectTEF na resposta");
  const lenta = await pagar(A, { valorCentavos: 1200, formaPagamento: "credito" });
  const oLenta = await operacao(lenta.referencia);
  check(lenta.httpStatus === 202 && lenta.status === "processando" && oLenta?.status === "processando", `resposta do ConnectTEF em 12 s (acima do timeout antigo de 10 s) ainda é aceita: 202 processando (${lenta.httpStatus} ${lenta.status})`);
  const timeout = await pagar(A, { valorCentavos: 777, formaPagamento: "credito" });
  const oTimeout = await operacao(timeout.referencia);
  check(timeout.httpStatus === 502 && timeout.status === "indeterminado" && oTimeout?.status === "indeterminado", `sem resposta do ConnectTEF (timeout) fica indeterminado (${timeout.httpStatus} ${timeout.status})`);

  // ===== Webhook: pagamento aprovado =====
  const semToken = await evento({ id: eid("0"), tipo: "pagamento.aprovado", token: null, corpo: aprovado(ok1.referencia, 15990) });
  check(semToken.httpStatus === 401 && (await operacao(ok1.referencia)).status === "processando", "webhook continua exigindo o Bearer e não aprova sem ele");

  const a1 = await evento({ id: eid("1"), tipo: "pagamento.aprovado", corpo: aprovado(ok1.referencia, 15990) });
  const oa1 = await operacao(ok1.referencia);
  check(a1.httpStatus === 200 && a1.processed === "approved", `pagamento.aprovado aprova a operação (${a1.httpStatus} ${a1.processed})`);
  check(oa1.status === "aprovado" && !!oa1.finalized_at && oa1.final_event_id === eid("1") && oa1.bandeira === "VISA", "operação aprovada com data, evento final e bandeira");
  const au1 = await autorizacoes(oa1.id);
  check(au1.length === 1 && au1[0].codigo_autorizacao === "AUT123" && au1[0].numero_transacao === "NSU987" && au1[0].dados_finalizacao === "dados-finalizacao-secretos", "dados da autorização guardados à parte (para o estorno futuro)");
  const ev1 = await eventoDb(eid("1"));
  check(!!ev1?.processed_at && ev1?.error === null, "evento marcado como processado, sem erro");

  // ----- idempotência do resultado -----
  const a1b = await evento({ id: eid("1"), tipo: "pagamento.aprovado", corpo: aprovado(ok1.referencia, 15990) });
  const oa1b = await operacao(ok1.referencia);
  check(a1b.httpStatus === 200 && a1b.duplicate === true && a1b.processed === "already_processed", `mesmo X-ConnectTEF-Event-Id repetido não reprocessa (${a1b.processed})`);
  check(oa1b.finalized_at === oa1.finalized_at && oa1b.updated_at === oa1.updated_at && (await autorizacoes(oa1.id)).length === 1, "reenvio não altera a operação nem duplica a autorização");
  const a1c = await evento({ id: eid("1c"), tipo: "pagamento.aprovado", corpo: aprovado(ok1.referencia, 15990) });
  const oa1c = await operacao(ok1.referencia);
  check(a1c.processed === "already_final" && oa1c.final_event_id === eid("1") && oa1c.finalized_at === oa1.finalized_at, "outro evento de aprovação da mesma operação não aprova de novo");

  // ----- entregas simultâneas -----
  const refConc = (await novaOperacao(7700)).referencia;
  const mesmoEvento = await Promise.all(Array.from({ length: 6 }, () => evento({ id: eid("2"), tipo: "pagamento.aprovado", corpo: aprovado(refConc, 7700) })));
  const oConc = await operacao(refConc);
  const aprovacoes = mesmoEvento.filter((r) => r.processed === "approved").length;
  check(mesmoEvento.every((r) => r.httpStatus === 200) && aprovacoes === 1, `6 entregas simultâneas do mesmo evento: exatamente 1 aprova (${aprovacoes})`);
  check(oConc.status === "aprovado" && (await autorizacoes(oConc.id)).length === 1 && (await eventoDb(eid("2"))).delivery_count === 6, "estado aprovado, 1 autorização, 6 entregas contadas numa só linha de evento");
  const refConc2 = (await novaOperacao(7800)).referencia;
  const idsDiferentes = await Promise.all(Array.from({ length: 5 }, (_, i) => evento({ id: eid(`3-${i}`), tipo: "pagamento.aprovado", corpo: aprovado(refConc2, 7800) })));
  const oConc2 = await operacao(refConc2);
  check(idsDiferentes.filter((r) => r.processed === "approved").length === 1 && idsDiferentes.filter((r) => r.processed === "already_final").length === 4, "5 eventos DIFERENTES de aprovação simultâneos: 1 aprova, 4 viram already_final");
  check(oConc2.status === "aprovado" && (await autorizacoes(oConc2.id)).length === 1 && /^smoke-pay-.+-3-\d$/.test(oConc2.final_event_id), "uma só autorização e um só evento final");

  // ===== Webhook: recusado =====
  const refRec = (await novaOperacao(3100)).referencia;
  const r1 = await evento({ id: eid("4"), tipo: "pagamento.recusado", corpo: recusado(refRec, 3100) });
  const oRec = await operacao(refRec);
  check(r1.processed === "declined" && oRec.status === "recusado" && !!oRec.finalized_at && oRec.motivo === "Saldo insuficiente", `pagamento.recusado recusa a operação e guarda o motivo (${r1.processed})`);
  check((await autorizacoes(oRec.id)).length === 0, "recusa não cria dados de autorização");
  const refRej = (await novaOperacao(3200)).referencia;
  const r2 = await evento({ id: eid("5"), tipo: "pagamento.rejeitado", corpo: { evento: "pagamento.rejeitado", dados: { referencia: refRej, valorCentavos: 3200 } } });
  check(r2.processed === "declined" && (await operacao(refRej)).status === "recusado", "pagamento.rejeitado também recusa (sinônimo)");

  // ----- resultado definitivo não muda -----
  const conf1 = await evento({ id: eid("6"), tipo: "pagamento.aprovado", corpo: aprovado(refRec, 3100) });
  const oRecDepois = await operacao(refRec);
  check(conf1.processed === "conflict" && oRecDepois.status === "recusado" && (await autorizacoes(oRecDepois.id)).length === 0, "aprovação depois de recusa é conflito: continua recusado");
  check(/conflitante/.test((await eventoDb(eid("6"))).error || ""), "o conflito fica registrado no evento");
  const conf2 = await evento({ id: eid("7"), tipo: "pagamento.recusado", corpo: recusado(ok1.referencia, 15990) });
  check(conf2.processed === "conflict" && (await operacao(ok1.referencia)).status === "aprovado", "recusa depois de aprovação é conflito: continua aprovado");

  // ----- eventos inválidos -----
  const refVal = (await novaOperacao(4100)).referencia;
  const valorDiverge = await evento({ id: eid("8"), tipo: "pagamento.aprovado", corpo: aprovado(refVal, 4000) });
  check(valorDiverge.processed === "invalid" && (await operacao(refVal)).status === "processando", "valor do evento diferente do pedido NÃO aprova");
  check(/diverge/.test((await eventoDb(eid("8"))).error || ""), "a divergência fica registrada no evento");
  const valorTexto = await evento({ id: eid("8b"), tipo: "pagamento.aprovado", corpo: aprovado(refVal, "abc") });
  check(valorTexto.processed === "invalid" && (await operacao(refVal)).status === "processando", "valorCentavos fora do formato NÃO aprova");
  const posDiverge = await evento({ id: eid("9"), tipo: "pagamento.aprovado", corpo: aprovado(refVal, 4100, { smartposId: "OUTRO-POS" }) });
  check(posDiverge.processed === "invalid" && (await operacao(refVal)).status === "processando", "Smart POS do evento diferente do pedido NÃO aprova");
  const desconhecida = await evento({ id: eid("10"), tipo: "pagamento.aprovado", corpo: aprovado(randomUUID(), 4100) });
  check(desconhecida.processed === "invalid" && /desconhecida/.test((await eventoDb(eid("10"))).error || ""), "referencia desconhecida não aprova nada");
  const naoUuid = await evento({ id: eid("11"), tipo: "pagamento.aprovado", corpo: aprovado("nao-e-uuid", 4100) });
  check(naoUuid.processed === "invalid", "referencia que não é UUID é recusada");
  const valorComoTexto = await evento({ id: eid("12"), tipo: "pagamento.aprovado", corpo: aprovado(refVal, "4100") });
  check(valorComoTexto.processed === "approved", "valorCentavos numérico em texto confere e aprova");
  const antesOutras = await operacao(ok1.referencia);
  check(antesOutras.status === "aprovado", "um evento não mexe nas outras operações");

  // ----- resultado resolve operações incertas -----
  const refInd = porValor[555].referencia;
  const indeterminado = await evento({ id: eid("13"), tipo: "pagamento.aprovado", corpo: aprovado(refInd, 555) });
  check(indeterminado.processed === "approved" && (await operacao(refInd)).status === "aprovado", "operação indeterminada (500/timeout) é resolvida pelo webhook");
  const refFalhou = porValor[111].referencia;
  const falhou = await evento({ id: eid("14"), tipo: "pagamento.aprovado", corpo: aprovado(refFalhou, 111) });
  check(falhou.processed === "invalid" && (await operacao(refFalhou)).status === "falhou", "operação que o ConnectTEF recusou na solicitação NÃO vira aprovada");

  // ----- resultado chega antes do 202 -----
  const corrida = pagar(A, { valorCentavos: 888, formaPagamento: "credito" });
  let refCorrida = null;
  for (let i = 0; i < 30 && !refCorrida; i++) {
    await espera(100);
    const { data } = await admin.from("connecttef_payments").select("referencia, status").eq("company_id", A.companyId).eq("valor_centavos", 888).eq("status", "pendente").maybeSingle();
    refCorrida = data?.referencia ?? null;
  }
  const antecipado = refCorrida ? await evento({ id: eid("15"), tipo: "pagamento.aprovado", corpo: aprovado(refCorrida, 888) }) : null;
  const respCorrida = await corrida;
  const oCorrida = refCorrida ? await operacao(refCorrida) : null;
  check(antecipado?.processed === "approved", `webhook que chega antes do 202 aprova a operação pendente (${antecipado?.processed})`);
  check(oCorrida?.status === "aprovado" && respCorrida.status === "aprovado", `o 202 atrasado NÃO rebaixa o resultado definitivo (banco ${oCorrida?.status}, resposta ${respCorrida.status})`);

  // ----- só pagamentos são processados -----
  const outroTipo = await evento({ id: eid("16"), tipo: "estorno.falhou", corpo: { evento: "estorno.falhou", dados: { referencia: refVal } } });
  check(outroTipo.httpStatus === 200 && outroTipo.processed === undefined && (await eventoDb(eid("16"))).processed_at === null, "estorno.falhou é só registrado: estorno não está implementado");

  // ===== RLS =====
  const lerCaixa = await C.sb.from("connecttef_payments").select("referencia, status, valor_centavos").eq("company_id", A.companyId);
  check((lerCaixa.data || []).length >= 5, "usuário da empresa (caixa) consulta as operações da empresa");
  const lerB = await B.sb.from("connecttef_payments").select("id").eq("company_id", A.companyId);
  check((lerB.data || []).length === 0, "outra empresa não consulta operações da empresa A");
  const lerAdeB = await A.sb.from("connecttef_payments").select("id").eq("company_id", B.companyId);
  check((lerAdeB.data || []).length === 0, "a empresa A não consulta as da empresa B");
  const anon = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const lerAnon = await anon.from("connecttef_payments").select("id").limit(1);
  check(!!lerAnon.error || (lerAnon.data || []).length === 0, "anônimo não consulta");
  const forjar = await A.sb.from("connecttef_payments").insert({ company_id: A.companyId, referencia: randomUUID(), smartpos_id: "POS-HML-APROVADO", documento_cliente: DOC_A, valor_centavos: 100, forma_pagamento: "credito", status: "aprovado" });
  check(!!forjar.error, "nem admin cria operação direto na tabela");
  const alterar = await A.sb.from("connecttef_payments").update({ status: "aprovado" }).eq("referencia", refVal).select();
  check((alterar.data || []).length === 0, "usuário não aprova operação direto na tabela");
  const apagar = await A.sb.from("connecttef_payments").delete().eq("referencia", ok1.referencia).select();
  check((apagar.data || []).length === 0 && !!(await operacao(ok1.referencia)), "usuário não apaga operação");
  const lerAut = await A.sb.from("connecttef_payment_authorizations").select("*");
  check(!!lerAut.error || (lerAut.data || []).length === 0, "ninguém no navegador lê os dados de autorização");
  const rpc = await A.sb.rpc("process_connecttef_event", { p_event_id: eid("1") });
  check(!!rpc.error, "usuário não executa process_connecttef_event");

  // ===== Logs das funções: sem segredos =====
  await espera(500);
  check(/"status":403/.test(logsFuncoes) && /"tipo":"credencial"/.test(logsFuncoes) && /"tipo":"smartpos"/.test(logsFuncoes), "o log registra status e tipo dos erros do ConnectTEF");
  check(!logsFuncoes.includes(API_KEY) && !logsFuncoes.includes(WEBHOOK_TOKEN), "nem a API Key nem o token do webhook aparecem nos logs");
  check(!logsFuncoes.includes(A.token) && !logsFuncoes.includes("Bearer "), "o Authorization do usuário não aparece nos logs");
  check(!logsFuncoes.includes(DOC_A) && !logsFuncoes.includes("dados-finalizacao-secretos"), "documento e dados de autorização não aparecem nos logs");
} finally {
  // ===== Limpeza =====
  await admin.from("connecttef_events").delete().like("event_id", `smoke-pay-${stamp}-%`);
  for (const t of [A, B, D]) if (t.companyId) await admin.from("companies").delete().eq("id", t.companyId);
  for (const id of usuarios) await admin.auth.admin.deleteUser(id);
  for (const p of filhos) p.kill();
  mock.close();
}

console.log("\nSmoke — pagamento ConnectTEF (solicitação, webhook, idempotência, RLS)\n");
for (const m of ok) console.log(`  PASS  ${m}`);
for (const m of falhas) console.log(`  FAIL  ${m}`);
console.log(`\n${ok.length} passaram, ${falhas.length} falharam\n`);
process.exit(falhas.length ? 1 : 0);
