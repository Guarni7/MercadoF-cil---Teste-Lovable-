/**
 * Smoke do certificado digital e da assinatura do documento fiscal.
 *
 * O certificado é o único material do sistema que, vazando, permite emitir nota
 * em nome da empresa. Ele nunca pode voltar para o navegador, e o sistema
 * também não pode aceitar um certificado de outra empresa nem um vencido.
 *
 * Gera um .pfx de teste na hora (RSA 2048, autoassinado) para exercitar o
 * caminho real de leitura, validação e assinatura, sem depender de certificado
 * ICP-Brasil de cliente.
 *
 * Verifica:
 *  1. senha errada é recusada com mensagem clara, não com erro genérico;
 *  2. certificado vencido é recusado;
 *  3. certificado de CNPJ diferente do configurado é recusado;
 *  4. certificado válido é aceito e a tela recebe só titular e validade;
 *  5. o .pfx e a senha não voltam em nenhuma resposta nem por leitura direta;
 *  6. ativar produção sem certificado é bloqueado;
 *  7. operador (não admin) não altera configuração fiscal;
 *  8. com certificado, o documento sai assinado: XMLDSig com DigestValue,
 *     SignatureValue e X509Certificate, referenciando o Id do elemento;
 *  9. a emissão não vira 'authorized' mesmo assinada, porque o autorizador não
 *     confirmou.
 *
 * Uso: node scripts/smoke-fiscal-certificado.mjs
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

/** .pfx autoassinado só para exercitar leitura, validação e assinatura. */
function makePfx({ cnpj, password, validFrom, validTo, commonName }) {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = "01";
  cert.validity.notBefore = validFrom;
  cert.validity.notAfter = validTo;
  const attrs = [{ name: "commonName", value: `${commonName}:${cnpj}` }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  const p12 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], password, {
    algorithm: "3des",
  });
  return forge.util.encode64(forge.asn1.toDer(p12).getBytes());
}

const env = loadEnvLocal();
const admin = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const stamp = Date.now();
const email = `guarni07+mf.cert.${stamp}@gmail.com`;
const password = `Cert-${stamp}aA1!`;
await admin.auth.admin.createUser({ email, password, email_confirm: true });

const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
await sb.auth.signInWithPassword({ email, password });
const { data: bootstrap } = await sb.rpc("bootstrap_company", {
  p_trade_name: `Certificado ${stamp}`,
  p_email: email,
});
const companyId = typeof bootstrap === "string" ? bootstrap : bootstrap?.id;

const falhas = [];
const ok = [];
const check = (cond, msg) => (cond ? ok.push(msg) : falhas.push(msg));

const CNPJ = "11222333000181";
const SENHA_CERT = "senha-do-certificado";

const salvar = async (body) => {
  const { data, error } = await sb.functions.invoke("save-fiscal-settings", { body });
  if (data) return data;
  try {
    return await error.context.json();
  } catch {
    return { error: error?.message || "sem resposta" };
  }
};

// UF precisa ter endpoint oficial da SEFAZ cadastrado (fiscal_sefaz_endpoints,
// 050_fiscal_sefaz_go_endpoints.sql) — só GO tem hoje. Com uma UF sem
// endpoint, a emissão pararia no bloco de QR Code antes de gravar xml_signed,
// pelo mesmo motivo do CSC (ver comentário no r4 abaixo).
const base = {
  cnpj: CNPJ,
  legal_name: "Mercado Certificado Ltda",
  trade_name: "Mercado Certificado",
  ie: "109876547",
  uf: "GO",
  city_name: "Goiânia",
  city_ibge_code: "5208707",
  tax_regime: "simples",
  crt: "1",
  environment: "homologacao",
  nfce_enabled: true,
  address: "Rua das Flores",
  address_number: "100",
  neighborhood: "Centro",
  cep: "74000000",
};

const ano = 365 * 24 * 60 * 60 * 1000;
const pfxValido = makePfx({
  cnpj: CNPJ,
  password: SENHA_CERT,
  validFrom: new Date(Date.now() - ano),
  validTo: new Date(Date.now() + ano),
  commonName: "MERCADO CERTIFICADO LTDA",
});

