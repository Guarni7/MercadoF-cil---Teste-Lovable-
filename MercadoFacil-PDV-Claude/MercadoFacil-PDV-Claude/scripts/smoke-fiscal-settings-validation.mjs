/**
 * Smoke das validações da configuração fiscal (F6, F7, F8): save-fiscal-settings
 * recusa dado malformado e CNPJ que não bate com o certificado; "Testar
 * configuração" (fiscal-nfce-config) reflete os dados mínimos da emissão.
 *
 * Roda em empresas de teste apagadas no fim. Por padrão chama as Edge Functions
 * deployadas; para testar código ainda não deployado, suba as funções
 * localmente e aponte:
 *   SAVE_URL=http://127.0.0.1:8001 CFG_URL=http://127.0.0.1:8002 \
 *     node scripts/smoke-fiscal-settings-validation.mjs
 *
 * Uso: node scripts/smoke-fiscal-settings-validation.mjs
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

function makePfx({ cnpj, password }) {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = "01";
  const ano = 365 * 24 * 60 * 60 * 1000;
  cert.validity.notBefore = new Date(Date.now() - ano);
  cert.validity.notAfter = new Date(Date.now() + ano);
  const attrs = [{ name: "commonName", value: `MERCADO VALIDACAO LTDA:${cnpj}` }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  const p12 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], password, { algorithm: "3des" });
  return forge.util.encode64(forge.asn1.toDer(p12).getBytes());
}

const env = loadEnvLocal();
const FN = `${env.VITE_SUPABASE_URL.replace(/\/$/, "")}/functions/v1`;
const SAVE_URL = process.env.SAVE_URL || `${FN}/save-fiscal-settings`;
const CFG_URL = process.env.CFG_URL || `${FN}/fiscal-nfce-config`;
const admin = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const falhas = [];
const ok = [];
const check = (cond, msg) => (cond ? ok.push(msg) : falhas.push(msg));

const stamp = Date.now();
const email = `guarni07+mf.val.${stamp}@gmail.com`;
const password = `Val-${stamp}aA1!`;
const { data: criado } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const { data: sessao } = await sb.auth.signInWithPassword({ email, password });
const token = sessao.session.access_token;
const { data: boot } = await sb.rpc("bootstrap_company", { p_trade_name: `Validacao ${stamp}`, p_email: email });
const companyId = typeof boot === "string" ? boot : boot?.id;

// O rate limit existente (10 gravações / 5 min por empresa) não é o que se testa aqui:
// zera o contador da empresa de teste antes de cada chamada.
const zerarLimite = () => admin.from("rate_limit_hits").delete().like("key", `%${companyId}%`);
const chamar = async (url, body) => {
  await zerarLimite();
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, apikey: env.VITE_SUPABASE_ANON_KEY },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, ...json };
};
const salvar = (body) => chamar(SAVE_URL, body);
const config = () =>
  admin.from("company_fiscal_settings").select("*").eq("company_id", companyId).maybeSingle().then((r) => r.data);

const CNPJ = "11222333000181"; // válido
const OUTRO_CNPJ = "11444777000161"; // válido, diferente
const SENHA = "senha-cert-xyz";
const VALIDO = {
  cnpj: CNPJ, legal_name: "Mercado Validacao Ltda", trade_name: "Mercado Validacao", ie: "109876547", uf: "GO",
  city_name: "Goiânia", city_ibge_code: "5208707", tax_regime: "simples", crt: "1", environment: "homologacao",
  nfce_enabled: true, address: "Rua Teste", address_number: "1", neighborhood: "Centro", cep: "74000-000",
  cnae_main: "4711302", csc_id_homologacao: "1", csc_homologacao: "12345678-1234-1234-1234-123456789012",
};

// ---------- F7: gravação ----------
const r1 = await salvar({ ...VALIDO, certificate_pfx: makePfx({ cnpj: CNPJ, password: SENHA }), certificate_password: SENHA });
check(r1.status === 200 && !!r1.settings, `dados válidos com certificado são gravados (${r1.status} ${r1.error || ""})`);

const baseline = await config();
const recusa = async (nome, parcial, campo) => {
  const r = await salvar(parcial);
  const depois = await config();
  const campos = (r.details || []).map((d) => d.field);
  check(r.status === 422 && (!campo || campos.includes(campo)), `${nome} é recusado (${r.status}${campo ? ` ${campo}` : ""}: ${String(r.error).slice(0, 90)})`);
  check(JSON.stringify(depois) === JSON.stringify(baseline), `${nome}: nada foi gravado`);
};
await recusa("CNPJ com dígito verificador errado", { cnpj: "11222333000182" }, "cnpj");
await recusa("CNPJ com tamanho errado", { cnpj: "1122233300018" }, "cnpj");
await recusa("IE de GO com dígito errado", { ie: "109876548" }, "ie");
await recusa("IE de GO com tamanho errado", { ie: "1234567890" }, "ie");
await recusa("CEP curto", { cep: "7400" }, "cep");
await recusa("IBGE com 6 dígitos", { city_ibge_code: "520870" }, "city_ibge_code");
await recusa("IBGE de outra UF (MG) com UF GO", { city_ibge_code: "3106200" }, "city_ibge_code");
await recusa("UF inexistente", { uf: "XX" }, "uf");
await recusa("UF em minúscula", { uf: "go" }, "uf");
await recusa("ID CSC não numérico", { csc_id_homologacao: "abc" }, "csc_id_homologacao");
await recusa("ID CSC com mais de 6 dígitos", { csc_id_homologacao: "1234567" }, "csc_id_homologacao");
await recusa("CSC com formato inválido", { csc_homologacao: "curto" }, "csc_homologacao");
await recusa("CRT incompatível com o regime", { tax_regime: "mei" }, "crt");
await recusa("CNAE com tamanho errado", { cnae_main: "123" }, "cnae_main");
const varios = await salvar({ cnpj: "1", cep: "1", city_ibge_code: "1" });
check(varios.status === 422 && (varios.details || []).length >= 3, "vários erros voltam todos juntos na mesma resposta");

// trocar UF revalida IE e IBGE já gravados
const trocaUf = await salvar({ uf: "MG" });
check(trocaUf.status === 422 && (trocaUf.details || []).some((d) => d.field === "city_ibge_code"), `trocar a UF para MG revalida o IBGE gravado (${String(trocaUf.error).slice(0, 80)})`);

// válidos de outra UF e variações aceitas
const mg = await salvar({ uf: "MG", city_ibge_code: "3106200", ie: "0011223344556", city_name: "Belo Horizonte" });
check(mg.status === 200, `UF MG com IE só de formato e IBGE de MG é aceita (${mg.status} ${mg.error || ""})`);
const volta = await salvar({ uf: "GO", city_ibge_code: "5208707", ie: "109876547", city_name: "Goiânia" });
check(volta.status === 200, `volta para GO com IE e IBGE válidos (${volta.status} ${volta.error || ""})`);
const mei = await salvar({ tax_regime: "mei", crt: "4" });
check(mei.status === 200, "MEI com CRT 4 é aceito");
const simples2 = await salvar({ tax_regime: "simples", crt: "2" });
check(simples2.status === 200, "Simples com CRT 2 é aceito");
const mascara = await salvar({ cnpj: "11.222.333/0001-81", cep: "74000-000" });
check(mascara.status === 200, `CNPJ e CEP com máscara são aceitos (${mascara.status} ${mascara.error || ""})`);
const limpar = await salvar({ cep: "", complement: "" });
check(limpar.status === 200, "limpar um campo opcional não é erro de formato");
await salvar({ cep: "74000-000" }); // restaura o CEP para os testes seguintes

// ---------- F8: CNPJ x certificado ----------
const antesF8 = await config();
const trocaCnpj = await salvar({ cnpj: OUTRO_CNPJ });
const depoisF8 = await config();
check(trocaCnpj.status === 422 && /certificado cadastrado pertence ao CNPJ/i.test(trocaCnpj.error || ""), `trocar o CNPJ com certificado de outro CNPJ é recusado (${String(trocaCnpj.error).slice(0, 100)})`);
check(depoisF8.cnpj === antesF8.cnpj, "o CNPJ gravado não mudou");

const certSoOutro = await salvar({ certificate_pfx: makePfx({ cnpj: OUTRO_CNPJ, password: SENHA }), certificate_password: SENHA });
check(certSoOutro.status === 422 && /pertence ao CNPJ/i.test(certSoOutro.error || ""), `enviar só o certificado de outro CNPJ (sem CNPJ no corpo) também é conferido (${String(certSoOutro.error).slice(0, 100)})`);

const trocaCompleta = await salvar({ cnpj: OUTRO_CNPJ, certificate_pfx: makePfx({ cnpj: OUTRO_CNPJ, password: SENHA }), certificate_password: SENHA });
check(trocaCompleta.status === 200 && trocaCompleta.certificate?.cnpj === OUTRO_CNPJ, `trocar CNPJ e certificado juntos é aceito (${trocaCompleta.status} ${trocaCompleta.error || ""})`);
check((await config()).cnpj === OUTRO_CNPJ, "o novo CNPJ ficou gravado");

const ieOk = await salvar({ ie: "109876547" });
check(ieOk.status === 200, "alterar só a IE (válida) continua permitido");
const ieRuim = await salvar({ ie: "109876548" });
check(ieRuim.status === 422, "alterar a IE para um valor inválido é recusado");
const mesmoCnpj = await salvar({ cnpj: OUTRO_CNPJ, trade_name: "Outro nome" });
check(mesmoCnpj.status === 200, "reenviar o mesmo CNPJ não dispara reconferência indevida");

// ---------- F6: Testar configuração ----------
await sb.from("products").insert([
  { company_id: companyId, name: "Refrigerante 2L", price: 8, stock: 5, unit: "UN", ncm: "22021000", cfop: "5102", origin: "0" },
  { company_id: companyId, name: "Produto sem NCM", price: 3, stock: 5, unit: "UN", cfop: "5102", origin: "0" },
]);
const item = (t, id) => (t.items || []).find((i) => i.id === id)?.status;

const t1 = await chamar(CFG_URL, { action: "test" });
check(item(t1, "regras_tributarias") === "erro", `sem regra tributária o teste acusa erro (${item(t1, "regras_tributarias")})`);
check(item(t1, "produtos") === "pendente", `produto sem NCM deixa o item de produtos pendente (${item(t1, "produtos")})`);
check(t1.status === "erro", `resultado geral reflete que a emissão não sairia (${t1.status})`);

const { data: conj } = await sb.from("tax_rule_sets").insert({ company_id: companyId, name: "Regras", version: "1", valid_from: "2026-01-01", status: "active" }).select().single();
const { data: regra } = await sb.from("tax_rules").insert({
  rule_set_id: conj.id, company_id: companyId, valid_from: "2026-01-01", match: { model: "65" },
  taxes: { icms: { csosn: "102" }, pis: { cst: "01", aliquota: 0 }, cofins: { cst: "01", aliquota: 0 } },
}).select().single();
const t2 = await chamar(CFG_URL, { action: "test" });
check(item(t2, "regras_tributarias") === "configurado", "com regra geral vigente o item de tributação fica configurado");

await sb.from("tax_rules").update({ valid_from: "2099-01-01" }).eq("id", regra.id);
check(item(await chamar(CFG_URL, { action: "test" }), "regras_tributarias") === "erro", "regra com vigência futura não conta");
await sb.from("tax_rules").update({ valid_from: "2026-01-01", match: { model: "65", ncm: "2202" } }).eq("id", regra.id);
check(item(await chamar(CFG_URL, { action: "test" }), "regras_tributarias") === "pendente", "regra só por NCM deixa pendente");
await sb.from("tax_rules").update({ match: { model: "65" } }).eq("id", regra.id);

await admin.from("products").update({ ncm: "19053100" }).eq("company_id", companyId).or("ncm.is.null,ncm.eq.");
const t3 = await chamar(CFG_URL, { action: "test" });
check(item(t3, "produtos") === "configurado", "produtos completos deixam o item configurado");
check(item(t3, "endereco") === "configurado" && item(t3, "cep") === "configurado" && item(t3, "municipio") === "configurado", "endereço, CEP e município configurados");
check(item(t3, "razao_social") === "configurado" && item(t3, "nfce_habilitada") === "configurado", "razão social e NFC-e habilitada configuradas");

// dados já gravados antes das validações (escrita direta) também são acusados
await admin.from("company_fiscal_settings").update({ cep: "123", city_ibge_code: "3106200", nfce_enabled: false, legal_name: "", address: "" }).eq("company_id", companyId);
const t4 = await chamar(CFG_URL, { action: "test" });
check(item(t4, "cep") === "erro" && item(t4, "municipio") === "erro" && item(t4, "nfce_habilitada") === "erro" && item(t4, "razao_social") === "erro" && item(t4, "endereco") === "erro", "dados inválidos já gravados são acusados pelo teste");
check(t4.status === "erro", "resultado geral é erro");

// ---------- limpeza ----------
await admin.from("companies").delete().eq("id", companyId);
await admin.auth.admin.deleteUser(criado.user.id);

console.log("\nSmoke — validações da configuração fiscal (F6, F7, F8)\n");
for (const m of ok) console.log(`  PASS  ${m}`);
for (const m of falhas) console.log(`  FAIL  ${m}`);
console.log(`\n${ok.length} passaram, ${falhas.length} falharam\n`);
process.exit(falhas.length ? 1 : 0);
