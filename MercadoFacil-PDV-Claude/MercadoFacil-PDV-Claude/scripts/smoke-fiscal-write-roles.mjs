/**
 * Smoke de RLS da configuração fiscal por papel: admin (owner), caixa (operator)
 * e outra empresa. Cobre company_fiscal_settings, tax_rule_sets, tax_rules e
 * fiscal_document_series (migration 071).
 *
 * Roda contra o Supabase real, em empresas de teste apagadas no fim.
 *
 * Uso: node scripts/smoke-fiscal-write-roles.mjs
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
const admin = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const falhas = [];
const ok = [];
const check = (cond, msg) => (cond ? ok.push(msg) : falhas.push(msg));
const criados = [];

async function entrar(email, password) {
  const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  await sb.auth.signInWithPassword({ email, password });
  return sb;
}

async function criarUsuario(tag) {
  const stamp = Date.now() + Math.floor(Math.random() * 1000);
  const email = `guarni07+mf.rls.${tag}.${stamp}@gmail.com`;
  const password = `Rls-${stamp}aA1!`;
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  criados.push(data.user.id);
  return { id: data.user.id, email, password };
}

async function criarEmpresa(tag) {
  const u = await criarUsuario(tag);
  const sb = await entrar(u.email, u.password);
  const { data } = await sb.rpc("bootstrap_company", { p_trade_name: `RLS ${tag} ${Date.now()}`, p_email: u.email });
  return { sb, user: u, companyId: typeof data === "string" ? data : data?.id };
}

const invocar = async (sb, fn, body) => {
  const { data, error } = await sb.functions.invoke(fn, { body });
  if (data) return data;
  try {
    return await error.context.json();
  } catch {
    return { error: error?.message || "sem resposta" };
  }
};

const A = await criarEmpresa("a"); // admin/owner da empresa A
const B = await criarEmpresa("b"); // admin de outra empresa

// Caixa da empresa A: usuário comum com papel de empresa "operator".
const cx = await criarUsuario("caixa");
await admin.from("profiles").update({ company_id: A.companyId, role: "user", company_role: "operator" }).eq("id", cx.id);
const C = await entrar(cx.email, cx.password);

// Dados da empresa A, criados pelo admin pelos mesmos caminhos da tela.
const salvou = await invocar(A.sb, "save-fiscal-settings", {
  cnpj: "11222333000181", legal_name: "Loja A Ltda", ie: "109876547", uf: "GO", city_ibge_code: "5208707",
  tax_regime: "simples", crt: "1", environment: "homologacao", nfce_enabled: true,
});
check(!salvou.error, `admin grava a configuração fiscal pela Edge Function (${salvou.error || "ok"})`);
const num = await invocar(A.sb, "fiscal-nfce-config", { action: "set_numbering", series: 1, next_number: 10 });
check(num.next_number === 10, `admin define série/próximo número pela Edge Function (${num.error || "ok"})`);

const { data: conjA, error: eConjA } = await A.sb
  .from("tax_rule_sets")
  .insert({ company_id: A.companyId, name: "Regras A", version: "1", valid_from: "2026-01-01", status: "active" })
  .select().single();
check(!eConjA && !!conjA?.id, `admin cria conjunto de regras (${eConjA?.message || "ok"})`);
const { data: regraA, error: eRegraA } = await A.sb
  .from("tax_rules")
  .insert({ rule_set_id: conjA.id, company_id: A.companyId, valid_from: "2026-01-01", match: { model: "65" }, taxes: { icms: { csosn: "102" } } })
  .select().single();
check(!eRegraA && !!regraA?.id, `admin cria regra tributária (${eRegraA?.message || "ok"})`);

const settingsAdmin = async () =>
  (await admin.from("company_fiscal_settings").select("cnpj, ie, environment, csc_id_homologacao, nfce_series").eq("company_id", A.companyId).maybeSingle()).data;
const serieAdmin = async () =>
  Number((await admin.from("fiscal_document_series").select("current_number").eq("company_id", A.companyId).eq("model", "65").eq("series", 1).eq("environment", "homologacao").maybeSingle()).data?.current_number);

// ---------- Caixa: leitura continua, escrita não ----------
const lerS = await C.from("company_fiscal_settings").select("cnpj").eq("company_id", A.companyId);
check((lerS.data || []).length === 1, "caixa continua lendo a configuração fiscal (o PDV precisa)");
const lerR = await C.from("tax_rules").select("id").eq("id", regraA.id);
check((lerR.data || []).length === 1, "caixa continua lendo as regras tributárias");
const lerN = await C.from("fiscal_document_series").select("current_number").eq("company_id", A.companyId);
check((lerN.data || []).length === 1, "caixa continua lendo a numeração");

const antes = await settingsAdmin();
const updS = await C.from("company_fiscal_settings")
  .update({ cnpj: "99999999000191", ie: "000000000", environment: "producao", csc_id_homologacao: "999", nfce_series: 9 })
  .eq("company_id", A.companyId).select();
const depois = await settingsAdmin();
check((updS.data || []).length === 0 && JSON.stringify(antes) === JSON.stringify(depois), "caixa NÃO altera CNPJ, IE, ambiente, CSC nem série");
const insS = await C.from("company_fiscal_settings").insert({ company_id: A.companyId, cnpj: "1" }).select();
check(!!insS.error || (insS.data || []).length === 0, "caixa NÃO cria configuração fiscal");
await C.from("company_fiscal_settings").delete().eq("company_id", A.companyId);
check(!!(await settingsAdmin()), "caixa NÃO apaga a configuração fiscal");

const updSerie = await C.from("fiscal_document_series").update({ current_number: 0 }).eq("company_id", A.companyId).select();
check((updSerie.data || []).length === 0 && (await serieAdmin()) === 9, `caixa NÃO volta a numeração fiscal (último número segue ${await serieAdmin()})`);
const insSerie = await C.from("fiscal_document_series").insert({ company_id: A.companyId, model: "65", series: 5, environment: "homologacao", current_number: 0 }).select();
check(!!insSerie.error || (insSerie.data || []).length === 0, "caixa NÃO cria série");
await C.from("fiscal_document_series").delete().eq("company_id", A.companyId);
check((await serieAdmin()) === 9, "caixa NÃO apaga a série");

const updR = await C.from("tax_rules").update({ active: false, taxes: { icms: { csosn: "400" } } }).eq("id", regraA.id).select();
const { data: regraDepois } = await admin.from("tax_rules").select("active, taxes").eq("id", regraA.id).maybeSingle();
check((updR.data || []).length === 0 && regraDepois?.active === true && regraDepois?.taxes?.icms?.csosn === "102", "caixa NÃO altera regra tributária");
const insR = await C.from("tax_rules").insert({ rule_set_id: conjA.id, company_id: A.companyId, valid_from: "2026-01-01", match: {}, taxes: {} }).select();
check(!!insR.error || (insR.data || []).length === 0, "caixa NÃO cria regra tributária");
await C.from("tax_rules").delete().eq("id", regraA.id);
check(!!(await admin.from("tax_rules").select("id").eq("id", regraA.id).maybeSingle()).data, "caixa NÃO apaga regra tributária");
const insC = await C.from("tax_rule_sets").insert({ company_id: A.companyId, name: "x", version: "1", valid_from: "2026-01-01" }).select();
check(!!insC.error || (insC.data || []).length === 0, "caixa NÃO cria conjunto de regras");
const updC = await C.from("tax_rule_sets").update({ status: "archived" }).eq("id", conjA.id).select();
check((updC.data || []).length === 0, "caixa NÃO altera conjunto de regras");

// Edge Functions de configuração também recusam o caixa
const fnS = await invocar(C, "save-fiscal-settings", { cnpj: "99999999000191" });
check(!!fnS.error && !fnS.settings, `save-fiscal-settings recusa o caixa (${fnS.error})`);
const fnN = await invocar(C, "fiscal-nfce-config", { action: "set_numbering", series: 1, next_number: 500 });
check(!!fnN.error, `fiscal-nfce-config recusa o caixa (${fnN.error})`);

// ---------- Admin: continua podendo configurar ----------
const adminUpdS = await A.sb.from("company_fiscal_settings").update({ trade_name: "Loja A" }).eq("company_id", A.companyId).select();
check((adminUpdS.data || []).length === 1, `admin edita a configuração fiscal (${adminUpdS.error?.message || "ok"})`);
const adminUpdR = await A.sb.from("tax_rules").update({ description: "editada pelo admin", active: true }).eq("id", regraA.id).select();
check((adminUpdR.data || []).length === 1, `admin edita regra tributária (${adminUpdR.error?.message || "ok"})`);
const adminUpdC = await A.sb.from("tax_rule_sets").update({ notes: "ok" }).eq("id", conjA.id).select();
check((adminUpdC.data || []).length === 1, `admin edita conjunto de regras (${adminUpdC.error?.message || "ok"})`);
const adminNum = await invocar(A.sb, "fiscal-nfce-config", { action: "set_numbering", series: 1, next_number: 20 });
check(adminNum.next_number === 20 && (await serieAdmin()) === 19, "admin altera a numeração pela Edge Function (validando número já usado)");
const adminSerieDireta = await A.sb.from("fiscal_document_series").update({ current_number: 0 }).eq("company_id", A.companyId).select();
check((adminSerieDireta.data || []).length === 0 && (await serieAdmin()) === 19, "nem o admin reescreve a numeração direto na tabela (só pela função)");

// ---------- Outra empresa ----------
const bS = await B.sb.from("company_fiscal_settings").select("cnpj").eq("company_id", A.companyId);
const bR = await B.sb.from("tax_rules").select("id").eq("id", regraA.id);
const bN = await B.sb.from("fiscal_document_series").select("id").eq("company_id", A.companyId);
check((bS.data || []).length + (bR.data || []).length + (bN.data || []).length === 0, "outra empresa não lê configuração, regras nem numeração da empresa A");
const bUpd = await B.sb.from("tax_rules").update({ active: false }).eq("id", regraA.id).select();
const bUpdS = await B.sb.from("company_fiscal_settings").update({ environment: "producao" }).eq("company_id", A.companyId).select();
check((bUpd.data || []).length === 0 && (bUpdS.data || []).length === 0, "admin de outra empresa não altera dados da empresa A");
const bIns = await B.sb.from("tax_rules").insert({ rule_set_id: conjA.id, company_id: A.companyId, valid_from: "2026-01-01", match: {}, taxes: {} });
check(!!bIns.error, "admin de outra empresa não cria regra na empresa A");
const bEmitSerie = await invocar(B.sb, "fiscal-nfce-config", { action: "set_numbering", series: 1, next_number: 900 });
check((await serieAdmin()) === 19, `numeração da empresa A intocada pela empresa B (${bEmitSerie.error || bEmitSerie.next_number})`);

// ---------- Limpeza ----------
for (const t of [A, B]) await admin.from("companies").delete().eq("id", t.companyId);
for (const id of criados) await admin.auth.admin.deleteUser(id);

console.log("\nSmoke — RLS fiscal por papel (admin, caixa, outra empresa)\n");
for (const m of ok) console.log(`  PASS  ${m}`);
for (const m of falhas) console.log(`  FAIL  ${m}`);
console.log(`\n${ok.length} passaram, ${falhas.length} falharam\n`);
process.exit(falhas.length ? 1 : 0);