// 1. Senha errada
const r1 = await salvar({ ...base, certificate_pfx: pfxValido, certificate_password: "errada" });
check(/senha/i.test(r1.error || ""), `senha errada recusada com mensagem clara (${r1.error})`);

// 2. Certificado vencido
const pfxVencido = makePfx({
  cnpj: CNPJ,
  password: SENHA_CERT,
  validFrom: new Date(Date.now() - 2 * ano),
  validTo: new Date(Date.now() - ano),
  commonName: "MERCADO CERTIFICADO LTDA",
});
const r2 = await salvar({ ...base, certificate_pfx: pfxVencido, certificate_password: SENHA_CERT });
check(/vencido/i.test(r2.error || ""), `certificado vencido recusado (${r2.error})`);

// 3. Certificado de outro CNPJ
const pfxOutro = makePfx({
  cnpj: "11444777000161",
  password: SENHA_CERT,
  validFrom: new Date(Date.now() - ano),
  validTo: new Date(Date.now() + ano),
  commonName: "OUTRA EMPRESA LTDA",
});
const r3 = await salvar({ ...base, certificate_pfx: pfxOutro, certificate_password: SENHA_CERT });
check(
  /pertence ao CNPJ/i.test(r3.error || ""),
  `certificado de outro CNPJ recusado (${r3.error})`,
);

// 6. Produção sem certificado
const r6 = await salvar({ ...base, environment: "producao" });
check(
  /sem certificado/i.test(r6.error || ""),
  `ativar produção sem certificado é bloqueado (${r6.error})`,
);

// 4. Certificado válido
// CSC/ID CSC (051_fiscal_csc.sql) é exigido pelo fiscal-emit para NFC-e desde
// que o QR Code (NT 2015.002) passou a ser montado de verdade — sem isso a
// emissão para no bloco de CSC, antes mesmo de gravar xml_signed, mesmo com a
// assinatura já calculada em memória. Configurar aqui é o que faz a venda
// simulada abaixo chegar a 'transmitting' de verdade e exercitar a assinatura.
const r4 = await salvar({
  ...base,
  certificate_pfx: pfxValido,
  certificate_password: SENHA_CERT,
  csc_id_homologacao: "000001",
  csc_homologacao: "11111111-2222-3333-4444-555555555555",
});
check(
  r4.certificate?.subject && /MERCADO CERTIFICADO/i.test(r4.certificate.subject),
  `certificado válido aceito e titular devolvido (${r4.certificate?.subject})`,
);
check(!!r4.certificate?.valid_to, `validade do certificado devolvida (${r4.certificate?.valid_to})`);
check(r4.certificate?.cnpj === CNPJ, "CNPJ lido do certificado confere com o da empresa");

// 5. Segredo não vaza
const resposta = JSON.stringify(r4);
check(
  !resposta.includes(pfxValido.slice(0, 80)) && !resposta.includes(SENHA_CERT),
  "nem o .pfx nem a senha aparecem na resposta da Edge Function",
);

// certificate_pfx/certificate_password saíram da tabela (Vault, migration 039)
// — select("*") continua provando o mesmo (RLS sem policy pro dono da loja).
const { data: leituraDireta } = await sb
  .from("company_fiscal_secrets")
  .select("*");
check(
  (leituraDireta || []).length === 0,
  "leitura direta da tabela de segredos não devolve nada para o dono da loja",
);

const { data: espelho } = await sb
  .from("company_fiscal_settings")
  .select("certificate_subject, certificate_valid_until")
  .eq("company_id", companyId)
  .maybeSingle();
check(
  !!espelho?.certificate_subject && !!espelho?.certificate_valid_until,
  "a tela tem titular e validade para mostrar sem receber o certificado",
);

