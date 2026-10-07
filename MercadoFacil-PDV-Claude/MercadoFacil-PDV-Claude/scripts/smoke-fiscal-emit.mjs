/**
 * Smoke do fluxo de emissão fiscal.
 *
 * O que este teste protege: a emissão antiga rodava inteira no navegador e
 * gravava status "autorizada" sem nunca ter falado com autorizador nenhum.
 * O fluxo novo tem que se recusar a fazer isso, mesmo quando tudo o mais dá
 * certo — nota só é autorizada com protocolo oficial.
 *
 * Verifica:
 *  1. empresa sem configuração fiscal recebe erro de validação, não uma nota;
 *  2. produto sem NCM barra a emissão com mensagem que diz qual item;
 *  3. item sem regra tributária vigente barra a emissão (nada de alíquota
 *     chutada);
 *  4. com tudo válido e sem certificado, o resultado é 'error' com motivo —
 *     nunca 'authorized';
 *  5. nenhum documento termina como 'authorized' sem protocolo;
 *  6. a numeração fiscal não é consumida por documento reprovado na validação;
 *  7. toda tentativa, inclusive as que falharam, fica na trilha de auditoria;
 *  8. a regra tributária vigente é aplicada e o IBS/CBS é calculado com as
 *     alíquotas da regra, não de constante no código.
 *
 * Uso: node scripts/smoke-fiscal-emit.mjs
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

const stamp = Date.now();
const email = `guarni07+mf.emit.${stamp}@gmail.com`;
const password = `Emit-${stamp}aA1!`;
await admin.auth.admin.createUser({ email, password, email_confirm: true });

const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
await sb.auth.signInWithPassword({ email, password });
const { data: bootstrap } = await sb.rpc("bootstrap_company", {
  p_trade_name: `Emissao ${stamp}`,
  p_email: email,
});
const companyId = typeof bootstrap === "string" ? bootstrap : bootstrap?.id;

const falhas = [];
const ok = [];
const check = (cond, msg) => (cond ? ok.push(msg) : falhas.push(msg));

const emitir = async (body) => {
  const { data, error } = await sb.functions.invoke("fiscal-emit", { body });
  if (data) return data;
  // Erro HTTP: o corpo real vem no context da resposta.
  try {
    return await error.context.json();
  } catch {
    return { error: error?.message || "sem resposta" };
  }
};

const numeroAtual = async () => {
  const { data } = await admin
    .from("fiscal_document_series")
    .select("current_number")
    .eq("company_id", companyId)
    .eq("model", "65")
    .maybeSingle();
  return data?.current_number ?? 0;
};

// Produto e venda de apoio
const { data: produto } = await sb
  .from("products")
  .insert({ company_id: companyId, name: "Arroz Tipo 1 5kg", price: 27.9, stock: 10, unit: "UN" })
  .select()
  .single();

const novaVenda = async () => {
  const { data } = await sb
    .from("sales")
    .insert({
      company_id: companyId,
      items: [{ product_id: produto.id, name: produto.name, quantity: 2, price: 27.9, total: 55.8 }],
      subtotal: 55.8,
      total: 55.8,
      payment_method: "dinheiro",
      status: "concluida",
    })
    .select()
    .single();
  return data;
};

// 1. Sem configuração fiscal
const venda1 = await novaVenda();
const r1 = await emitir({ model: "65", sale_id: venda1.id });
check(
  r1.status !== "authorized" && /valida/i.test(r1.error || ""),
  `sem config fiscal a emissão é barrada (${r1.error || r1.status})`,
);
check(
  Array.isArray(r1.details) &&
    r1.details.some((d) => d.field === "fiscal" && /não preenchida/i.test(d.message)),
  "a mensagem diz que falta a configuração fiscal, em vez de erro genérico",
);

// Configuração fiscal válida
await sb.from("company_fiscal_settings").insert({
  company_id: companyId,
  cnpj: "11222333000181",
  legal_name: "Mercado Emissao Ltda",
  trade_name: "Mercado Emissao",
  ie: "1234567890",
  uf: "MG",
  city_name: "Belo Horizonte",
  city_ibge_code: "3106200",
  tax_regime: "simples",
  crt: "1",
  environment: "homologacao",
  nfce_enabled: true,
  address: "Rua das Flores",
  address_number: "100",
  neighborhood: "Centro",
  cep: "30110000",
});

// 2. Produto sem NCM
const numeroAntes = await numeroAtual();
const venda2 = await novaVenda();
const r2 = await emitir({ model: "65", sale_id: venda2.id });
check(
  r2.status !== "authorized" &&
    Array.isArray(r2.details) &&
    r2.details.some((d) => /NCM/i.test(d.message)),
  "produto sem NCM barra a emissão dizendo qual item",
);

// 6. Validação reprovada não consome número de série
check(
  (await numeroAtual()) === numeroAntes,
  "documento reprovado na validação não queima número da série fiscal",
);

// Produto fiscalmente completo
await sb
  .from("products")
  .update({ ncm: "10063021", cfop: "5102", origin: "0", unit: "UN", gtin: "7891234567895" })
  .eq("id", produto.id);

// 3. Sem regra tributária vigente
const venda3 = await novaVenda();
const r3 = await emitir({ model: "65", sale_id: venda3.id });
check(
  r3.status !== "authorized" &&
    Array.isArray(r3.details) &&
    r3.details.some((d) => d.field === "tax_rule"),
  "item sem regra tributária vigente é recusado em vez de receber alíquota chutada",
);

// Regra tributária vigente, com alíquotas vindas do dado e não do código
const { data: conjunto } = await sb
  .from("tax_rule_sets")
  .insert({
    company_id: companyId,
    name: "Regras da loja",
    version: "2026.1",
    valid_from: "2026-01-01",
    status: "active",
    source: "Cadastro do contador",
  })
  .select()
  .single();

await sb.from("tax_rules").insert({
  rule_set_id: conjunto.id,
  company_id: companyId,
  description: "Simples Nacional — mercadoria tributada",
  valid_from: "2026-01-01",
  match: {},
  taxes: {
    icms: { csosn: "102" },
    pis: { cst: "49", aliquota: 0 },
    cofins: { cst: "49", aliquota: 0 },
    ibs: { cst: "000", cClassTrib: "000001", pIBSUF: 0.1, pIBSMun: 0, pRedAliq: 0 },
    cbs: { cst: "000", cClassTrib: "000001", pCBS: 0.9, pRedAliq: 0 },
  },
});

// 4 e 5. Tudo válido, sem certificado
const venda4 = await novaVenda();
const r4 = await emitir({ model: "65", sale_id: venda4.id });
check(
  r4.status === "error" && /certificado/i.test(r4.error || ""),
  `sem certificado o resultado é erro explicando o motivo (${r4.error || r4.status})`,
);
check(r4.status !== "authorized", "fluxo não declara autorizada uma nota que não foi transmitida");

const { data: docs } = await admin
  .from("fiscal_documents")
  .select("id, status, protocol, number, totals, items")
  .eq("company_id", companyId)
  .order("created_at", { ascending: false });

check(
  !(docs || []).some((d) => d.status === "authorized" && !d.protocol),
  "nenhum documento ficou autorizado sem protocolo",
);

// 8. IBS/CBS calculado pela regra
const ultimo = (docs || []).find((d) => d.number);
const item = ultimo?.items?.[0];
const ibs = item?.taxes?.ibscbs?.gIBSCBS;
check(
  ibs && Math.abs(ibs.gIBSUF.vIBSUF - 0.06) < 0.005 && Math.abs(ibs.gCBS.vCBS - 0.5) < 0.005,
  `IBS/CBS calculado com a alíquota da regra (vIBSUF=${ibs?.gIBSUF?.vIBSUF}, vCBS=${ibs?.gCBS?.vCBS} sobre R$ 55,80)`,
);
check(
  ultimo?.totals?.vBCIBSCBS === 55.8,
  `base de cálculo do IBS/CBS totalizada (${ultimo?.totals?.vBCIBSCBS})`,
);

// 7. Auditoria registrou as tentativas
const { data: trilha } = await admin
  .from("fiscal_audit_log")
  .select("operation, status_from, status_to, error_message")
  .eq("company_id", companyId);

check((trilha || []).length >= 4, `trilha de auditoria registrou as tentativas (${(trilha || []).length} eventos)`);
check(
  (trilha || []).some((t) => t.status_to === "error" && t.error_message),
  "a auditoria guarda o motivo da falha, não só o status",
);

await admin.from("companies").delete().eq("id", companyId);

console.log("\nSmoke fiscal — fluxo de emissão\n");
for (const m of ok) console.log(`  PASS  ${m}`);
for (const m of falhas) console.log(`  FAIL  ${m}`);
console.log(`\n${ok.length} passaram, ${falhas.length} falharam\n`);
process.exit(falhas.length ? 1 : 0);
