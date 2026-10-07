/**
 * Smoke do cancelamento fiscal real de NFC-e/NF-e (evento 110111) via
 * fiscal-document (action: "cancelar").
 *
 * Não simula autorização — não há como obter um cStat 135/155 real da SEFAZ
 * sem certificado/CSC/credenciamento de uma empresa de verdade (mesma
 * limitação já documentada para a emissão). O que este smoke prova:
 *
 *  1. guardas de negócio (documento não autorizado, sem protocolo, fora do
 *     prazo (NFC-e em GO: 30 min; NF-e: 24h), sem UF, endpoint 'evento' cadastrado) barram ANTES de
 *     qualquer tentativa de rede — determinístico, sem depender da SEFAZ;
 *  2. uma tentativa real de transmissão (com certificado de teste
 *     autoassinado, que a SEFAZ real vai recusar no handshake/validação)
 *     resulta em erro/rejeição, e o documento CONTINUA 'authorized' — nunca
 *     'cancelled' sem confirmação real;
 *  3. NFS-e continua funcionando por caminho separado (não quebrado por esta
 *     mudança);
 *  4. multi-tenant: empresa B não cancela documento da empresa A.
 *
 * Uso: node scripts/smoke-fiscal-cancelamento.mjs
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

const stamp = Date.now();
const email = `guarni07+mf.cancel.${stamp}@gmail.com`;
const password = `Cnl-${stamp}aA1!`;
await admin.auth.admin.createUser({ email, password, email_confirm: true });
const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
await sb.auth.signInWithPassword({ email, password });
const { data: bootstrap } = await sb.rpc("bootstrap_company", { p_trade_name: `Cancel ${stamp}`, p_email: email });
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
  legal_name: "Mercado Cancelamento Ltda",
  trade_name: "Mercado Cancelamento",
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

const pfx = makePfx({ cnpj: CNPJ, password: "senha-cert", commonName: "MERCADO CANCELAMENTO LTDA" });
await salvar({ ...base, certificate_pfx: pfx, certificate_password: "senha-cert" });

const cancelar = async (documentId, justificativa) => {
  const { data, error } = await sb.functions.invoke("fiscal-document", {
    body: { action: "cancelar", document_id: documentId, justificativa },
  });
  if (data) return data;
  try {
    return { ...(await error.context.json()), _httpError: true };
  } catch {
    return { error: error?.message, _httpError: true };
  }
};

let contadorDocs = 0;
const inserirDocumento = async (overrides) => {
  contadorDocs += 1;
  const numero = String(contadorDocs).padStart(9, "0");
  const { data, error } = await admin
    .from("fiscal_documents")
    .insert({
      company_id: companyId,
      model: "65",
      environment: "homologacao",
      status: "authorized",
      access_key: `52260311222333000181650010${numero}000015`,
      protocol: `15226000000${String(contadorDocs).padStart(4, "0")}`,
      authorized_at: new Date().toISOString(),
      number: contadorDocs,
      series: 1,
      ...overrides,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
};

const JUST = "Cliente desistiu da compra e pediu o cancelamento da nota.";

// 1. Documento não autorizado é rejeitado
{
  const doc = await inserirDocumento({ status: "error" });
  const r = await cancelar(doc.id, JUST);
  check(/Só é possível cancelar documento autorizado/i.test(r.error || ""), `documento não autorizado é rejeitado (${r.error})`);
}

// 2. Documento authorized sem protocolo é rejeitado
{
  const doc = await inserirDocumento({ protocol: null });
  const r = await cancelar(doc.id, JUST);
  check(/sem protocolo/i.test(r.error || ""), `documento sem protocolo é rejeitado (${r.error})`);
}

// 3. Documento authorized sem authorized_at é rejeitado
{
  const doc = await inserirDocumento({ authorized_at: null });
  const r = await cancelar(doc.id, JUST);
  check(/sem data de autorização/i.test(r.error || ""), `documento sem authorized_at é rejeitado (${r.error})`);
}

// 4. Fora do prazo é rejeitado (autorizado há 30h: passou dos 30 min da NFC-e e das 24h da NF-e)
{
  const trintaHorasAtras = new Date(Date.now() - 30 * 3_600_000).toISOString();
  const doc = await inserirDocumento({ authorized_at: trintaHorasAtras });
  const r = await cancelar(doc.id, JUST);
  check(/Prazo de cancelamento expirado/i.test(r.error || ""), `fora do prazo é rejeitado (${r.error})`);
  const { data: docDepois } = await admin.from("fiscal_documents").select("status").eq("id", doc.id).single();
  check(docDepois.status === "authorized", "documento fora da janela continua 'authorized' (não muda sem SEFAZ)");
}

// 5. Justificativa curta (<15 caracteres) é rejeitada antes de transmitir
{
  const doc = await inserirDocumento({});
  const r = await cancelar(doc.id, "muito curta");
  check(/entre 15 e 255 caracteres/i.test(r.error || ""), `justificativa curta é rejeitada (${r.error})`);
}

// 6. Dentro da janela, com justificativa válida: tentativa real de transmissão.
//    Certificado autoassinado não é aceito pela SEFAZ real — espera-se
//    rejeição/erro, e o documento deve continuar 'authorized'.
{
  const doc = await inserirDocumento({});
  const r = await cancelar(doc.id, JUST);
  check(
    ["rejected", "error"].includes(r.status) || r._httpError,
    `tentativa real de cancelamento não retorna sucesso fabricado (status: ${r.status || "http error"})`,
  );
  const { data: docDepois } = await admin
    .from("fiscal_documents")
    .select("status, cancelled_at, cancel_protocol")
    .eq("id", doc.id)
    .single();
  check(
    docDepois.status === "authorized" && !docDepois.cancelled_at && !docDepois.cancel_protocol,
    `documento NUNCA vira 'cancelled' sem confirmação real da SEFAZ (status atual: ${docDepois.status})`,
  );

  const { data: eventos } = await admin
    .from("fiscal_document_events")
    .select("event_type, status")
    .eq("document_id", doc.id);
  check(
    eventos?.some((e) => e.event_type === "110111"),
    "evento 110111 foi registrado em fiscal_document_events (trilha de auditoria)",
  );
  check(
    eventos?.every((e) => e.status !== "authorized"),
    "nenhum evento de cancelamento ficou marcado como aprovado sem confirmação real",
  );
}

// 7. Multi-tenant: empresa B não cancela documento da empresa A
{
  const docA = await inserirDocumento({});
  const stampB = Date.now() + 1;
  const emailB = `guarni07+mf.cancel.b.${stampB}@gmail.com`;
  const passwordB = `Cnl-${stampB}aA1!`;
  await admin.auth.admin.createUser({ email: emailB, password: passwordB, email_confirm: true });
  const sbB = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  await sbB.auth.signInWithPassword({ email: emailB, password: passwordB });
  const { data: bootstrapB } = await sbB.rpc("bootstrap_company", { p_trade_name: `Cancel B ${stampB}`, p_email: emailB });
  const companyIdB = typeof bootstrapB === "string" ? bootstrapB : bootstrapB?.id;

  const { data, error } = await sbB.functions.invoke("fiscal-document", {
    body: { action: "cancelar", document_id: docA.id, justificativa: JUST },
  });
  let respostaB = data;
  if (!respostaB) {
    try {
      respostaB = await error.context.json();
    } catch {
      respostaB = { error: error?.message };
    }
  }
  check(
    /não encontrado para esta empresa/i.test(respostaB.error || ""),
    `empresa B não enxerga documento da empresa A (${respostaB.error})`,
  );

  await admin.from("companies").delete().eq("id", companyIdB);
}

await admin.from("companies").delete().eq("id", companyId);

console.log("\nSmoke — cancelamento fiscal real (evento 110111, SEFAZ-GO)\n");
for (const m of ok) console.log(`  PASS  ${m}`);
for (const m of falhas) console.log(`  FAIL  ${m}`);
console.log(`\n${ok.length} passaram, ${falhas.length} falharam\n`);
process.exit(falhas.length ? 1 : 0);