// 7. Operador não altera configuração fiscal
const emailOp = `guarni07+mf.cert.op.${stamp}@gmail.com`;
const senhaOp = `Op-${stamp}aA1!`;
const { data: opUser } = await admin.auth.admin.createUser({
  email: emailOp,
  password: senhaOp,
  email_confirm: true,
});
await admin
  .from("profiles")
  .update({ company_id: companyId, company_role: "operator", role: "user" })
  .eq("id", opUser.user.id);

const sbOp = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
await sbOp.auth.signInWithPassword({ email: emailOp, password: senhaOp });
const { error: erroOp } = await sbOp.functions.invoke("save-fiscal-settings", {
  body: { cnpj: "00000000000191" },
});
let mensagemOp = "";
try {
  mensagemOp = (await erroOp.context.json()).error;
} catch {
  mensagemOp = erroOp?.message || "";
}
check(/administradores/i.test(mensagemOp), `operador não altera configuração fiscal (${mensagemOp})`);

// 8 e 9. Documento assinado
await sb.from("products").insert({
  company_id: companyId,
  name: "Feijão Carioca 1kg",
  price: 9.5,
  stock: 20,
  unit: "UN",
  ncm: "07133319",
  cfop: "5102",
  origin: "0",
  gtin: "7891234567901",
});
const { data: produto } = await sb
  .from("products")
  .select("id")
  .eq("company_id", companyId)
  .maybeSingle();

const { data: conjunto } = await sb
  .from("tax_rule_sets")
  .insert({
    company_id: companyId,
    name: "Regras da loja",
    version: "2026.1",
    valid_from: "2026-01-01",
    status: "active",
  })
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

const { data: venda } = await sb
  .from("sales")
  .insert({
    company_id: companyId,
    items: [{ product_id: produto.id, name: "Feijão Carioca 1kg", quantity: 1, price: 9.5, total: 9.5 }],
    subtotal: 9.5,
    total: 9.5,
    payment_method: "dinheiro",
    status: "concluida",
  })
  .select()
  .single();

const { data: emissao, error: erroEmissao } = await sb.functions.invoke("fiscal-emit", {
  body: { model: "65", sale_id: venda.id },
});
let resultadoEmissao = emissao;
if (!resultadoEmissao) {
  try {
    resultadoEmissao = await erroEmissao.context.json();
  } catch {
    resultadoEmissao = { error: erroEmissao?.message };
  }
}

const { data: documento } = await admin
  .from("fiscal_documents")
  .select("status, protocol, xml_signed")
  .eq("id", resultadoEmissao.document_id)
  .maybeSingle();

const xml = documento?.xml_signed || "";
check(xml.includes("<Signature"), "documento saiu com bloco Signature");
check(/<DigestValue>[A-Za-z0-9+/=]{20,}<\/DigestValue>/.test(xml), "assinatura tem DigestValue calculado");
check(
  /<SignatureValue>[A-Za-z0-9+/=]{300,}<\/SignatureValue>/.test(xml),
  "assinatura tem SignatureValue RSA",
);
check(/<X509Certificate>[A-Za-z0-9+/=]{500,}<\/X509Certificate>/.test(xml), "assinatura embute o certificado");

const idAssinado = xml.match(/<infNFe Id="([^"]+)"/)?.[1];
check(
  !!idAssinado && xml.includes(`<Reference URI="#${idAssinado}">`),
  `Reference aponta para o Id do elemento assinado (${idAssinado})`,
);
check(
  xml.indexOf("<Signature") > xml.indexOf("</infNFe>"),
  "assinatura fica depois do elemento assinado, como manda o enveloped",
);

check(
  documento?.status !== "authorized" && !documento?.protocol,
  `mesmo assinado, o documento não é autorizado sem protocolo (status ${documento?.status})`,
);

await admin.auth.admin.deleteUser(opUser.user.id);
await admin.from("companies").delete().eq("id", companyId);

console.log("\nSmoke fiscal — certificado digital e assinatura\n");
for (const m of ok) console.log(`  PASS  ${m}`);
for (const m of falhas) console.log(`  FAIL  ${m}`);
console.log(`\n${ok.length} passaram, ${falhas.length} falharam\n`);
process.exit(falhas.length ? 1 : 0);
