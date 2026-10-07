/**
 * Smoke das regras tributárias da NFC-e (tela Fiscal > Tributação): grava como
 * usuário da empresa (RLS), confere isolamento entre empresas e prova que o
 * fiscal-emit deixa de parar em "Nenhuma regra tributária vigente".
 *
 * Roda contra o Supabase real, em empresas de teste apagadas no fim. A emissão
 * termina em 'error' na transmissão (certificado autoassinado) — o que importa
 * é ela passar da etapa de tributação.
 *
 * Uso: node scripts/smoke-tax-rules.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { resolve } from "path";
import forge from "node-forge";
import { formVazio, montarRegra, regraParaForm } from "../src/lib/taxRulesForm.js";

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

function makePfx({ cnpj, password }) {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = "01";
  const ano = 365 * 24 * 60 * 60 * 1000;
  cert.validity.notBefore = new Date(Date.now() - ano);
  cert.validity.notAfter = new Date(Date.now() + ano);
  const attrs = [{ name: "commonName", value: `MERCADO TRIB LTDA:${cnpj}` }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  const p12 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], password, { algorithm: "3des" });
  return forge.util.encode64(forge.asn1.toDer(p12).getBytes());
}

const env = loadEnvLocal();
const admin = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const falhas = [];
const ok = [];
const check = (cond, msg) => (cond ? ok.push(msg) : falhas.push(msg));

async function criarEmpresa(tag) {
  const stamp = Date.now() + Math.floor(Math.random() * 1000);
  const email = `guarni07+mf.tax.${tag}.${stamp}@gmail.com`;
  const password = `Tax-${stamp}aA1!`;
  await admin.auth.admin.createUser({ email, password, email_confirm: true });
  const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  await sb.auth.signInWithPassword({ email, password });
  const { data } = await sb.rpc("bootstrap_company", { p_trade_name: `Tributacao ${tag} ${stamp}`, p_email: email });
  return { sb, email, companyId: typeof data === "string" ? data : data?.id };
}

const A = await criarEmpresa("a");
const B = await criarEmpresa("b");

const invocar = async (sb, fn, body) => {
  const { data, error } = await sb.functions.invoke(fn, { body });
  if (data) return data;
  try {
    return await error.context.json();
  } catch {
    return { error: error?.message || "sem resposta" };
  }
};

// Mesmos passos da tela: garante o conjunto da empresa e grava a regra padrão.
const CNPJ = "11222333000181";
await invocar(A.sb, "save-fiscal-settings", {
  cnpj: CNPJ, legal_name: "Mercado Trib Ltda", trade_name: "Mercado Trib", ie: "109876547", uf: "GO",
  city_name: "Goiânia", city_ibge_code: "5208707", tax_regime: "simples", crt: "1", environment: "homologacao",
  nfce_enabled: true, address: "Rua Teste", address_number: "1", neighborhood: "Centro", cep: "74000000",
  csc_id_homologacao: "1", csc_homologacao: "12345678-1234-1234-1234-123456789012",
  certificate_pfx: makePfx({ cnpj: CNPJ, password: "senha-cert" }), certificate_password: "senha-cert",
});
await A.sb.from("products").insert({
  company_id: A.companyId, name: "Refrigerante 2L", price: 8, stock: 500, unit: "UN",
  ncm: "22021000", cfop: "5102", origin: "0", gtin: "7891234500002",
});
const { data: produto } = await A.sb.from("products").select("id").eq("company_id", A.companyId).maybeSingle();
const criarVenda = async () =>
  (await A.sb.from("sales").insert({
    company_id: A.companyId,
    items: [{ product_id: produto.id, name: "Refrigerante 2L", quantity: 1, price: 8, total: 8 }],
    subtotal: 8, total: 8, payment_method: "pix", status: "concluida",
  }).select().single()).data;

// 1. Sem regra nenhuma: a emissão para na tributação
const v0 = await criarVenda();
const e0 = await invocar(A.sb, "fiscal-emit", { model: "65", sale_id: v0.id });
check(/Tributação não pôde ser determinada/i.test(e0.error || ""), `sem regra a emissão para na tributação (${e0.error})`);

// 2. Cria conjunto + regra pela via da tela (usuário da empresa, RLS)
const { data: conjunto, error: erroConjunto } = await A.sb
  .from("tax_rule_sets")
  .insert({ company_id: A.companyId, name: "Regras da empresa", version: "1", valid_from: "2026-01-01", status: "active", source: "teste" })
  .select().single();
check(!erroConjunto && !!conjunto?.id, `usuário da empresa cria o conjunto de regras (${erroConjunto?.message || "ok"})`);
const { data: regra, error: erroRegra } = await A.sb
  .from("tax_rules")
  .insert({ ...montarRegra(formVazio()), rule_set_id: conjunto.id, company_id: A.companyId, source: "teste" })
  .select().single();
check(!erroRegra && !!regra?.id, `usuário da empresa cria a regra padrão (${erroRegra?.message || "ok"})`);

// 3. Outra empresa não enxerga nem altera a regra (RLS)
const { data: visivelB } = await B.sb.from("tax_rules").select("id").eq("id", regra.id);
check((visivelB || []).length === 0, "outra empresa não enxerga a regra");
const { data: editB } = await B.sb.from("tax_rules").update({ active: false }).eq("id", regra.id).select();
check((editB || []).length === 0, "outra empresa não consegue alterar a regra");
const { error: criaEmNomeDeA } = await B.sb
  .from("tax_rules")
  .insert({ ...montarRegra(formVazio()), rule_set_id: conjunto.id, company_id: A.companyId });
check(!!criaEmNomeDeA, "outra empresa não consegue criar regra em nome da empresa A");

// 4. A emissão passa da tributação
const v1 = await criarVenda();
const e1 = await invocar(A.sb, "fiscal-emit", { model: "65", sale_id: v1.id });
const { data: d1 } = await admin.from("fiscal_documents").select("status, number, items").eq("id", e1.document_id).maybeSingle();
check(!/Tributação não pôde ser determinada|Nenhuma regra tributária/i.test(e1.error || ""), `com regra vigente a emissão passa da tributação (${e1.error || e1.status})`);
check(Number(d1?.number) >= 1, `número fiscal reservado depois da tributação (${d1?.number})`);
check(d1?.items?.[0]?.taxes?.icms?.csosn === "102" && d1?.items?.[0]?.taxes?.pis?.cst === "01", "o item do documento guarda ICMS CSOSN 102 e PIS CST 01 da regra");
check(d1?.status !== "authorized", `documento não fica autorizado sem resposta da SEFAZ (${d1?.status})`);

// 5. Edição: regra desativada volta a bloquear; reativada, libera
const editada = montarRegra({ ...regraParaForm(regra), active: false });
await A.sb.from("tax_rules").update({ active: editada.active }).eq("id", regra.id);
const v2 = await criarVenda();
const e2 = await invocar(A.sb, "fiscal-emit", { model: "65", sale_id: v2.id });
check(/Tributação não pôde ser determinada/i.test(e2.error || ""), "regra desativada volta a bloquear a emissão");
await A.sb.from("tax_rules").update({ active: true, taxes: montarRegra({ ...formVazio(), csosn: "400" }).taxes }).eq("id", regra.id);
const v3 = await criarVenda();
const e3 = await invocar(A.sb, "fiscal-emit", { model: "65", sale_id: v3.id });
const { data: d3 } = await admin.from("fiscal_documents").select("items").eq("id", e3.document_id).maybeSingle();
check(d3?.items?.[0]?.taxes?.icms?.csosn === "400", "regra editada (CSOSN 400) é a usada na emissão seguinte");

for (const t of [A, B]) {
  await admin.from("companies").delete().eq("id", t.companyId);
}
const { data: lista } = await admin.auth.admin.listUsers({ perPage: 1000 });
for (const t of [A, B]) {
  const u = lista?.users?.find((x) => x.email === t.email);
  if (u) await admin.auth.admin.deleteUser(u.id);
}

console.log("\nSmoke — regras tributárias da NFC-e (RLS e emissão)\n");
for (const m of ok) console.log(`  PASS  ${m}`);
for (const m of falhas) console.log(`  FAIL  ${m}`);
console.log(`\n${ok.length} passaram, ${falhas.length} falharam\n`);
process.exit(falhas.length ? 1 : 0);
