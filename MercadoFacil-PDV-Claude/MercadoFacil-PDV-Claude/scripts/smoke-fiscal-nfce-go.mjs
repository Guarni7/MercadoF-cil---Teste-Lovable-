/**
 * Smoke dos 3 bloqueios resolvidos para NFC-e em homologação na SEFAZ-GO:
 * endpoints oficiais cadastrados, CSC/ID CSC guardado no Vault e usado para
 * montar o infNFeSupl/QR Code, e a emissão recusando com mensagem clara
 * quando falta CSC — nunca fabricando QR nem autorização.
 *
 * Não testa transmissão real à SEFAZ (exige certificado A1 + CSC de uma
 * empresa credenciada de verdade — fora do que este projeto pode simular).
 * Testa até o ponto que o projeto controla: o documento sai montado, assinado
 * e com QR Code corretamente formado, ou para com erro explícito se faltar
 * configuração — nunca marca "authorized" sem resposta do autorizador.
 *
 * Uso: node scripts/smoke-fiscal-nfce-go.mjs
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
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
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

// 1. Endpoints oficiais da SEFAZ-GO cadastrados (migration 050)
const { data: endpoints } = await admin
  .from("fiscal_sefaz_endpoints")
  .select("environment, model, service, url")
  .eq("uf", "GO");

const tem = (environment, model, service) =>
  (endpoints || []).some((e) => e.environment === environment && e.model === model && e.service === service);

check(tem("homologacao", "65", "autorizacao"), "GO homologação: autorizacao (NFC-e) cadastrado");
check(tem("producao", "65", "autorizacao"), "GO produção: autorizacao (NFC-e) cadastrado");
check(tem("homologacao", "65", "qrcode"), "GO homologação: URL de consulta do QR Code cadastrada");
check(tem("producao", "65", "qrcode"), "GO produção: URL de consulta do QR Code cadastrada");
check(
  (endpoints || []).every((e) => e.url.startsWith("https://") && e.url.includes("sefaz.go.gov.br")),
  "todas as URLs de GO são https e do domínio oficial da SEFAZ",
);

const homolog = endpoints?.find((e) => e.environment === "homologacao" && e.model === "65" && e.service === "qrcode");
check(
  homolog?.url === "https://nfewebhomolog.sefaz.go.gov.br/nfeweb/sites/nfce/danfeNFCe",
  `URL de QR Code de homologação é a vigente pós-16/06/2025, não a antiga expirada (${homolog?.url})`,
);

// 2. Empresa de teste, série, produto, regra tributária, venda
const stamp = Date.now();
const email = `guarni07+mf.go.${stamp}@gmail.com`;
const password = `Go-${stamp}aA1!`;
await admin.auth.admin.createUser({ email, password, email_confirm: true });
const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
await sb.auth.signInWithPassword({ email, password });
const { data: bootstrap } = await sb.rpc("bootstrap_company", { p_trade_name: `GO NFC-e ${stamp}`, p_email: email });
const companyId = typeof bootstrap === "string" ? bootstrap : bootstrap?.id;

const CNPJ = "11222333000181";
const salvar = async (body) => {
  const { data, error } = await sb.functions.invoke("save-fiscal-settings", { body });
  if (data) return data;
  try {
    return await error.context.json();
  } catch {
    return { error: error?.message || "sem resposta" };
  }
};

const base = {
  cnpj: CNPJ,
  legal_name: "Mercado GO Ltda",
  trade_name: "Mercado GO",
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
};

const pfx = makePfx({ cnpj: CNPJ, password: "senha-cert", commonName: "MERCADO GO LTDA" });
await salvar({ ...base, certificate_pfx: pfx, certificate_password: "senha-cert" });

await sb.from("products").insert({
  company_id: companyId,
  name: "Refrigerante 2L",
  price: 8,
  stock: 50,
  unit: "UN",
  ncm: "22021000",
  cfop: "5102",
  origin: "0",
  gtin: "7891234500002",
});
const { data: produto } = await sb.from("products").select("id").eq("company_id", companyId).maybeSingle();

const { data: conjunto } = await sb
  .from("tax_rule_sets")
  .insert({ company_id: companyId, name: "Regras GO", version: "2026.1", valid_from: "2026-01-01", status: "active" })
  .select()
  .single();
await sb.from("tax_rules").insert({
  rule_set_id: conjunto.id,
  company_id: companyId,
  valid_from: "2026-01-01",
  match: {},
  taxes: {
    icms: { csosn: "102" },
    ibs: { cst: "000", cClassTrib: "000001", pIBSUF: 0.1, pIBSMun: 0 },
    cbs: { cst: "000", cClassTrib: "000001", pCBS: 0.9 },
  },
});

const criarVenda = async () =>
  (
    await sb
      .from("sales")
      .insert({
        company_id: companyId,
        items: [{ product_id: produto.id, name: "Refrigerante 2L", quantity: 1, price: 8, total: 8 }],
        subtotal: 8,
        total: 8,
        payment_method: "pix",
        status: "concluida",
      })
      .select()
      .single()
  ).data;

const emitir = async (saleId) => {
  const { data, error } = await sb.functions.invoke("fiscal-emit", { body: { model: "65", sale_id: saleId } });
  if (data) return data;
  try {
    return await error.context.json();
  } catch {
    return { error: error?.message };
  }
};

// 3. Sem CSC configurado: emissão recusa com mensagem clara, não fabrica QR
const vendaSemCsc = await criarVenda();
const semCsc = await emitir(vendaSemCsc.id);
check(
  /CSC.*ID CSC não cadastrado/i.test(semCsc.error || ""),
  `sem CSC configurado, emissão recusa com motivo claro (${semCsc.error})`,
);
const { data: docSemCsc } = await admin
  .from("fiscal_documents")
  .select("status")
  .eq("id", semCsc.document_id)
  .maybeSingle();
check(docSemCsc?.status === "error", `documento sem CSC fica em 'error', nunca 'authorized' (${docSemCsc?.status})`);

// 4. Com CSC configurado: infNFeSupl/qrCode sai formado no XML assinado
await salvar({
  ...base,
  csc_id_homologacao: "1",
  csc_homologacao: "12345678-1234-1234-1234-123456789012",
});

const vendaComCsc = await criarVenda();
const comCsc = await emitir(vendaComCsc.id);
const { data: docComCsc } = await admin
  .from("fiscal_documents")
  .select("status, xml_signed")
  .eq("id", comCsc.document_id)
  .maybeSingle();

const xml = docComCsc?.xml_signed || "";
check(xml.includes("<infNFeSupl>"), "com CSC configurado, XML assinado tem o grupo infNFeSupl");
check(/<qrCode><!\[CDATA\[https:\/\/nfewebhomolog\.sefaz\.go\.gov\.br/.test(xml), "QR Code aponta para a URL oficial de GO");
check(/\|2\|2\|000001\|[A-F0-9]{40}/.test(xml), "QR Code tem versão 2, tpAmb 2 (homologação), idCSC e hash SHA-1 em maiúsculo");
check(xml.indexOf("<infNFeSupl>") > xml.indexOf("</infNFe>"), "infNFeSupl vem depois de </infNFe>");
check(xml.indexOf("<infNFeSupl>") < xml.indexOf("<Signature"), "infNFeSupl vem antes de <Signature> (ordem do schema TNFe)");
check(
  docComCsc?.status !== "authorized",
  `mesmo com QR Code montado, documento não fica 'authorized' sem resposta real da SEFAZ (status ${docComCsc?.status})`,
);

await admin.from("companies").delete().eq("id", companyId);

console.log("\nSmoke fiscal — NFC-e SEFAZ-GO (endpoints, CSC, QR Code)\n");
for (const m of ok) console.log(`  PASS  ${m}`);
for (const m of falhas) console.log(`  FAIL  ${m}`);
console.log(`\n${ok.length} passaram, ${falhas.length} falharam\n`);
process.exit(falhas.length ? 1 : 0);
