/**
 * Smoke do isolamento multiempresa das tabelas fiscais.
 *
 * O fiscal antigo morava no localStorage do navegador: sem company_id, sem RLS,
 * e a mesma "fiscal_config" servia qualquer loja aberta naquele terminal.
 * Agora cada tabela fiscal tem company_id e policy por tenant.
 *
 * Verifica:
 *  1. a loja lê e grava a própria configuração fiscal;
 *  2. a loja B não enxerga a configuração fiscal da loja A;
 *  3. certificado e credenciais (company_fiscal_secrets) são invisíveis até
 *     para o dono da loja — só service role alcança;
 *  4. documento fiscal não pode ser criado nem alterado pelo cliente, para
 *     ninguém escrever "authorized" à mão;
 *  5. a trilha de auditoria fiscal é legível só pela própria empresa;
 *  6. a numeração de série é atômica e não se repete;
 *  7. produto e serviço fiscais respeitam o isolamento;
 *  8. as tabelas oficiais de CST são legíveis por qualquer empresa.
 *
 * Uso: node scripts/smoke-fiscal-rls.mjs
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

async function makeTenant(env, tag) {
  const stamp = Date.now() + Math.floor(Math.random() * 1000);
  const email = `guarni07+mf.fiscal.${tag}.${stamp}@gmail.com`;
  const password = `Fiscal-${stamp}aA1!`;
  const admin = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
  await admin.auth.admin.createUser({ email, password, email_confirm: true });
  const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  await sb.auth.signInWithPassword({ email, password });
  const { data: company, error } = await sb.rpc("bootstrap_company", {
    p_trade_name: `Fiscal ${tag} ${stamp}`,
    p_email: email,
  });
  if (error) throw error;
  // bootstrap_company devolve a linha inteira da empresa, não só o id.
  const companyId = typeof company === "string" ? company : company?.id;
  return { sb, company: companyId, email };
}

const env = loadEnvLocal();
const admin = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const a = await makeTenant(env, "a");
const b = await makeTenant(env, "b");

const falhas = [];
const ok = [];
const check = (cond, msg) => (cond ? ok.push(msg) : falhas.push(msg));

// 1. Configuração fiscal própria
const { error: erroConfigA } = await a.sb.from("company_fiscal_settings").insert({
  company_id: a.company,
  cnpj: "11222333000181",
  legal_name: "Loja A Fiscal Ltda",
  trade_name: "Loja A",
  ie: "1234567890",
  uf: "MG",
  city_name: "Belo Horizonte",
  city_ibge_code: "3106200",
  tax_regime: "simples",
  crt: "1",
  environment: "homologacao",
  nfce_enabled: true,
});
check(!erroConfigA, `loja grava a própria config fiscal${erroConfigA ? ` (erro: ${erroConfigA.message})` : ""}`);

const { data: leituraA } = await a.sb
  .from("company_fiscal_settings")
  .select("cnpj, crt")
  .eq("company_id", a.company)
  .maybeSingle();
check(leituraA?.cnpj === "11222333000181", "loja lê a própria config fiscal");

// 2. Loja B não enxerga a config da loja A
const { data: espiada } = await b.sb
  .from("company_fiscal_settings")
  .select("company_id, cnpj")
  .eq("company_id", a.company);
check((espiada || []).length === 0, "loja B não enxerga a config fiscal da loja A");

// 3. Segredos fiscais invisíveis ao próprio dono
// certificate_pfx/certificate_password saíram da tabela (Vault, migration 039)
// — grava via RPC (mesmo caminho da Edge Function) e lê com select("*"), que
// prova a mesma coisa (RLS sem policy pro dono da loja).
await admin.rpc("set_fiscal_secrets", {
  p_company_id: a.company,
  p_certificate_pfx: "base64-do-certificado-de-teste",
  p_certificate_password: "senha-secreta",
  p_nfse_client_id: null,
  p_nfse_client_secret: null,
});
const { data: segredoProprio } = await a.sb
  .from("company_fiscal_secrets")
  .select("*");
check(
  (segredoProprio || []).length === 0,
  "certificado e senha não saem do servidor nem para o dono da loja",
);

const { data: segredoAlheio } = await b.sb
  .from("company_fiscal_secrets")
  .select("*")
  .eq("company_id", a.company);
check((segredoAlheio || []).length === 0, "loja B não alcança o certificado da loja A");

// 4. Cliente não cria documento fiscal
const { error: erroInsertDoc } = await a.sb.from("fiscal_documents").insert({
  company_id: a.company,
  model: "65",
  environment: "homologacao",
  status: "authorized",
  protocol: "123456789012345",
});
check(!!erroInsertDoc, "cliente não consegue inserir documento fiscal autorizado à mão");

const { data: docAdmin, error: erroDocAdmin } = await admin
  .from("fiscal_documents")
  .insert({
    company_id: a.company,
    model: "65",
    environment: "homologacao",
    status: "draft",
    items: [],
  })
  .select()
  .single();
if (erroDocAdmin) {
  console.error("Não foi possível criar o documento de teste:", erroDocAdmin.message);
  process.exit(1);
}

const { error: erroUpdateDoc, data: updated } = await a.sb
  .from("fiscal_documents")
  .update({ status: "authorized", protocol: "999" })
  .eq("id", docAdmin.id)
  .select();
check(
  !!erroUpdateDoc || (updated || []).length === 0,
  "cliente não consegue marcar um documento como autorizado",
);

const { data: docVisivel } = await a.sb
  .from("fiscal_documents")
  .select("id, status")
  .eq("id", docAdmin.id)
  .maybeSingle();
check(docVisivel?.status === "draft", "loja lê os próprios documentos fiscais");

const { data: docAlheio } = await b.sb
  .from("fiscal_documents")
  .select("id")
  .eq("id", docAdmin.id);
check((docAlheio || []).length === 0, "loja B não enxerga documento fiscal da loja A");

// 5. Auditoria fiscal isolada
await admin.from("fiscal_audit_log").insert({
  company_id: a.company,
  document_id: docAdmin.id,
  operation: "smoke",
  status_from: "draft",
  status_to: "validating",
  environment: "homologacao",
});
const { data: auditProprio } = await a.sb
  .from("fiscal_audit_log")
  .select("operation")
  .eq("document_id", docAdmin.id);
check((auditProprio || []).length === 1, "loja lê a própria trilha de auditoria fiscal");

const { data: auditAlheio } = await b.sb
  .from("fiscal_audit_log")
  .select("operation")
  .eq("company_id", a.company);
check((auditAlheio || []).length === 0, "loja B não lê a auditoria fiscal da loja A");

// 6. Numeração atômica
const numeros = [];
for (let i = 0; i < 5; i++) {
  const { data, error } = await admin.rpc("next_fiscal_number", {
    p_company_id: a.company,
    p_model: "65",
    p_series: 1,
    p_environment: "homologacao",
  });
  if (error) {
    falhas.push(`next_fiscal_number falhou: ${error.message}`);
    break;
  }
  numeros.push(Number(data));
}
check(
  numeros.length === 5 && new Set(numeros).size === 5 && numeros[4] - numeros[0] === 4,
  `numeração fiscal sequencial e sem repetição (${numeros.join(", ")})`,
);

const { data: numOutroAmbiente } = await admin.rpc("next_fiscal_number", {
  p_company_id: a.company,
  p_model: "65",
  p_series: 1,
  p_environment: "producao",
});
check(
  Number(numOutroAmbiente) === 1,
  "produção tem numeração própria, sem herdar o que foi gasto em homologação",
);

// 7. Produto e serviço fiscais
await a.sb.from("products").insert({
  company_id: a.company,
  name: "Arroz Fiscal 5kg",
  price: 25.9,
  ncm: "10063021",
  cfop: "5102",
  origin: "0",
  unit: "UN",
});
const { data: prodAlheio } = await b.sb
  .from("products")
  .select("id")
  .eq("company_id", a.company);
check((prodAlheio || []).length === 0, "loja B não enxerga produto fiscal da loja A");

const { error: erroNcm } = await a.sb.from("products").insert({
  company_id: a.company,
  name: "Produto com NCM inválido",
  price: 1,
  ncm: "123",
});
check(!!erroNcm, "NCM fora do formato de 8 dígitos é recusado pelo banco");

const { error: erroServico } = await a.sb.from("services").insert({
  company_id: a.company,
  name: "Entrega em domicílio",
  price: 10,
  lc116_item: "16.01",
  city_ibge_code: "3106200",
  iss_rate: 2,
});
check(!erroServico, `loja cadastra serviço${erroServico ? ` (erro: ${erroServico.message})` : ""}`);

const { data: servAlheio } = await b.sb
  .from("services")
  .select("id")
  .eq("company_id", a.company);
check((servAlheio || []).length === 0, "loja B não enxerga serviço da loja A");

// 8. Tabelas oficiais de referência
const { data: cst } = await b.sb.from("fiscal_cst_codes").select("code").eq("code", "000").maybeSingle();
check(cst?.code === "000", "tabela oficial de CST do IBS/CBS legível por qualquer empresa");

const { count: totalCst } = await admin
  .from("fiscal_cst_codes")
  .select("*", { count: "exact", head: true });
check(totalCst === 18, `tabela CST com os 18 códigos oficiais (encontrados ${totalCst})`);

// Limpeza
await admin.from("fiscal_documents").delete().eq("company_id", a.company);
await admin.from("companies").delete().in("id", [a.company, b.company]);

console.log("\nSmoke fiscal — isolamento multiempresa\n");
for (const m of ok) console.log(`  PASS  ${m}`);
for (const m of falhas) console.log(`  FAIL  ${m}`);
console.log(`\n${ok.length} passaram, ${falhas.length} falharam\n`);
process.exit(falhas.length ? 1 : 0);
