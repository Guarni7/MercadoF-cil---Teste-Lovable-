/**
 * Smoke do canal do cartão (PR 1): separa forma de pagamento (crédito/débito) do canal que
 * processa (maquininha independente | TEF/PIN pad | Smart POS/ConnectTEF).
 *
 * Parte A (sem rede): src/lib/cardChannel.js — canalDaConfig, resolverCanalCartao e
 * canalDoPagamento (inclui a prioridade: o canal escolhido vale sobre existir Smart POS).
 * Parte B (Supabase real, empresas de teste apagadas no fim): migration 077 — padrão
 * 'maquininha' e check do canal.
 * Parte C (Edge Function save-payment-settings rodando localmente com deno): valida
 * card_channel, exige Smart POS vinculado para 'smartpos' e agente para 'tef', só admin.
 * Parte D (escrita DIRETA na tabela, sem a Edge Function, como usuário da empresa): a RLS da
 * migration 078 recusa 'smartpos' sem Smart POS vinculado e 'tef' sem agente.
 * Também confere que o checkout (CheckoutDialog) e o ConnectTEF não foram tocados.
 *
 * Requer `deno` no PATH. Uso: node scripts/smoke-card-channel.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { spawn } from "child_process";
import { randomUUID } from "crypto";
import { readFileSync } from "fs";
import { resolve } from "path";
import { CANAIS_CARTAO, CANAL_PADRAO, ROTULOS_CANAL, canalValido, canalDaConfig, canalDecidido, resolverCanalCartao, canalDoPagamento } from "../src/lib/cardChannel.js";

const falhas = [];
const ok = [];
const check = (cond, msg) => (cond ? ok.push(msg) : falhas.push(msg));
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- Parte A: funções puras ----------
check(CANAIS_CARTAO.join() === "maquininha,tef,smartpos" && CANAL_PADRAO === "maquininha", "canais: maquininha, tef, smartpos; padrão maquininha (empresa nova)");
check(canalValido("tef") && !canalValido("pix") && !canalValido(undefined) && !canalValido(""), "canalValido só aceita os três canais");
check(Object.keys(ROTULOS_CANAL).join() === CANAIS_CARTAO.join(), "todo canal tem rótulo");

// canalDaConfig
check(canalDaConfig({ card_channel: "tef" }, { temSmartPos: true }) === "tef", "o canal escolhido (tef) vale sobre existir Smart POS vinculado");
check(canalDaConfig({ card_channel: "maquininha", tef_enabled: true, tef_agent_url: "http://localhost:8080" }, { temSmartPos: true }) === "maquininha", "o canal escolhido (maquininha) vale sobre Smart POS e TEF ligados");
check(canalDaConfig({ card_channel: "smartpos" }) === "smartpos", "canal smartpos explícito");
check(canalDaConfig({ card_channel: null }, { temSmartPos: true }) === "smartpos", "sem canal gravado, Smart POS vinculado deduz smartpos (como o checkout atual)");
check(canalDaConfig({ card_channel: null, tef_enabled: true, tef_agent_url: "http://localhost:8080" }) === "tef", "sem canal gravado, TEF ligado com agente (e sem Smart POS) deduz tef");
check(canalDaConfig({ card_channel: null, tef_enabled: true, tef_agent_url: "http://localhost:8080" }, { temSmartPos: true }) === "smartpos", "sem canal gravado, Smart POS tem prioridade sobre TEF (como hoje)");
check(canalDaConfig({ card_channel: null, tef_enabled: true, tef_agent_url: "  " }) === "maquininha", "TEF ligado sem endereço de agente não conta: maquininha");
check(canalDaConfig({ card_channel: null }) === "maquininha" && canalDaConfig({}) === "maquininha" && canalDaConfig(null) === "maquininha", "empresa sem nada configurado: maquininha");
check(canalDaConfig({ card_channel: "xyz" }, { temSmartPos: true }) === "smartpos", "valor inválido é ignorado e o canal é deduzido");

// resolverCanalCartao
const base = { card_enabled: true, tef_enabled: true, tef_agent_url: "http://localhost:8080" };
let r = resolverCanalCartao({ config: { ...base, card_channel: "maquininha" }, estadoSmartPos: "ativo" });
check(r.habilitado && r.canal === "maquininha" && r.liberado && r.motivo === null, "maquininha escolhida com Smart POS vinculado: usa a maquininha, não o Smart POS");
r = resolverCanalCartao({ config: { ...base, card_channel: "tef" }, estadoSmartPos: "ativo" });
check(r.canal === "tef" && r.liberado, "tef escolhido com Smart POS vinculado: usa o TEF");
r = resolverCanalCartao({ config: { ...base, card_channel: "smartpos" }, estadoSmartPos: "ativo" });
check(r.canal === "smartpos" && r.liberado, "smartpos escolhido e vinculado: liberado");
for (const estado of ["inativo", "indeterminado", "verificando"]) {
  r = resolverCanalCartao({ config: { ...base, card_channel: "smartpos" }, estadoSmartPos: estado });
  check(r.canal === "smartpos" && !r.liberado && !!r.motivo, `smartpos escolhido e Smart POS '${estado}': bloqueado com motivo (não cai em outro canal)`);
}
r = resolverCanalCartao({ config: { ...base, card_channel: "tef", tef_enabled: false }, estadoSmartPos: "inativo" });
check(r.canal === "tef" && !r.liberado && /agente TEF/.test(r.motivo), "tef escolhido sem TEF ligado: bloqueado (não aprova sozinho)");
r = resolverCanalCartao({ config: { ...base, card_channel: "tef", tef_agent_url: "" }, estadoSmartPos: "inativo" });
check(!r.liberado, "tef escolhido sem endereço do agente: bloqueado");
r = resolverCanalCartao({ config: { ...base, card_channel: "maquininha", card_enabled: false }, estadoSmartPos: "ativo" });
check(!r.habilitado && !r.liberado && /desativado/i.test(r.motivo), "card_enabled falso: crédito e débito desabilitados, qualquer canal");
r = resolverCanalCartao({ config: { card_enabled: undefined, card_channel: "maquininha" } });
check(r.habilitado, "card_enabled ausente conta como ligado (padrão do banco)");
r = resolverCanalCartao({ config: { card_channel: null, ...base }, estadoSmartPos: "ativo", temSmartPos: true });
check(r.canal === "smartpos" && r.liberado, "sem canal gravado e com Smart POS: mesmo comportamento de hoje (smartpos)");

// canalDecidido: o que dá para congelar ao abrir o checkout
check(canalDecidido({ card_channel: "tef" }, "verificando") === "tef" && canalDecidido({ card_channel: "maquininha" }, "indeterminado") === "maquininha", "canal gravado congela mesmo sem saber do Smart POS");
check(canalDecidido({ card_channel: null }, "ativo") === "smartpos", "sem canal gravado e com Smart POS vinculado: smartpos");
check(canalDecidido({ card_channel: null, tef_enabled: true, tef_agent_url: "http://localhost:8080" }, "inativo") === "tef" && canalDecidido({ card_channel: null }, "inativo") === "maquininha", "sem canal gravado e sem Smart POS: tef (se ligado) ou maquininha");
check(canalDecidido({ card_channel: null }, "indeterminado") === null && canalDecidido({ card_channel: null }, "verificando") === null && canalDecidido(null, "ativo") === null, "sem canal gravado e sem saber do Smart POS (ou sem configuração): não decide");
// canal não gravado + Smart POS sem resposta: bloqueia
r = resolverCanalCartao({ config: { card_enabled: true, card_channel: null }, estadoSmartPos: "indeterminado" });
check(!r.liberado && r.canal === null && /determinar o canal/.test(r.motivo), "sem canal gravado e Smart POS sem resposta: cartão bloqueado (não chuta maquininha)");
r = resolverCanalCartao({ config: { card_enabled: true, card_channel: null }, estadoSmartPos: "verificando" });
check(!r.liberado && r.canal === null, "sem canal gravado enquanto verifica o Smart POS: bloqueado");

// canalDoPagamento
check(canalDoPagamento({ method: "pix", amount: 5 }) === null && canalDoPagamento({ method: "dinheiro" }) === null && canalDoPagamento(null) === null, "pagamento que não é cartão não tem canal");
check(canalDoPagamento({ method: "credito", channel: "tef" }) === "tef" && canalDoPagamento({ method: "debito", channel: "smartpos" }) === "smartpos", "pagamento novo traz o canal");
check(canalDoPagamento({ method: "credito", provider: "connecttef", connectTefPaymentId: "x" }) === "smartpos", "pagamento antigo com provider connecttef: smartpos");
check(canalDoPagamento({ method: "credito", transactionId: "tx-1" }) === "tef", "pagamento antigo com transactionId: tef");
check(canalDoPagamento({ method: "debito", transactionId: null }) === "maquininha" && canalDoPagamento({ method: "credito" }) === "maquininha", "pagamento antigo de cartão sem marca: maquininha");
check(canalDoPagamento({ method: "credito", channel: "xyz", provider: "connecttef" }) === "smartpos", "channel inválido cai na dedução");

// ---------- ligação no código: checkout e ConnectTEF intocados ----------
{
  const ler = (p) => readFileSync(resolve(process.cwd(), p), "utf8").split("\r\n").join("\n");
  const dlg = ler("src/components/pos/CheckoutDialog.jsx");
  check(dlg.includes("useCanalCartao(open)") && !dlg.includes("useConnectTefEstado"), "o checkout escolhe o canal por useCanalCartao (configuração da empresa), não mais pela existência de Smart POS");
  const tab = ler("src/components/config/PagamentoTab.jsx");
  check(
    tab.includes("estadoDaConfig(cfg, { temSmartPos: vinculado })") &&
      ler("src/lib/pagamentoTabEstado.js").includes("canalDaConfig(c, { temSmartPos: tsp })") &&
      tab.includes("handleSaveCanal") &&
      tab.includes('role="radiogroup"'),
    "PagamentoTab: seção do canal com os três canais e salvar próprio (canal deduzido por canalDaConfig, via estadoDaConfig)",
  );
  check(!/próxima atualização/.test(tab) && !tab.includes("regra anterior"), "PagamentoTab: sem o aviso de que o canal só vale numa atualização futura (o checkout já usa o canal configurado)");
  check(!tab.includes("Exibir cartão no checkout"), "PagamentoTab: o botão de exibir cartão saiu do bloco da maquininha (agora na seção do canal)");
  const fn = ler("supabase/functions/save-payment-settings/index.ts");
  check(fn.includes('"card_channel"') && fn.includes('CANAIS_CARTAO = ["maquininha", "tef", "smartpos"]'), "save-payment-settings aceita card_channel e conhece os três canais");
  const migr = ler("supabase/migrations/077_card_channel.sql");
  check(migr.includes("'smartpos'") && migr.includes("tef_agent_url") && migr.indexOf("'smartpos'") < migr.indexOf("'tef'"), "migration 077: Smart POS tem prioridade sobre TEF no preenchimento");
}

// ---------- Parte B e C: banco real + função local ----------
function loadEnvLocal() {
  const env = {};
  for (const line of readFileSync(resolve(process.cwd(), ".env.local"), "utf8").split(/\r?\n/)) {
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
const PORTA = 8231;
const stamp = Date.now();
const usuarios = [];
const empresas = [];
let filho = null;
let logsFuncao = "";
try {
  filho = spawn("deno", ["run", "-A", resolve(process.cwd(), "supabase/functions/save-payment-settings/index.ts")], {
    env: { ...process.env, SUPABASE_URL: env.VITE_SUPABASE_URL, SUPABASE_ANON_KEY: env.VITE_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY: env.SUPABASE_SERVICE_ROLE_KEY, DENO_SERVE_ADDRESS: `tcp:127.0.0.1:${PORTA}` },
    stdio: ["ignore", "pipe", "pipe"],
  });
  filho.stdout.on("data", (d) => (logsFuncao += d));
  filho.stderr.on("data", (d) => (logsFuncao += d));
  for (let i = 0; i < 60; i++) {
    try { await fetch(`http://127.0.0.1:${PORTA}`, { method: "OPTIONS" }); break; } catch { await espera(1000); }
  }

  async function novaEmpresa(tag) {
    const email = `guarni07+mf.cardch.${tag}.${stamp}@gmail.com`;
    const password = `Cch-${stamp}aA1!`;
    const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    usuarios.push(data.user.id);
    const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: s } = await sb.auth.signInWithPassword({ email, password });
    const { data: c } = await sb.rpc("bootstrap_company", { p_trade_name: `Canal ${tag} ${stamp}`, p_email: email });
    const companyId = typeof c === "string" ? c : c?.id;
    empresas.push(companyId);
    return { sb, id: data.user.id, token: s.session.access_token, companyId };
  }
  const salvar = async (empresa, corpo) => {
    await admin.from("rate_limit_hits").delete().like("key", `%${empresa.companyId}%`);
    const res = await fetch(`http://127.0.0.1:${PORTA}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: env.VITE_SUPABASE_ANON_KEY, Authorization: `Bearer ${empresa.token}` },
      body: JSON.stringify(corpo),
    });
    return { status: res.status, ...(await res.json().catch(() => ({}))) };
  };
  const linha = async (empresa) => (await admin.from("company_payment_settings").select("*").eq("company_id", empresa.companyId).maybeSingle()).data;

  const A = await novaEmpresa("a");
  const perfil = (await admin.from("profiles").select("role").eq("id", A.id).single()).data;

  // ----- B: padrão e check da migration 077 -----
  const insDefault = await admin.from("company_payment_settings").insert({ company_id: A.companyId }).select("card_channel").single();
  check(!insDefault.error && insDefault.data.card_channel === "maquininha", `migration 077: empresa nova (linha sem canal) fica 'maquininha' (${insDefault.error?.message || insDefault.data?.card_channel})`);
  const invalido = await admin.from("company_payment_settings").update({ card_channel: "pix" }).eq("company_id", A.companyId);
  check(!!invalido.error && /check/i.test(invalido.error.message), `o banco recusa canal inválido (${invalido.error?.message || "aceitou!"})`);
  const nulo = await admin.from("company_payment_settings").update({ card_channel: null }).eq("company_id", A.companyId);
  check(!!nulo.error, "o banco recusa canal nulo");
  await admin.from("company_payment_settings").delete().eq("company_id", A.companyId);

  // ----- C: Edge Function -----
  check(perfil?.role === "admin", `o usuário da empresa de teste é administrador (role=${perfil?.role})`);
  let res = await salvar(A, { card_channel: "xyz" });
  check(res.status === 400 && /inválido/i.test(res.error || ""), `canal inválido é recusado (${res.status})`);
  check(!(await linha(A)), "canal inválido não cria nem altera a configuração");

  res = await salvar(A, { card_channel: "smartpos" });
  check(res.status === 409 && /Smart POS/.test(res.error || ""), `smartpos sem Smart POS vinculado é recusado (${res.status})`);
  check(!(await linha(A)), "smartpos recusado não grava nada");

  res = await salvar(A, { card_channel: "tef", tef_agent_url: "   " });
  check(res.status === 409 && /agente TEF/.test(res.error || ""), `tef sem endereço do agente é recusado (${res.status})`);

  res = await salvar(A, { card_channel: "tef", tef_enabled: true, tef_agent_url: "http://localhost:8080" });
  let l = await linha(A);
  check(res.status === 200 && l?.card_channel === "tef" && l?.tef_enabled === true && res.settings?.card_channel === "tef", `tef com agente informado é aceito e gravado (${res.status})`);

  res = await salvar(A, { card_channel: "maquininha", card_enabled: false });
  l = await linha(A);
  check(res.status === 200 && l?.card_channel === "maquininha" && l?.card_enabled === false, "maquininha aceita; card_enabled falso é gravado");

  // Smart POS vinculado: passa a poder escolher smartpos; o pareamento não é tocado
  const ref = randomUUID();
  await admin.from("connecttef_smartpos").insert({ company_id: A.companyId, documento_cliente: "11222333000181", referencia: ref, smartpos_id: "POS-TESTE-CANAL", status: "vinculado", linked_at: new Date().toISOString() });
  res = await salvar(A, { card_channel: "smartpos" });
  l = await linha(A);
  check(res.status === 200 && l?.card_channel === "smartpos", `smartpos com Smart POS vinculado é aceito (${res.status})`);
  const pareamento = (await admin.from("connecttef_smartpos").select("status, smartpos_id").eq("referencia", ref).single()).data;
  check(pareamento.status === "vinculado" && pareamento.smartpos_id === "POS-TESTE-CANAL", "escolher o canal não mexe no pareamento do Smart POS (ConnectTEF intacto)");

  // trocar para maquininha com Smart POS vinculado vale (o canal escolhido manda)
  res = await salvar(A, { card_channel: "maquininha" });
  l = await linha(A);
  check(res.status === 200 && l?.card_channel === "maquininha", "com Smart POS vinculado, escolher a maquininha é permitido e é gravado");

  // salvar outros campos sem mandar canal mantém o canal
  res = await salvar(A, { pix_mode: "manual", pix_key: "teste@exemplo.com" });
  l = await linha(A);
  check(res.status === 200 && l?.card_channel === "maquininha" && l?.pix_key === "teste@exemplo.com", "salvar outros campos (PIX) não altera o canal");

  // primeira gravação sem canal: padrão do banco
  const B = await novaEmpresa("b");
  res = await salvar(B, { pix_mode: "manual", pix_key: "b@exemplo.com" });
  l = await linha(B);
  check(res.status === 200 && l?.card_channel === "maquininha", "primeira gravação sem canal: a empresa nova fica na maquininha");

  // não-administrador não altera
  const C = await novaEmpresa("c");
  await admin.from("profiles").update({ role: "user", company_role: "operator", company_id: B.companyId }).eq("id", C.id);
  res = await salvar({ ...C, companyId: B.companyId }, { card_channel: "tef", tef_agent_url: "http://localhost:8080" });
  check(res.status === 403 && (await linha(B))?.card_channel === "maquininha", `quem não é administrador não altera o canal (${res.status})`);

  // sem token
  const semAuth = await fetch(`http://127.0.0.1:${PORTA}`, { method: "POST", headers: { "Content-Type": "application/json", apikey: env.VITE_SUPABASE_ANON_KEY }, body: JSON.stringify({ card_channel: "tef" }) });
  check(semAuth.status === 401, `sem sessão é recusado (${semAuth.status})`);
  check(!/Bearer eyJ/.test(logsFuncao), "os logs da função não têm token de usuário");

  // ----- D: escrita direta na tabela (RLS da migration 078) -----
  const D = await novaEmpresa("d");
  const E = await novaEmpresa("e");
  const t = D.sb.from.bind(D.sb);
  const noBanco = async (empresa) => (await admin.from("company_payment_settings").select("*").eq("company_id", empresa.companyId).maybeSingle()).data;
  const rls = (e) => !!e && /row-level security|42501/i.test(`${e.message} ${e.code}`);

  // insert direto
  let w = await t("company_payment_settings").insert({ company_id: D.companyId, card_channel: "smartpos" });
  check(rls(w.error), `insert direto com 'smartpos' sem Smart POS vinculado é recusado pela RLS (${w.error?.code || "aceitou!"})`);
  w = await t("company_payment_settings").insert({ company_id: D.companyId, card_channel: "tef" });
  check(rls(w.error), `insert direto com 'tef' sem agente é recusado pela RLS (${w.error?.code || "aceitou!"})`);
  w = await t("company_payment_settings").insert({ company_id: D.companyId, card_channel: "tef", tef_agent_url: "   " });
  check(rls(w.error), "insert direto com 'tef' e agente em branco é recusado");
  w = await t("company_payment_settings").insert({ company_id: D.companyId, card_channel: "xyz" });
  check(!!w.error && /check/i.test(w.error.message), `insert direto com canal inválido é recusado pelo check (${w.error?.code || "aceitou!"})`);
  check(!(await noBanco(D)), "nenhuma das tentativas recusadas gravou linha");
  w = await t("company_payment_settings").insert({ company_id: D.companyId, card_channel: "maquininha" });
  check(!w.error && (await noBanco(D))?.card_channel === "maquininha", "insert direto com 'maquininha' é permitido");
  w = await t("company_payment_settings").insert({ company_id: E.companyId, card_channel: "maquininha" });
  check(rls(w.error), "insert direto em linha de OUTRA empresa continua recusado");

  // update direto
  w = await t("company_payment_settings").update({ card_channel: "smartpos" }).eq("company_id", D.companyId).select();
  check(rls(w.error) && (await noBanco(D))?.card_channel === "maquininha", `update direto para 'smartpos' sem Smart POS vinculado é recusado e a linha não muda (${w.error?.code || "aceitou!"})`);
  w = await t("company_payment_settings").update({ card_channel: "tef" }).eq("company_id", D.companyId).select();
  check(rls(w.error) && (await noBanco(D))?.card_channel === "maquininha", "update direto para 'tef' sem agente é recusado");
  w = await t("company_payment_settings").update({ card_channel: "tef", tef_agent_url: "http://localhost:8080" }).eq("company_id", D.companyId).select();
  check(!w.error && (await noBanco(D))?.card_channel === "tef", "update direto para 'tef' com agente informado é permitido");
  w = await t("company_payment_settings").update({ tef_agent_url: "" }).eq("company_id", D.companyId).select();
  check(rls(w.error) && (await noBanco(D))?.tef_agent_url === "http://localhost:8080", "com canal 'tef', apagar o agente por escrita direta é recusado");
  w = await t("company_payment_settings").update({ card_channel: "maquininha", tef_agent_url: "" }).eq("company_id", D.companyId).select();
  check(!w.error && (await noBanco(D))?.card_channel === "maquininha", "trocar para 'maquininha' e apagar o agente na mesma escrita é permitido");

  // upsert direto (insert ... on conflict do update)
  w = await t("company_payment_settings").upsert({ company_id: D.companyId, card_channel: "smartpos" }, { onConflict: "company_id" }).select();
  check(rls(w.error) && (await noBanco(D))?.card_channel === "maquininha", "upsert direto para 'smartpos' sem Smart POS vinculado é recusado");

  // com Smart POS vinculado
  await admin.from("connecttef_smartpos").insert({ company_id: D.companyId, documento_cliente: "11222333000181", referencia: randomUUID(), smartpos_id: "POS-TESTE-D", status: "vinculado", linked_at: new Date().toISOString() });
  w = await t("company_payment_settings").update({ card_channel: "smartpos" }).eq("company_id", D.companyId).select();
  check(!w.error && (await noBanco(D))?.card_channel === "smartpos", "com Smart POS vinculado, update direto para 'smartpos' é permitido");
  w = await t("company_payment_settings").update({ pix_key: "d@exemplo.com" }).eq("company_id", D.companyId).select();
  check(!w.error && (await noBanco(D))?.pix_key === "d@exemplo.com" && (await noBanco(D))?.card_channel === "smartpos", "com canal 'smartpos' e vínculo ativo, escrita direta de outros campos continua permitida");
  // o vínculo de OUTRA empresa não vale
  w = await E.sb.from("company_payment_settings").insert({ company_id: E.companyId, card_channel: "smartpos" });
  check(rls(w.error), "'smartpos' não vale com o Smart POS vinculado de OUTRA empresa");

  // limitação documentada: sem o vínculo, escrita direta na linha com canal smartpos fica recusada
  await admin.from("connecttef_smartpos").update({ status: "aguardando" }).eq("company_id", D.companyId);
  w = await t("company_payment_settings").update({ pix_key: "d2@exemplo.com" }).eq("company_id", D.companyId).select();
  check(rls(w.error), "sem o vínculo, escrita direta em linha com canal 'smartpos' é recusada (até trocar o canal)");
  w = await t("company_payment_settings").update({ card_channel: "maquininha", pix_key: "d2@exemplo.com" }).eq("company_id", D.companyId).select();
  check(!w.error && (await noBanco(D))?.card_channel === "maquininha" && (await noBanco(D))?.pix_key === "d2@exemplo.com", "trocar o canal para sair do impasse e salvar outros campos juntos é permitido");

  // a Edge Function (service role) segue o fluxo de antes
  res = await salvar(D, { card_channel: "maquininha", pix_key: "d3@exemplo.com" });
  check(res.status === 200 && (await noBanco(D))?.pix_key === "d3@exemplo.com", "a Edge Function continua gravando normalmente");
  res = await salvar(D, { card_channel: "smartpos" });
  check(res.status === 409 && (await noBanco(D))?.card_channel === "maquininha", "a Edge Function continua validando o vínculo");

  // leitura e exclusão da própria linha
  const lida = await t("company_payment_settings").select("card_channel").eq("company_id", D.companyId).single();
  check(!lida.error && lida.data.card_channel === "maquininha", "a empresa continua lendo a própria configuração");
  const outra = await E.sb.from("company_payment_settings").select("company_id").eq("company_id", D.companyId);
  check(!outra.error && (outra.data || []).length === 0, "uma empresa não lê a configuração da outra");
  w = await t("company_payment_settings").delete().eq("company_id", D.companyId).select();
  check(!w.error && !(await noBanco(D)), "a empresa continua podendo excluir a própria linha");
} catch (e) {
  falhas.push(`Parte B/C abortou: ${e.message}`);
} finally {
  if (filho) filho.kill();
  for (const id of empresas) if (id) await admin.from("companies").delete().eq("id", id);
  for (const id of usuarios) await admin.auth.admin.deleteUser(id);
}

console.log("\nSmoke — canal do cartão (PR 1: lógica, migration 077, Edge Function e RLS da 078)\n");
for (const m of ok) console.log(`  PASS  ${m}`);
for (const m of falhas) console.log(`  FAIL  ${m}`);
console.log(`\n${ok.length} passaram, ${falhas.length} falharam\n`);
process.exit(falhas.length ? 1 : 0);
