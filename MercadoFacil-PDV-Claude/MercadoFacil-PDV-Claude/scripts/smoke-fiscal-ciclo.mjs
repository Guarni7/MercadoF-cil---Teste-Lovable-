/**
 * Smoke do ciclo de vida do documento fiscal: consulta e cancelamento.
 *
 * Emitir é metade do problema. As duas situações abaixo acontecem em operação
 * real e, mal resolvidas, geram nota duplicada ou nota "cancelada" que continua
 * valendo perante o fisco:
 *
 *   consulta   — a conexão cai depois do envio e o documento fica pendente.
 *                A nota pode existir no autorizador; reemitir duplicaria.
 *   cancelar   — cancelar só no nosso banco não cancela nada. O cancelamento
 *                existe quando o autorizador registra o evento 101101.
 *
 * Verifica:
 *  1. sem certificado, consulta e cancelamento são recusados com o motivo;
 *  2. documento de outra empresa não é alcançável (multiempresa);
 *  3. não se cancela documento que não está autorizado;
 *  4. operador de caixa não cancela documento fiscal;
 *  5. justificativa fora do tamanho oficial (15–255) é recusada antes do envio;
 *  6. motivo de cancelamento fora da tabela oficial é recusado;
 *  7. cancelamento que o autorizador não confirmou NÃO muda o status do
 *     documento — ele continua autorizado;
 *  8. toda tentativa fica registrada na trilha de auditoria.
 *
 * Uso: node scripts/smoke-fiscal-ciclo.mjs
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

function makePfx({ cnpj, password }) {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = "01";
  cert.validity.notBefore = new Date(Date.now() - 86400000);
  cert.validity.notAfter = new Date(Date.now() + 365 * 86400000);
  const attrs = [{ name: "commonName", value: `LOJA CICLO LTDA:${cnpj}` }];
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
const URL = `${env.VITE_SUPABASE_URL.replace(/\/$/, "")}/functions/v1/fiscal-document`;

const falhas = [];
const ok = [];
const check = (cond, msg) => (cond ? ok.push(msg) : falhas.push(msg));

async function novoUsuario(tag) {
  const stamp = Date.now() + Math.floor(Math.random() * 1000);
  const email = `guarni07+mf.ciclo.${tag}.${stamp}@gmail.com`;
  const password = `Ciclo-${stamp}aA1!`;
  await admin.auth.admin.createUser({ email, password, email_confirm: true });
  const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data } = await sb.auth.signInWithPassword({ email, password });
  return { sb, email, token: data.session.access_token, userId: data.user.id };
}

async function chamar(token, body) {
  const res = await fetch(URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: env.VITE_SUPABASE_ANON_KEY,
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  return { status: res.status, json };
}

const CNPJ = "11222333000181";

// Empresa A, com certificado
const dono = await novoUsuario("dono");
const { data: empresaA } = await dono.sb.rpc("bootstrap_company", {
  p_trade_name: `Ciclo Fiscal ${Date.now()}`,
  p_email: dono.email,
});
const companyA = typeof empresaA === "string" ? empresaA : empresaA?.id;

// Empresa B, para o teste de isolamento
const outro = await novoUsuario("outro");
const { data: empresaB } = await outro.sb.rpc("bootstrap_company", {
  p_trade_name: `Ciclo Outro ${Date.now()}`,
  p_email: outro.email,
});
const companyB = typeof empresaB === "string" ? empresaB : empresaB?.id;

await admin.from("company_fiscal_settings").upsert(
  {
    company_id: companyA,
    cnpj: CNPJ,
    legal_name: "Loja Ciclo Ltda",
    im: "123456",
    uf: "MG",
    city_name: "Belo Horizonte",
    city_ibge_code: "3106200",
    tax_regime: "simples",
    crt: "1",
    environment: "homologacao",
    nfse_enabled: true,
  },
  { onConflict: "company_id" },
);

// Documento autorizado de mentira? Não: gravado pelo service role, que é o
// caminho legítimo. O que o smoke verifica é que a Edge Function não muda o
// status sem confirmação do autorizador.
const { data: docAutorizado } = await admin
  .from("fiscal_documents")
  .insert({
    company_id: companyA,
    model: "nfse",
    environment: "homologacao",
    status: "authorized",
    protocol: "PROTO-TESTE-1",
    access_key: "31062011222333000181000000000000000000000000000001",
    items: [],
  })
  .select()
  .single();

const { data: docRascunho } = await admin
  .from("fiscal_documents")
  .insert({
    company_id: companyA,
    model: "nfse",
    environment: "homologacao",
    status: "draft",
    items: [],
  })
  .select()
  .single();

const { data: docOutraEmpresa } = await admin
  .from("fiscal_documents")
  .insert({
    company_id: companyB,
    model: "nfse",
    environment: "homologacao",
    status: "authorized",
    protocol: "PROTO-OUTRO",
    access_key: "31062099888777000166000000000000000000000000000002",
    items: [],
  })
  .select()
  .single();

const JUSTIFICATIVA = "Cancelamento solicitado pelo cliente apos erro de digitacao no pedido";

// 1. Sem certificado cadastrado
const semCert = await chamar(dono.token, {
  action: "consultar",
  document_id: docAutorizado.id,
});
check(
  semCert.status === 422 && /[Cc]ertificado/.test(semCert.json?.error || ""),
  `sem certificado a consulta é recusada com o motivo (status ${semCert.status}: ${semCert.json?.error || ""})`,
);

const cancelSemCert = await chamar(dono.token, {
  action: "cancelar",
  document_id: docAutorizado.id,
  motivo: "1",
  justificativa: JUSTIFICATIVA,
});
check(
  cancelSemCert.status === 422 && /[Cc]ertificado/.test(cancelSemCert.json?.error || ""),
  "sem certificado o cancelamento é recusado com o motivo",
);

// Cadastra o certificado para os testes seguintes
// certificate_pfx/certificate_password saíram da tabela (Vault, migration 039).
await admin.rpc("set_fiscal_secrets", {
  p_company_id: companyA,
  p_certificate_pfx: makePfx({ cnpj: CNPJ, password: "ciclo123" }),
  p_certificate_password: "ciclo123",
  p_nfse_client_id: null,
  p_nfse_client_secret: null,
});

// 2. Isolamento multiempresa
const alheio = await chamar(dono.token, {
  action: "consultar",
  document_id: docOutraEmpresa.id,
});
check(
  alheio.status === 404,
  `documento de outra empresa não é alcançável (status ${alheio.status})`,
);

// 3. Cancelar documento não autorizado
const cancelRascunho = await chamar(dono.token, {
  action: "cancelar",
  document_id: docRascunho.id,
  motivo: "1",
  justificativa: JUSTIFICATIVA,
});
check(
  cancelRascunho.status === 422 && /autorizado/.test(cancelRascunho.json?.error || ""),
  `não se cancela documento em rascunho (${cancelRascunho.json?.error || cancelRascunho.status})`,
);

// 4. Operador de caixa não cancela
const caixa = await novoUsuario("caixa");
await admin
  .from("profiles")
  .update({ company_id: companyA, company_role: "cashier", role: "user" })
  .eq("id", caixa.userId);

const cancelCaixa = await chamar(caixa.token, {
  action: "cancelar",
  document_id: docAutorizado.id,
  motivo: "1",
  justificativa: JUSTIFICATIVA,
});
check(
  cancelCaixa.status === 403,
  `operador de caixa não cancela documento fiscal (status ${cancelCaixa.status})`,
);

// 5. Justificativa fora do tamanho oficial (TSMotivo: 15 a 255)
const curta = await chamar(dono.token, {
  action: "cancelar",
  document_id: docAutorizado.id,
  motivo: "1",
  justificativa: "Erro",
});
check(
  curta.status === 400 && /15/.test(curta.json?.error || ""),
  `justificativa curta é barrada antes de ir ao autorizador (${curta.json?.error || curta.status})`,
);

// 6. Motivo fora da tabela oficial
const motivoInvalido = await chamar(dono.token, {
  action: "cancelar",
  document_id: docAutorizado.id,
  motivo: "7",
  justificativa: JUSTIFICATIVA,
});
check(
  motivoInvalido.status === 400,
  `motivo fora da tabela oficial é recusado (status ${motivoInvalido.status})`,
);

// 7. Cancelamento sem confirmação do autorizador não cancela nada.
//
// O certificado é autoassinado e o autorizador não vai aceitar a conexão — é
// exatamente o cenário que interessa: a resposta tem que ser falha, e o
// documento tem que continuar autorizado.
const tentativa = await chamar(dono.token, {
  action: "cancelar",
  document_id: docAutorizado.id,
  motivo: "1",
  justificativa: JUSTIFICATIVA,
});
check(
  tentativa.status === 422 && ["error", "rejected"].includes(tentativa.json?.status),
  `cancelamento sem confirmação do autorizador falha honestamente (status ${tentativa.status}, ${tentativa.json?.status})`,
);

const { data: depois } = await admin
  .from("fiscal_documents")
  .select("status, cancelled_at, cancel_protocol")
  .eq("id", docAutorizado.id)
  .maybeSingle();
check(
  depois?.status === "authorized" && !depois?.cancelled_at,
  `documento continua autorizado após cancelamento não confirmado (status: ${depois?.status})`,
);

// 8. Evento registrado como tentativa, não como sucesso
const { data: eventos } = await admin
  .from("fiscal_document_events")
  .select("event_type, status, protocol")
  .eq("document_id", docAutorizado.id);
check(
  (eventos || []).length > 0 && eventos.every((e) => e.status !== "authorized"),
  `tentativa de cancelamento fica registrada sem virar evento autorizado (${(eventos || [])
    .map((e) => e.status)
    .join(", ")})`,
);

const { data: auditoria } = await admin
  .from("fiscal_audit_log")
  .select("operation")
  .eq("document_id", docAutorizado.id);
check(
  (auditoria || []).some((a) => a.operation === "cancel_failed"),
  `a falha no cancelamento fica na trilha de auditoria (${(auditoria || [])
    .map((a) => a.operation)
    .join(", ")})`,
);

// Limpeza
await admin.from("fiscal_documents").delete().in("company_id", [companyA, companyB]);
await admin.from("companies").delete().in("id", [companyA, companyB]);
await admin.auth.admin.deleteUser(dono.userId).catch(() => {});
await admin.auth.admin.deleteUser(outro.userId).catch(() => {});
await admin.auth.admin.deleteUser(caixa.userId).catch(() => {});

console.log("\nSmoke fiscal — consulta e cancelamento\n");
for (const m of ok) console.log(`  PASS  ${m}`);
for (const m of falhas) console.log(`  FAIL  ${m}`);
console.log(`\n${ok.length} passaram, ${falhas.length} falharam\n`);
process.exit(falhas.length ? 1 : 0);
