/**
 * Smoke do webhook do ConnectTEF (connecttef-webhook): autenticação Bearer,
 * idempotência pelo X-ConnectTEF-Event-Id, validação do corpo, resposta rápida
 * e RLS da tabela connecttef_events. Payloads simulados — nada vem do ConnectTEF.
 *
 * O token do webhook NÃO vem do .env.local: é o secret CONNECTTEF_WEBHOOK_TOKEN
 * da função. Para testar código ainda não deployado, suba a função localmente
 * com um token qualquer e passe o mesmo aqui:
 *
 *   DENO_SERVE_ADDRESS=tcp:127.0.0.1:8003 CONNECTTEF_WEBHOOK_TOKEN=<token> \
 *     SUPABASE_URL=... SUPABASE_ANON_KEY=... SUPABASE_SERVICE_ROLE_KEY=... \
 *     deno run -A supabase/functions/connecttef-webhook/index.ts
 *   WEBHOOK_URL=http://127.0.0.1:8003 WEBHOOK_TOKEN=<token> \
 *     node scripts/smoke-connecttef-webhook.mjs
 *
 * Contra a função deployada, WEBHOOK_TOKEN precisa ser o secret real.
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
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    env[m[1].trim()] = v;
  }
  return env;
}

const env = loadEnvLocal();
const URL_WEBHOOK = process.env.WEBHOOK_URL || `${env.VITE_SUPABASE_URL.replace(/\/$/, "")}/functions/v1/connecttef-webhook`;
const TOKEN = process.env.WEBHOOK_TOKEN;
if (!TOKEN) {
  console.error("Defina WEBHOOK_TOKEN (o mesmo valor do secret CONNECTTEF_WEBHOOK_TOKEN da função).");
  process.exit(2);
}

const admin = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const falhas = [];
const ok = [];
const check = (cond, msg) => (cond ? ok.push(msg) : falhas.push(msg));

const stamp = Date.now();
const idDe = (n) => `smoke-${stamp}-${n}`;
const criados = [];

const enviar = async ({ token = TOKEN, eventId, tipo, corpo, metodo = "POST", cru } = {}) => {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (eventId) headers["X-ConnectTEF-Event-Id"] = eventId;
  if (tipo) headers["X-ConnectTEF-Event-Type"] = tipo;
  const inicio = Date.now();
  const res = await fetch(URL_WEBHOOK, {
    method: metodo,
    headers,
    body: metodo === "GET" ? undefined : cru ?? JSON.stringify(corpo ?? {}),
  });
  const json = await res.json().catch(() => ({}));
  if (eventId) criados.push(eventId);
  return { status: res.status, ms: Date.now() - inicio, ...json };
};
const linhas = async (eventId) => (await admin.from("connecttef_events").select("*").eq("event_id", eventId)).data || [];

const aprovado = (referencia) => ({
  id: "evt-corpo",
  evento: "pagamento.aprovado",
  dados: {
    referencia,
    status: "aprovado",
    valorCentavos: 14990,
    formaPagamento: "credito",
    parcelas: 1,
    smartposId: "POS001",
    bandeiraCartao: "VISA",
    autorizacao: { codigo: "123456", numeroTransacao: "987654", dadosFinalizacao: "xyz" },
  },
});

// ---------- Autenticação ----------
const semAuth = await enviar({ token: null, eventId: idDe("a"), corpo: aprovado("r-a") });
check(semAuth.status === 401, `sem Authorization é recusado (${semAuth.status})`);
const tokenErrado = await enviar({ token: `${TOKEN}x`, eventId: idDe("b"), corpo: aprovado("r-b") });
check(tokenErrado.status === 401, `token errado é recusado (${tokenErrado.status})`);
const tokenCurto = await enviar({ token: TOKEN.slice(0, -1), eventId: idDe("b2"), corpo: aprovado("r-b2") });
check(tokenCurto.status === 401, "token com um caractere a menos é recusado");
const bearerSozinho = await enviar({ token: " ", eventId: idDe("b3"), corpo: aprovado("r-b3") });
check(bearerSozinho.status === 401, "Bearer vazio é recusado");
check((await linhas(idDe("a"))).length === 0 && (await linhas(idDe("b"))).length === 0, "requisição não autenticada não grava nada");
const get = await enviar({ metodo: "GET" });
check(get.status === 405, `GET é recusado (${get.status})`);

// ---------- Corpo ----------
const jsonRuim = await enviar({ eventId: idDe("c"), cru: "{nao-e-json" });
check(jsonRuim.status === 400, `JSON inválido é 400 (${jsonRuim.status})`);
const arrayNoCorpo = await enviar({ eventId: idDe("c2"), cru: "[1,2]" });
check(arrayNoCorpo.status === 400, "corpo que não é objeto é 400");
const semId = await enviar({ corpo: { evento: "pagamento.aprovado", dados: { referencia: "r-d" } } });
check(semId.status === 400, `evento sem identificador é 400 (${semId.status})`);
const grande = await enviar({ eventId: idDe("g"), corpo: { lixo: "x".repeat(300 * 1024) } });
check(grande.status === 413, `corpo acima do limite é 413 (${grande.status})`);
check((await linhas(idDe("g"))).length === 0, "corpo grande não é gravado");

// ---------- Registro ----------
const REF = `ref-${stamp}`;
const primeiro = await enviar({ eventId: idDe("1"), tipo: "pagamento.aprovado", corpo: aprovado(REF) });
check(primeiro.status === 200 && primeiro.received === true && primeiro.duplicate === false, `evento válido responde 200 (${primeiro.status} ${JSON.stringify({ r: primeiro.received, d: primeiro.duplicate })})`);
check(primeiro.ms < 1500, `resposta rápida (${primeiro.ms} ms)`);
const l1 = await linhas(idDe("1"));
check(l1.length === 1 && l1[0].event_type === "pagamento.aprovado" && l1[0].referencia === REF, "evento gravado com tipo e referência");
check(l1[0]?.payload?.dados?.autorizacao?.numeroTransacao === "987654" && l1[0]?.payload?.dados?.valorCentavos === 14990, "payload guardado inteiro (dados da autorização preservados para estorno)");
// Desde a etapa de pagamento, pagamento.aprovado é processado — e como esta referência não
// é de nenhuma operação, vira evento inválido registrado, sem aprovar nada.
check(!!l1[0]?.processed_at && /referencia/.test(l1[0]?.error || "") && l1[0]?.delivery_count === 1, "pagamento.aprovado de uma referência que não é de nenhuma operação é registrado e marcado inválido (nada é aprovado)");

// ---------- Idempotência ----------
const repetido = await enviar({ eventId: idDe("1"), tipo: "pagamento.aprovado", corpo: aprovado(REF) });
check(repetido.status === 200 && repetido.duplicate === true, `reenvio do mesmo evento responde 200 e marca duplicado (${repetido.status} ${repetido.duplicate})`);
const l1b = await linhas(idDe("1"));
check(l1b.length === 1 && l1b[0].delivery_count === 2, `reenvio não cria linha; só conta a entrega (${l1b.length} linha, ${l1b[0]?.delivery_count} entregas)`);
check(JSON.stringify(l1b[0].payload) === JSON.stringify(l1[0].payload), "o payload original não é sobrescrito pelo reenvio");

const reenvioComOutroCorpo = await enviar({ eventId: idDe("1"), corpo: { evento: "pagamento.recusado", dados: { referencia: "outra" } } });
const l1c = await linhas(idDe("1"));
check(reenvioComOutroCorpo.status === 200 && l1c[0].event_type === "pagamento.aprovado" && l1c[0].referencia === REF, "mesmo event id com corpo diferente não altera o evento já registrado");

const outroEvento = await enviar({ eventId: idDe("2"), tipo: "estorno.falhou", corpo: { evento: "estorno.falhou", dados: { referencia: REF } } });
check(outroEvento.status === 200 && outroEvento.duplicate === false && (await linhas(idDe("2"))).length === 1, "outro event id da mesma referência é outro evento");

const porCorpo = await enviar({ corpo: { id: idDe("3"), tipo: "smartpos.identificado", referencia: "loja-1" } });
const l3 = await linhas(idDe("3"));
criados.push(idDe("3"));
check(porCorpo.status === 200 && l3.length === 1 && l3[0].event_type === "smartpos.identificado" && l3[0].referencia === "loja-1", "sem o header, usa o id do corpo, o tipo do corpo e a referência de nível superior");

const simultaneos = await Promise.all(Array.from({ length: 6 }, () => enviar({ eventId: idDe("4"), corpo: aprovado("r-conc") })));
const l4 = await linhas(idDe("4"));
check(simultaneos.every((r) => r.status === 200) && l4.length === 1 && l4[0].delivery_count === 6, `6 entregas simultâneas do mesmo evento: 1 linha, 6 entregas (${l4.length} linha, ${l4[0]?.delivery_count})`);
check(simultaneos.filter((r) => r.duplicate === false).length === 1, "exatamente uma das entregas simultâneas foi a primeira");

// ---------- Nada é processado ----------
const { count: vendas } = await admin.from("sales").select("id", { count: "exact", head: true }).eq("pix_payment_id", REF);
check((vendas ?? 0) === 0, "o webhook não toca em vendas");

// ---------- RLS / permissões ----------
const anon = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
const lerAnon = await anon.from("connecttef_events").select("id").limit(1);
check(!!lerAnon.error || (lerAnon.data || []).length === 0, "anônimo não lê os eventos");
const inserirAnon = await anon.from("connecttef_events").insert({ event_id: idDe("x"), payload: {} });
check(!!inserirAnon.error, "anônimo não grava eventos");
const rpcAnon = await anon.rpc("record_connecttef_event", { p_event_id: idDe("y"), p_event_type: null, p_referencia: null, p_payload: {} });
check(!!rpcAnon.error, "anônimo não executa a função de registro");

const emailU = `guarni07+mf.ctef.${stamp}@gmail.com`;
const senhaU = `Ctef-${stamp}aA1!`;
const { data: u } = await admin.auth.admin.createUser({ email: emailU, password: senhaU, email_confirm: true });
const usuario = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
await usuario.auth.signInWithPassword({ email: emailU, password: senhaU });
const lerUser = await usuario.from("connecttef_events").select("id").limit(1);
check(!!lerUser.error || (lerUser.data || []).length === 0, "usuário logado (lojista) não lê os eventos");
const inserirUser = await usuario.from("connecttef_events").insert({ event_id: idDe("z"), payload: {} });
check(!!inserirUser.error, "usuário logado não grava eventos");
const apagarUser = await usuario.from("connecttef_events").delete().eq("event_id", idDe("1")).select();
check((apagarUser.data || []).length === 0 && (await linhas(idDe("1"))).length === 1, "usuário logado não apaga eventos");
const rpcUser = await usuario.rpc("record_connecttef_event", { p_event_id: idDe("w"), p_event_type: null, p_referencia: null, p_payload: {} });
check(!!rpcUser.error, "usuário logado não executa a função de registro");
await admin.auth.admin.deleteUser(u.user.id);

// ---------- Limpeza ----------
await admin.from("connecttef_events").delete().like("event_id", `smoke-${stamp}-%`);

console.log("\nSmoke — webhook do ConnectTEF (autenticação, idempotência, RLS)\n");
for (const m of ok) console.log(`  PASS  ${m}`);
for (const m of falhas) console.log(`  FAIL  ${m}`);
console.log(`\n${ok.length} passaram, ${falhas.length} falharam\n`);
process.exit(falhas.length ? 1 : 0);
