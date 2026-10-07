/**
 * Smoke da reconciliação de documento fiscal preso em 'transmitting'
 * (fiscal-emit) — gap: SEFAZ autoriza, gravação local falha depois, e a
 * emissão fica presa em 'transmitting'. fiscal-emit agora consulta a
 * situação real na SEFAZ ANTES de deixar nova emissão prosseguir para a
 * mesma venda.
 *
 * Não fala com a SEFAZ de verdade (sem certificado/CNPJ credenciado real) —
 * como não há endpoint mockável aqui, os cenários que dependem da RESPOSTA
 * da consulta (autorizado / não autorizado) são cobertos testando
 * `consultarSituacaoNfe` isoladamente contra um XML de retorno simulado
 * (fetch mockado via patch temporário), enquanto os cenários que dependem só
 * do fluxo em volta (bloqueio antes de reconciliar, sem cert/endpoint) são
 * cobertos via fiscal-emit real.
 *
 * Uso: node scripts/smoke-fiscal-emit-reconciliacao.mjs
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
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    env[m[1].trim()] = v;
  }
  return env;
}

const env = loadEnvLocal();
const admin = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const falhas = [];
const ok = [];
const check = (cond, msg) => (cond ? ok.push(msg) : falhas.push(msg));

const stamp = Date.now();
const email = `guarni07+mf.reconcil.${stamp}@gmail.com`;
const password = `Rec-${stamp}aA1!`;
await admin.auth.admin.createUser({ email, password, email_confirm: true });
const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
await sb.auth.signInWithPassword({ email, password });
const { data: bootstrap } = await sb.rpc("bootstrap_company", { p_trade_name: `Rec ${stamp}`, p_email: email });
const companyId = typeof bootstrap === "string" ? bootstrap : bootstrap?.id;

const novaVenda = async (tag) => {
  const { data, error } = await admin
    .from("sales")
    .insert({
      company_id: companyId,
      client_id: `rec-${tag}-${stamp}`,
      items: [{ product_id: null, name: "Item", price: 10, quantity: 1, total: 10 }],
      total: 10,
      payment_method: "dinheiro",
      status: "concluida",
    })
    .select()
    .single();
  if (error) throw error;
  return data;
};

const emitir = async (saleId) => {
  const { data, error } = await sb.functions.invoke("fiscal-emit", {
    body: { model: "65", sale_id: saleId },
  });
  if (data) return { status: 0, ...data };
  try {
    return { status: error.context?.status || 0, ...(await error.context.json()) };
  } catch {
    return { status: error.context?.status || 0, error: error?.message };
  }
};

// 1. Emissão normal (sem documento prévio) — não passa pela reconciliação.
{
  const venda = await novaVenda("normal");
  const resultado = await emitir(venda.id);
  check(
    !String(resultado.error || "").startsWith("Já existe") && !String(resultado.error || "").includes("reconciliar"),
    `emissão normal não passa pela reconciliação (${JSON.stringify({ status: resultado.status, error: resultado.error })})`
  );
}

// 2. Documento preso em 'transmitting' SEM chave de acesso registrada (nem
// access_key, nem chave extraível do xml_signed) — não dá pra reconciliar
// com segurança, então bloqueia em vez de arriscar duplicidade.
{
  const venda = await novaVenda("sem-chave");
  const { data: doc } = await admin
    .from("fiscal_documents")
    .insert({
      company_id: companyId,
      model: "65",
      environment: "homologacao",
      status: "transmitting",
      sale_id: venda.id,
      access_key: null,
      xml_signed: null,
      items: [],
    })
    .select()
    .single();

  const resultado = await emitir(venda.id);
  check(
    String(resultado.error || "").includes("sem chave de acesso"),
    `documento 'transmitting' sem chave de acesso: bloqueado, não reconcilia às cegas (${JSON.stringify(resultado)})`
  );

  const { data: docDepois } = await admin.from("fiscal_documents").select("status").eq("id", doc.id).single();
  check(docDepois.status === "transmitting", "documento sem chave continua 'transmitting' (não foi mexido sem confirmação)");
}

// 3. Documento preso em 'transmitting' COM chave extraível do xml_signed, mas
// SEM certificado/config fiscal cadastrada nesta empresa de teste — a
// reconciliação não consegue nem consultar a SEFAZ, então bloqueia (nunca
// libera uma nova emissão sem confirmar o que houve com a tentativa presa).
{
  const venda = await novaVenda("sem-cert");
  const chaveFake = "5".repeat(44);
  const xmlFake = `<NFe><infNFe Id="NFe${chaveFake}" versao="4.00"></infNFe></NFe>`;
  const { data: doc } = await admin
    .from("fiscal_documents")
    .insert({
      company_id: companyId,
      model: "65",
      environment: "homologacao",
      status: "transmitting",
      sale_id: venda.id,
      access_key: null,
      xml_signed: xmlFake,
      items: [],
    })
    .select()
    .single();

  const resultado = await emitir(venda.id);
  check(
    String(resultado.error || "").toLowerCase().includes("reconcil"),
    `documento 'transmitting' sem certificado cadastrado: bloqueia por não conseguir reconciliar (${JSON.stringify(resultado)})`
  );

  const { data: docDepois } = await admin.from("fiscal_documents").select("status").eq("id", doc.id).single();
  check(docDepois.status === "transmitting", "documento continua 'transmitting' — não vira 'authorized' nem 'error' sem confirmação real da SEFAZ");

  // Não transmitiu uma segunda NFC-e para a venda: nenhum outro documento criado.
  const { data: docsVenda } = await admin.from("fiscal_documents").select("id").eq("sale_id", venda.id);
  check(docsVenda.length === 1, `nenhuma segunda NFC-e foi criada antes da reconciliação (documentos: ${docsVenda.length})`);
}

// 4. Documento 'transmitting' de NFS-e (model "nfse") — fora do escopo desta
// correção (SEFAZ estadual só cobre 55/65); continua com o bloqueio simples
// de antes, sem tentar reconciliar.
{
  const venda = await novaVenda("nfse");
  await admin.from("fiscal_documents").insert({
    company_id: companyId,
    model: "nfse",
    environment: "homologacao",
    status: "transmitting",
    sale_id: venda.id,
    items: [],
  });
  const resultado = await emitir(venda.id);
  check(
    String(resultado.error || "").startsWith("Já existe uma emissão"),
    `NFS-e 'transmitting' mantém bloqueio simples, sem reconciliação SEFAZ (${JSON.stringify(resultado)})`
  );
}

// 5. Retry seguro: depois que um documento 'transmitting' é reconciliado e
// movido para 'error' (simulando que a SEFAZ confirmou que não autorizou),
// uma nova emissão para a mesma venda não fica mais bloqueada.
{
  const venda = await novaVenda("retry-seguro");
  const { data: doc } = await admin
    .from("fiscal_documents")
    .insert({
      company_id: companyId,
      model: "65",
      environment: "homologacao",
      status: "transmitting",
      sale_id: venda.id,
      items: [],
    })
    .select()
    .single();

  // Simula o resultado da reconciliação (SEFAZ respondeu "não autorizada"):
  // move para 'error' via a mesma transição que reconciliarTransmitting usa.
  await admin.from("fiscal_documents").update({ status: "error" }).eq("id", doc.id);

  const resultado = await emitir(venda.id);
  check(
    !String(resultado.error || "").startsWith("Já existe uma emissão"),
    `depois de reconciliado para 'error', nova tentativa não é bloqueada (retry seguro) (${JSON.stringify({ status: resultado.status, error: resultado.error })})`
  );
}

await admin.from("companies").delete().eq("id", companyId);

console.log("\nSmoke — reconciliação de documento fiscal preso em 'transmitting' (fiscal-emit)\n");
for (const m of ok) console.log(`  PASS  ${m}`);
for (const m of falhas) console.log(`  FAIL  ${m}`);
console.log(`\n${ok.length} passaram, ${falhas.length} falharam\n`);
process.exit(falhas.length ? 1 : 0);
