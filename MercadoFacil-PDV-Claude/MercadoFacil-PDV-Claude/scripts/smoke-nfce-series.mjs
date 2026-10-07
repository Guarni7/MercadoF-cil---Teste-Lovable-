/**
 * Smoke da configuração de NFC-e (SEFAZ-GO, homologação): botão "Testar
 * configuração", série/próximo número e uso da série configurada no fiscal-emit,
 * incluindo a proteção contra série divergente.
 *
 * Roda contra o Supabase real (funções deployadas), numa empresa de teste que é
 * apagada no fim. Não transmite nada à SEFAZ com sucesso: o certificado é
 * autoassinado, então a emissão termina em 'error' — o que importa aqui é a
 * série e o número gravados no documento.
 *
 * Uso: node scripts/smoke-nfce-series.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { resolve } from "path";
import forge from "node-forge";

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

function makePfx({ cnpj, password, commonName }) {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = "01";
  const ano = 365 * 24 * 60 * 60 * 1000;
  cert.validity.notBefore = new Date(Date.now() - ano);
  cert.validity.notAfter = new Date(Date.now() + ano);
  const attrs = [{ name: "commonName", value: `${commonName}:${cnpj}` }];
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

const stamp = Date.now();
const email = `guarni07+mf.series.${stamp}@gmail.com`;
const password = `Ser-${stamp}aA1!`;
await admin.auth.admin.createUser({ email, password, email_confirm: true });
const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
await sb.auth.signInWithPassword({ email, password });
const { data: bootstrap } = await sb.rpc("bootstrap_company", { p_trade_name: `Serie NFC-e ${stamp}`, p_email: email });
const companyId = typeof bootstrap === "string" ? bootstrap : bootstrap?.id;

const invocar = async (fn, body) => {
  const { data, error } = await sb.functions.invoke(fn, { body });
  if (data) return data;
  try {
    return await error.context.json();
  } catch {
    return { error: error?.message || "sem resposta" };
  }
};

const CNPJ = "11222333000181";
const CSC = "12345678-1234-1234-1234-123456789012";
const SENHA_CERT = "senha-cert-xyz";
await invocar("save-fiscal-settings", {
  cnpj: CNPJ,
  legal_name: "Mercado Serie Ltda",
  trade_name: "Mercado Serie",
  ie: "109876547",
  uf: "GO",
  city_name: "Goiânia",
  city_ibge_code: "5208707",
  tax_regime: "simples",
  crt: "1",
  environment: "homologacao",
  nfce_enabled: true,
  address: "Rua Teste",
  address_number: "1",
  neighborhood: "Centro",
  cep: "74000000",
  csc_id_homologacao: "1",
  csc_homologacao: CSC,
  certificate_pfx: makePfx({ cnpj: CNPJ, password: SENHA_CERT, commonName: "MERCADO SERIE LTDA" }),
  certificate_password: SENHA_CERT,
});

// 1. Testar configuração: tudo configurado e nada sensível na resposta
const teste = await invocar("fiscal-nfce-config", { action: "test" });
const itens = Object.fromEntries((teste.items || []).map((i) => [i.id, i.status]));
// Esta empresa ainda não tem regra tributária nem produtos (criados mais abaixo): o teste
// precisa acusar isso, e só isso, como problema da emissão.
const naoConfigurados = (teste.items || []).filter((i) => i.status !== "configurado").map((i) => i.id).sort();
check(
  teste.status === "erro" && itens.regras_tributarias === "erro" && itens.produtos === "pendente" && naoConfigurados.join() === "produtos,regras_tributarias",
  `teste acusa apenas regras tributárias e produtos pendentes (${naoConfigurados.join()})`,
);
check(itens.certificado === "configurado" && itens.validade === "configurado" && itens.certificado_cnpj === "configurado", "certificado abre, está válido e pertence ao CNPJ");
check(itens.csc === "configurado" && itens.csc_id === "configurado", "ID CSC e CSC com formato válido");
const corpo = JSON.stringify(teste);
check(!corpo.includes(CSC) && !corpo.includes(SENHA_CERT) && !/BEGIN|PRIVATE/.test(corpo), "a resposta não vaza CSC, senha nem material do certificado");

// 1b. Sem permissão de admin a função recusa? (usuário da empresa é admin; aqui só confere que exige login)
const semLogin = await fetch(`${env.VITE_SUPABASE_URL}/functions/v1/fiscal-nfce-config`, {
  method: "POST",
  headers: { "Content-Type": "application/json", apikey: env.VITE_SUPABASE_ANON_KEY },
  body: JSON.stringify({ action: "test" }),
});
check(semLogin.status === 401, `sem sessão a função recusa (HTTP ${semLogin.status})`);

// 2. Série e próximo número
const numeracao = await invocar("fiscal-nfce-config", { action: "set_numbering", series: 7, next_number: 50 });
check(numeracao.series === 7 && numeracao.next_number === 50, "salva série 7 e próximo número 50");
const { data: cfg } = await admin.from("company_fiscal_settings").select("nfce_series").eq("company_id", companyId).maybeSingle();
check(cfg?.nfce_series === 7, "série gravada em company_fiscal_settings");
const { data: linha } = await admin
  .from("fiscal_document_series")
  .select("current_number")
  .eq("company_id", companyId).eq("model", "65").eq("series", 7).eq("environment", "homologacao")
  .maybeSingle();
check(Number(linha?.current_number) === 49, `último número da série 7 ficou 49 (${linha?.current_number})`);

const invalida = await invocar("fiscal-nfce-config", { action: "set_numbering", series: 0, next_number: 1 });
check(!!invalida.error, "série fora de 1–999 é recusada");

// 3. fiscal-emit usa a série configurada
await sb.from("products").insert({
  company_id: companyId, name: "Refrigerante 2L", price: 8, stock: 500, unit: "UN",
  ncm: "22021000", cfop: "5102", origin: "0", gtin: "7891234500002",
});
const { data: produto } = await sb.from("products").select("id").eq("company_id", companyId).maybeSingle();
const { data: conjunto } = await sb
  .from("tax_rule_sets")
  .insert({ company_id: companyId, name: "Regras", version: "2026.1", valid_from: "2026-01-01", status: "active" })
  .select().single();
await sb.from("tax_rules").insert({
  rule_set_id: conjunto.id, company_id: companyId, valid_from: "2026-01-01", match: {},
  taxes: {
    icms: { csosn: "102" },
    ibs: { cst: "000", cClassTrib: "000001", pIBSUF: 0.1, pIBSMun: 0 },
    cbs: { cst: "000", cClassTrib: "000001", pCBS: 0.9 },
  },
});
const criarVenda = async () =>
  (await sb.from("sales").insert({
    company_id: companyId,
    items: [{ product_id: produto.id, name: "Refrigerante 2L", quantity: 1, price: 8, total: 8 }],
    subtotal: 8, total: 8, payment_method: "pix", status: "concluida",
  }).select().single()).data;
const docDe = async (id) =>
  (await admin.from("fiscal_documents").select("series, number, status").eq("id", id).maybeSingle()).data;
const ultimo = async () =>
  Number((await admin.from("fiscal_document_series").select("current_number")
    .eq("company_id", companyId).eq("model", "65").eq("series", 7).eq("environment", "homologacao").maybeSingle()).data?.current_number);

const v1 = await criarVenda();
const e1 = await invocar("fiscal-emit", { model: "65", sale_id: v1.id, series: 7 });
const d1 = await docDe(e1.document_id);
check(d1?.series === 7 && Number(d1?.number) === 50, `emissão com a série configurada usa série 7, número 50 (${d1?.series}/${d1?.number})`);
check(d1?.status !== "authorized", `documento não fica autorizado sem resposta real da SEFAZ (${d1?.status})`);

// 4. Série divergente: recusa antes de reservar número
const antes = await ultimo();
const v2 = await criarVenda();
const e2 = await invocar("fiscal-emit", { model: "65", sale_id: v2.id, series: 3 });
check(/série.*alterada/i.test(e2.error || ""), `série divergente é recusada com mensagem clara (${e2.error})`);
check((await ultimo()) === antes, "a recusa por série divergente não consome número da série");
const d2 = await docDe(e2.document_id);
check(d2?.status === "error" && d2?.number == null, "documento da tentativa divergente fica em 'error', sem número");

// 5. Sem série no corpo: servidor usa a configurada
const v3 = await criarVenda();
const e3 = await invocar("fiscal-emit", { model: "65", sale_id: v3.id });
const d3 = await docDe(e3.document_id);
check(d3?.series === 7 && Number(d3?.number) === 51, `sem série no corpo usa a configurada (série 7, número 51): ${d3?.series}/${d3?.number}`);

// 6. Próximo número não pode repetir número já registrado
const repetido = await invocar("fiscal-nfce-config", { action: "set_numbering", series: 7, next_number: 51 });
check(!!repetido.error, `próximo número já usado é recusado (${repetido.error})`);
const valido = await invocar("fiscal-nfce-config", { action: "set_numbering", series: 7, next_number: 100 });
check(valido.next_number === 100, "próximo número maior que o último é aceito");

await admin.from("companies").delete().eq("id", companyId);
const { data: lista } = await admin.auth.admin.listUsers({ perPage: 1000 });
const eu = lista?.users?.find((u) => u.email === email);
if (eu) await admin.auth.admin.deleteUser(eu.id);

console.log("\nSmoke — NFC-e: configuração, série e proteção contra divergência\n");
for (const m of ok) console.log(`  PASS  ${m}`);
for (const m of falhas) console.log(`  FAIL  ${m}`);
console.log(`\n${ok.length} passaram, ${falhas.length} falharam\n`);
process.exit(falhas.length ? 1 : 0);
