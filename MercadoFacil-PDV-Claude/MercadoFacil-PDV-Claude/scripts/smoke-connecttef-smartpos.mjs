/**
 * Smoke do pareamento de Smart POS do ConnectTEF: connecttef-pair-smartpos (QR Code)
 * + connecttef-webhook (evento smartpos.identificado) + RLS de connecttef_smartpos.
 *
 * Auto-contido e SEM chamar o ConnectTEF real: sobe um ConnectTEF simulado (mock) em
 * localhost e as duas Edge Functions localmente (deno), com uma API Key e um token
 * de webhook de TESTE gerados na hora. O banco é o Supabase real (empresas de teste
 * apagadas no fim). Requer `deno` no PATH.
 *
 * Uso: node scripts/smoke-connecttef-smartpos.mjs
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

const API_KEY = `teste-key-${randomBytes(12).toString("hex")}`;
const WEBHOOK_TOKEN = `teste-tok-${randomBytes(12).toString("hex")}`;
const PORTAS = { mock: 8105, pair: 8106, pairSemChave: 8107, webhook: 8103 };

// ---------- documentos válidos ----------
const dv = (digits, pesos) => {
  const soma = digits.reduce((a, d, i) => a + d * pesos[i], 0);
  const r = soma % 11;
  return r < 2 ? 0 : 11 - r;
};
const cnpj = (base12) => {
  const d = String(base12).padStart(12, "0").split("").map(Number);
  const d1 = dv(d, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = dv([...d, d1], [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return [...d, d1, d2].join("");
};
const cpf = (base9) => {
  const d = String(base9).padStart(9, "0").split("").map(Number);
  const calc = (arr, de) => {
    const r = (arr.reduce((a, x, i) => a + x * (de - i), 0) * 10) % 11;
    return r === 10 ? 0 : r;
  };
  const d1 = calc(d, 10);
  const d2 = calc([...d, d1], 11);
  return [...d, d1, d2].join("");
};
const DOC_OK = cnpj(112223330001);
const DOC_OK2 = cnpj(114447770001);
const DOC_403 = cnpj(123456780001);
const DOC_401 = cnpj(223456780001);
const DOC_500 = cpf(529982247);
const DOC_SEM_QR = cnpj(323456780001);
const DOC_GATEWAY_403 = cnpj(423456780001);
const DOC_404 = cnpj(523456780001);
const mascarado = (c) => `${c.slice(0, 2)}.${c.slice(2, 5)}.${c.slice(5, 8)}/${c.slice(8, 12)}-${c.slice(12)}`;

// ---------- ConnectTEF simulado ----------
const recebidas = [];
const mock = createServer((req, res) => {
  let corpo = "";
  req.on("data", (c) => (corpo += c));
  req.on("end", () => {
    const registro = { metodo: req.method, caminho: req.url, apiKey: req.headers["x-api-key"], corpo: corpo ? JSON.parse(corpo) : null };
    recebidas.push(registro);
    const responder = (status, obj) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(obj));
    };
    // Como a API real: a rota é POST /qrcode; /v1/qrcode não existe (404 do gateway).
    if (req.method !== "POST" || req.url !== "/qrcode") return responder(404, { message: "Not Found" });
    if (registro.apiKey !== API_KEY) return responder(403, { message: "Forbidden" });
    const doc = registro.corpo?.documentoCliente;
    if (doc === DOC_GATEWAY_403) return responder(403, { message: "Forbidden" });
    if (doc === DOC_404) return responder(404, { message: "Not Found" });
    if (doc === DOC_403) return responder(403, { codigo: "CLIENTE_NAO_AUTORIZADO" });
    if (doc === DOC_401) return responder(401, { codigo: "API_KEY_INVALIDA" });
    if (doc === DOC_500) return responder(500, { codigo: "ERRO_INTERNO" });
    if (doc === DOC_SEM_QR) return responder(201, { referencia: registro.corpo.referencia });
    return responder(201, {
      qrCode: `connecttef://identificar/${registro.corpo.referencia}`,
      referencia: registro.corpo.referencia,
      expiresAt: Math.floor(Date.now() / 1000) + 600,
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
subir("connecttef-pair-smartpos", PORTAS.pair, { CONNECTTEF_API_KEY: API_KEY, CONNECTTEF_API_BASE: `http://127.0.0.1:${PORTAS.mock}` });
subir("connecttef-pair-smartpos", PORTAS.pairSemChave, { CONNECTTEF_API_BASE: `http://127.0.0.1:${PORTAS.mock}` });
subir("connecttef-webhook", PORTAS.webhook, { CONNECTTEF_WEBHOOK_TOKEN: WEBHOOK_TOKEN });
for (const porta of Object.values(PORTAS).filter((p) => p !== PORTAS.mock)) {
  for (let i = 0; i < 60; i++) {
    try {
      await fetch(`http://127.0.0.1:${porta}`, { method: "OPTIONS" });
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}

// ---------- empresas e usuários ----------
const stamp = Date.now();
const usuarios = [];
async function entrar(tag) {
  const email = `guarni07+mf.ctefp.${tag}.${stamp}@gmail.com`;
  const password = `Ctp-${stamp}aA1!`;
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  usuarios.push(data.user.id);
  const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: s } = await sb.auth.signInWithPassword({ email, password });
  return { sb, id: data.user.id, email, token: s.session.access_token };
}
const A = await entrar("a");
const { data: bootA } = await A.sb.rpc("bootstrap_company", { p_trade_name: `Smartpos A ${stamp}`, p_email: A.email });
A.companyId = typeof bootA === "string" ? bootA : bootA?.id;
const B = await entrar("b");
const { data: bootB } = await B.sb.rpc("bootstrap_company", { p_trade_name: `Smartpos B ${stamp}`, p_email: B.email });
B.companyId = typeof bootB === "string" ? bootB : bootB?.id;
const C = await entrar("caixa");
await admin.from("profiles").update({ company_id: A.companyId, role: "user", company_role: "operator" }).eq("id", C.id);

const zerarLimite = () => admin.from("rate_limit_hits").delete().or(`key.like.%${A.companyId}%,key.like.%${B.companyId}%`);
const parear = async (usuario, body, porta = PORTAS.pair, extraHeaders = {}) => {
  await zerarLimite();
  const headers = { "Content-Type": "application/json", apikey: env.VITE_SUPABASE_ANON_KEY, ...extraHeaders };
  if (usuario) headers.Authorization = `Bearer ${usuario.token}`;
  const res = await fetch(`http://127.0.0.1:${porta}`, { method: "POST", headers, body: JSON.stringify(body) });
  return { status: res.status, ...(await res.json().catch(() => ({}))) };
};
const evento = async ({ id, tipo = "smartpos.identificado", corpo, token = WEBHOOK_TOKEN }) => {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (id) headers["X-ConnectTEF-Event-Id"] = id;
  if (tipo) headers["X-ConnectTEF-Event-Type"] = tipo;
  const res = await fetch(`http://127.0.0.1:${PORTAS.webhook}`, { method: "POST", headers, body: JSON.stringify(corpo) });
  return { status: res.status, ...(await res.json().catch(() => ({}))) };
};
const pareamento = async (referencia) => (await admin.from("connecttef_smartpos").select("*").eq("referencia", referencia)).data?.[0];
const eventoDb = async (id) => (await admin.from("connecttef_events").select("*").eq("event_id", id)).data?.[0];
const identificado = (referencia, smartposId, extra = {}) => ({
  evento: "smartpos.identificado",
  dados: { referencia, smartposId, ...extra },
});
const eid = (n) => `smoke-pair-${stamp}-${n}`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

try {
  // ===== Autenticação e permissão =====
  const semAuth = await parear(null, { documentoCliente: DOC_OK });
  check(semAuth.status === 401, `sem usuário autenticado é recusado (${semAuth.status})`);
  const caixa = await parear(C, { documentoCliente: DOC_OK });
  check(caixa.status === 403, `usuário caixa não pareia Smart POS (${caixa.status})`);
  const antes = recebidas.length;
  check(antes === 0, "nenhuma chamada ao ConnectTEF antes de validar usuário");

  // ===== Documento =====
  const semDoc = await parear(A, {});
  check(semDoc.status === 400, `sem documento é 400 (${semDoc.status})`);
  const docCurto = await parear(A, { documentoCliente: "123" });
  check(docCurto.status === 400, "documento curto é 400");
  const docRuim = await parear(A, { documentoCliente: "11222333000182" });
  check(docRuim.status === 400, "CNPJ com dígito errado é 400");
  const cpfRuim = await parear(A, { documentoCliente: "52998224726" });
  check(cpfRuim.status === 400, "CPF com dígito errado é 400");
  check(recebidas.length === antes, "documento inválido não chama o ConnectTEF");
  check((await admin.from("connecttef_smartpos").select("id", { count: "exact", head: true }).eq("company_id", A.companyId)).count === 0, "documento inválido não grava pareamento");

  // ===== QR Code =====
  const ok1 = await parear(A, { documentoCliente: mascarado(DOC_OK) }, PORTAS.pair, { "x-api-key": "chave-do-frontend" });
  check(ok1.status === 200 && UUID.test(ok1.referencia || "") && !!ok1.qrCode && !!ok1.id, `documento válido (com máscara) gera o QR Code (${ok1.status})`);
  const chamada = recebidas[recebidas.length - 1];
  check(chamada?.metodo === "POST" && chamada?.caminho === "/qrcode", "chama POST /qrcode do ConnectTEF (rota oficial)");
  check(!recebidas.some((r) => r.caminho === "/v1/qrcode"), "nunca chama /v1/qrcode (rota inexistente)");
  check(chamada?.apiKey === API_KEY, "usa a API Key do secret do servidor");
  check(chamada?.apiKey !== "chave-do-frontend", "ignora qualquer chave vinda do navegador");
  check(JSON.stringify(Object.keys(chamada?.corpo || {}).sort()) === JSON.stringify(["documentoCliente", "referencia"]), "envia só documentoCliente e referencia");
  check(chamada?.corpo?.documentoCliente === DOC_OK && chamada?.corpo?.referencia === ok1.referencia, "documento normalizado (só dígitos) e referencia UUID");
  check(!JSON.stringify(ok1).includes(API_KEY), "a resposta ao frontend não contém a API Key");
  const { status: _status, ...corpoOk1 } = ok1;
check(Object.keys(corpoOk1).sort().join() === "expiresAt,id,qrCode,referencia", `a resposta só traz o necessário para o QR Code (${Object.keys(corpoOk1).join()})`);
  check(!!ok1.expiresAt && new Date(ok1.expiresAt).getTime() > Date.now(), "devolve a expiração do QR Code");
  const p1 = await pareamento(ok1.referencia);
  check(p1?.company_id === A.companyId && p1?.documento_cliente === DOC_OK && p1?.status === "aguardando" && p1?.smartpos_id === null, "pareamento gravado como aguardando, na empresa do usuário");
  check(!!p1?.qr_expires_at && p1?.created_by === A.id, "expiração e autor gravados");
  const ok2 = await parear(A, { documentoCliente: DOC_OK });
  check(ok2.status === 200 && ok2.referencia !== ok1.referencia, "cada pareamento tem uma referencia nova");

  // ===== Erros do ConnectTEF =====
  const contaAntes = (await admin.from("connecttef_smartpos").select("id", { count: "exact", head: true }).eq("company_id", A.companyId)).count;
  const e403 = await parear(A, { documentoCliente: DOC_403 });
  check(e403.status === 422 && /não está autorizado/i.test(e403.error || ""), `403 CLIENTE_NAO_AUTORIZADO é erro do cliente informado (${e403.status})`);
  check(e403.connecttefStatus === 403 && e403.connecttefCodigo === "CLIENTE_NAO_AUTORIZADO", "preserva o status e o código do ConnectTEF na resposta");
  const e401 = await parear(A, { documentoCliente: DOC_401 });
  check(e401.status === 502 && /credencial/i.test(e401.error || "") && e401.connecttefStatus === 401, `401 é erro de credencial da API (${e401.status} / ConnectTEF ${e401.connecttefStatus})`);
  check(!JSON.stringify(e401).includes(API_KEY), "a resposta de erro não contém a API Key");
  const eGw = await parear(A, { documentoCliente: DOC_GATEWAY_403 });
  check(eGw.status === 502 && /credencial/i.test(eGw.error || "") && !/documento/i.test(eGw.error || "") && eGw.connecttefStatus === 403, `403 do gateway ({"message":"Forbidden"}) é credencial, não documento (${eGw.status})`);
  const e404 = await parear(A, { documentoCliente: DOC_404 });
  check(e404.status === 502 && /endereço da API/i.test(e404.error || "") && e404.connecttefStatus === 404, `404 é erro de rota (${e404.status} / ConnectTEF ${e404.connecttefStatus})`);
  const e500 = await parear(A, { documentoCliente: DOC_500 });
  check(e500.status === 502 && /problema/i.test(e500.error || "") && e500.connecttefStatus === 500, `500 é erro do servidor do ConnectTEF (${e500.status} / ConnectTEF ${e500.connecttefStatus})`);
  const eSemQr = await parear(A, { documentoCliente: DOC_SEM_QR });
  check(eSemQr.status === 502, `resposta sem qrCode vira 502 (${eSemQr.status})`);
  const contaDepois = (await admin.from("connecttef_smartpos").select("id", { count: "exact", head: true }).eq("company_id", A.companyId)).count;
  check(contaDepois === contaAntes, "falhas no ConnectTEF não deixam pareamento órfão");
  const semChave = await parear(A, { documentoCliente: DOC_OK }, PORTAS.pairSemChave);
  check(semChave.status === 503, `sem CONNECTTEF_API_KEY configurada responde 503 (${semChave.status})`);
  check((await admin.from("connecttef_smartpos").select("id", { count: "exact", head: true }).eq("company_id", A.companyId)).count === contaAntes, "sem chave configurada não grava pareamento");

  // ===== Webhook: identificação do Smart POS =====
  const semToken = await evento({ id: eid("x"), token: null, corpo: identificado(ok1.referencia, "POS-HML-APROVADO") });
  check(semToken.status === 401 && (await pareamento(ok1.referencia)).status === "aguardando", "webhook continua exigindo o Bearer (401) e não vincula");

  const v1 = await evento({ id: eid("1"), corpo: identificado(ok1.referencia, "POS-HML-APROVADO") });
  check(v1.status === 200 && v1.processed === "linked", `evento smartpos.identificado vincula o Smart POS (${v1.status} ${v1.processed})`);
  const l1 = await pareamento(ok1.referencia);
  check(l1.status === "vinculado" && l1.smartpos_id === "POS-HML-APROVADO" && !!l1.linked_at && l1.company_id === A.companyId, "pareamento certo vira vinculado com o smartposId");
  const outro = await pareamento(ok2.referencia);
  check(outro.status === "aguardando" && outro.smartpos_id === null, "o outro pareamento da empresa não é afetado");
  const ev1 = await eventoDb(eid("1"));
  check(!!ev1?.processed_at && ev1?.error === null && ev1?.referencia === ok1.referencia, "evento marcado como processado, sem erro");

  // ----- idempotência -----
  const v1b = await evento({ id: eid("1"), corpo: identificado(ok1.referencia, "POS-HML-APROVADO") });
  const l1b = await pareamento(ok1.referencia);
  const ev1b = await eventoDb(eid("1"));
  check(v1b.status === 200 && v1b.duplicate === true && v1b.processed === "already_processed", `reenvio do mesmo X-ConnectTEF-Event-Id é idempotente (${v1b.processed})`);
  check(l1b.linked_at === l1.linked_at && l1b.updated_at === l1.updated_at && ev1b.delivery_count === 2, "reenvio não altera o vínculo; só conta a entrega");
  const simult = await Promise.all(Array.from({ length: 5 }, () => evento({ id: eid("2"), corpo: identificado(ok2.referencia, "POS-HML-NEGADO") })));
  const l2 = await pareamento(ok2.referencia);
  check(simult.every((r) => r.status === 200) && l2.status === "vinculado" && l2.smartpos_id === "POS-HML-NEGADO", "5 entregas simultâneas do mesmo evento: vincula uma vez");
  check((await eventoDb(eid("2"))).delivery_count === 5, "as 5 entregas foram contadas numa só linha de evento");

  // ----- reler o QR no mesmo aparelho -----
  const ok3 = await parear(A, { documentoCliente: DOC_OK });
  const v3 = await evento({ id: eid("3"), corpo: identificado(ok3.referencia, "POS-HML-APROVADO") });
  const doAparelho = (await admin.from("connecttef_smartpos").select("referencia").eq("company_id", A.companyId).eq("smartpos_id", "POS-HML-APROVADO")).data;
  check(v3.processed === "linked" && doAparelho.length === 1 && doAparelho[0].referencia === ok3.referencia, "reler o QR no mesmo Smart POS substitui a vinculação anterior (sem duplicar)");

  // ----- mesma id de teste em outra empresa -----
  const okB = await parear(B, { documentoCliente: DOC_OK2 });
  const vB = await evento({ id: eid("4"), corpo: identificado(okB.referencia, "POS-HML-APROVADO") });
  check(vB.processed === "linked" && (await pareamento(okB.referencia)).company_id === B.companyId, "o Smart POS virtual de teste pode ser usado por outra empresa");
  check((await pareamento(ok3.referencia)).status === "vinculado", "a vinculação da empresa A continua intacta");

  // ----- eventos inválidos / não reconhecidos -----
  const okC = await parear(A, { documentoCliente: DOC_OK });
  const semSmartpos = await evento({ id: eid("5"), corpo: { evento: "smartpos.identificado", dados: { referencia: okC.referencia } } });
  check(semSmartpos.processed === "invalid" && (await pareamento(okC.referencia)).status === "aguardando", "evento sem smartposId não vincula (fica com erro registrado)");
  check(/smartposId/.test((await eventoDb(eid("5"))).error || ""), "o erro fica registrado no evento");
  const refDesconhecida = await evento({ id: eid("6"), corpo: identificado(randomUUID(), "POS-X") });
  check(refDesconhecida.processed === "invalid" && /desconhecida/.test((await eventoDb(eid("6"))).error || ""), "referencia desconhecida não vincula nada");
  const refRuim = await evento({ id: eid("7"), corpo: identificado("nao-e-uuid", "POS-X") });
  check(refRuim.processed === "invalid", "referencia que não é UUID é recusada");
  const docDiverge = await evento({ id: eid("8"), corpo: identificado(okC.referencia, "POS-X", { documentoCliente: DOC_OK2 }) });
  check(docDiverge.processed === "invalid" && (await pareamento(okC.referencia)).status === "aguardando", "documentoCliente diferente do pareamento não vincula");
  const docIgual = await evento({ id: eid("9"), corpo: identificado(okC.referencia, "POS-HML-OUTRO", { documentoCliente: mascarado(DOC_OK) }) });
  check(docIgual.processed === "linked", "documentoCliente igual (mesmo com máscara) vincula");
  const trocaAparelho = await evento({ id: eid("10"), corpo: identificado(okC.referencia, "POS-HML-DIFERENTE") });
  check(trocaAparelho.processed === "invalid" && (await pareamento(okC.referencia)).smartpos_id === "POS-HML-OUTRO", "pareamento já vinculado não troca de Smart POS");
  const smartposRuim = await evento({ id: eid("11"), corpo: identificado((await parear(A, { documentoCliente: DOC_OK })).referencia, "id com espaço/@") });
  check(smartposRuim.processed === "invalid", "smartposId com caracteres inválidos é recusado");
  const pagamento = await evento({ id: eid("12"), tipo: "pagamento.aprovado", corpo: { evento: "pagamento.aprovado", dados: { referencia: okC.referencia, smartposId: "POS-QUALQUER", valorCentavos: 100 } } });
  const evPag = await eventoDb(eid("12"));
  check(pagamento.status === 200 && pagamento.processed === "invalid" && /desconhecida/.test(evPag.error || ""), "pagamento.aprovado de uma referência que não é de pagamento é recusado como inválido, sem efeito");
  check((await pareamento(okC.referencia)).smartpos_id === "POS-HML-OUTRO", "evento de pagamento não altera o Smart POS");

  // ===== RLS =====
  const lerCaixa = await C.sb.from("connecttef_smartpos").select("referencia, smartpos_id").eq("company_id", A.companyId);
  check((lerCaixa.data || []).length >= 3, "usuário da empresa lê os Smart POS (RLS por company_id)");
  const lerB = await B.sb.from("connecttef_smartpos").select("id").eq("company_id", A.companyId);
  check((lerB.data || []).length === 0, "outra empresa não lê os Smart POS da empresa A");
  const lerA_B = await A.sb.from("connecttef_smartpos").select("id").eq("company_id", B.companyId);
  check((lerA_B.data || []).length === 0, "a empresa A não lê os da empresa B");
  const anon = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const lerAnon = await anon.from("connecttef_smartpos").select("id").limit(1);
  check(!!lerAnon.error || (lerAnon.data || []).length === 0, "anônimo não lê");
  const escr = await A.sb.from("connecttef_smartpos").insert({ company_id: A.companyId, documento_cliente: DOC_OK, referencia: randomUUID(), smartpos_id: "FORJADO", status: "vinculado" });
  check(!!escr.error, "usuário (nem admin) grava Smart POS direto na tabela");
  const upd = await A.sb.from("connecttef_smartpos").update({ smartpos_id: "FORJADO" }).eq("referencia", ok3.referencia).select();
  check((upd.data || []).length === 0 && (await pareamento(ok3.referencia)).smartpos_id === "POS-HML-APROVADO", "usuário não altera o vínculo direto na tabela");
  const del = await A.sb.from("connecttef_smartpos").delete().eq("referencia", ok3.referencia).select();
  check((del.data || []).length === 0 && !!(await pareamento(ok3.referencia)), "usuário não apaga o vínculo direto na tabela");
  const rpc = await A.sb.rpc("process_connecttef_event", { p_event_id: eid("1") });
  check(!!rpc.error, "usuário não executa process_connecttef_event");
  // ===== Logs das funções: status visível, segredos não =====
  await new Promise((r) => setTimeout(r, 500));
  check(/"status":404/.test(logsFuncoes) && /"tipo":"rota"/.test(logsFuncoes), "o log registra o status HTTP e o tipo do erro (rota)");
  check(/"status":403/.test(logsFuncoes) && /"tipo":"credencial"/.test(logsFuncoes), "o log registra 403 de credencial");
  check(/"codigo":"CLIENTE_NAO_AUTORIZADO"/.test(logsFuncoes), "o log registra o código do ConnectTEF");
  check(!logsFuncoes.includes(API_KEY), "a API Key não aparece nos logs");
  check(!logsFuncoes.includes(WEBHOOK_TOKEN), "o token do webhook não aparece nos logs");
  check(!logsFuncoes.includes(A.token) && !logsFuncoes.includes("Bearer "), "o Authorization do usuário não aparece nos logs");
  check(!logsFuncoes.includes(DOC_OK), "o documento do cliente não aparece nos logs");
} finally {
  // ===== Limpeza =====
  await admin.from("connecttef_events").delete().like("event_id", `smoke-pair-${stamp}-%`);
  for (const t of [A, B]) if (t.companyId) await admin.from("companies").delete().eq("id", t.companyId);
  for (const id of usuarios) await admin.auth.admin.deleteUser(id);
  for (const p of filhos) p.kill();
  mock.close();
}

console.log("\nSmoke — pareamento de Smart POS do ConnectTEF (QR Code, webhook, RLS)\n");
for (const m of ok) console.log(`  PASS  ${m}`);
for (const m of falhas) console.log(`  FAIL  ${m}`);
console.log(`\n${ok.length} passaram, ${falhas.length} falharam\n`);
process.exit(falhas.length ? 1 : 0);
