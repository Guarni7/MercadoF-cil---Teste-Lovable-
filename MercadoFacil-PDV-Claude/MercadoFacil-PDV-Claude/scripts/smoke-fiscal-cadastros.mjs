/**
 * Smoke dos cadastros fiscais de produto e serviço.
 *
 * O que este teste protege: antes, a classificação fiscal digitada na tela era
 * jogada fora (o diálogo mostrava "salvo" e não gravava nada) e não havia
 * cadastro de serviço nenhum — quem presta serviço não tinha o que emitir. Além
 * disso, item de serviço só existia no corpo da requisição, o que deixaria o
 * lojista escolher o enquadramento a dedo na hora de emitir.
 *
 * Verifica:
 *  1. os campos fiscais do produto persistem em coluna própria;
 *  2. o banco recusa NCM/CEST/CFOP fora do formato oficial;
 *  3. serviço é gravado com item da LC 116, município, ISS e retenções;
 *  4. serviço de uma loja é invisível para outra (RLS);
 *  5. serviço sem item da LC 116 barra a emissão de NFS-e dizendo qual item;
 *  6. a classificação usada na emissão vem do cadastro, não do que o cliente
 *     mandar no corpo da requisição.
 *
 * Uso: node scripts/smoke-fiscal-cadastros.mjs
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

const novaLoja = async (sufixo) => {
  const email = `guarni07+mf.cad.${sufixo}.${stamp}@gmail.com`;
  const password = `Cad-${stamp}aA1!`;
  await admin.auth.admin.createUser({ email, password, email_confirm: true });
  const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  await sb.auth.signInWithPassword({ email, password });
  const { data: bootstrap } = await sb.rpc("bootstrap_company", {
    p_trade_name: `Cadastros ${sufixo} ${stamp}`,
    p_email: email,
  });
  const companyId = typeof bootstrap === "string" ? bootstrap : bootstrap?.id;
  return { sb, companyId };
};

const lojaA = await novaLoja("a");
const lojaB = await novaLoja("b");

// 1. Campos fiscais do produto em coluna própria
const { data: produto, error: erroProduto } = await lojaA.sb
  .from("products")
  .insert({
    company_id: lojaA.companyId,
    name: "Refrigerante Cola 2L",
    price: 9.9,
    unit: "UN",
    ncm: "22021000",
    cest: "0300700",
    cfop: "5405",
    origin: "0",
    icms_csosn: "500",
    pis_cst: "49",
    cofins_cst: "49",
    gtin: "7891234567895",
    ibscbs_cst: "000",
    ibscbs_class_trib: "000001",
  })
  .select()
  .single();

check(
  !erroProduto && produto?.ncm === "22021000" && produto?.cest === "0300700",
  `classificação fiscal do produto persiste em coluna própria (${erroProduto?.message || "ok"})`,
);
check(
  produto?.icms_csosn === "500" && produto?.ibscbs_class_trib === "000001",
  "CSOSN e classificação tributária do IBS/CBS ficam gravados no produto",
);

// 2. Formato oficial cobrado pelo banco
const { error: erroNcm } = await lojaA.sb
  .from("products")
  .update({ ncm: "123" })
  .eq("id", produto.id);
check(!!erroNcm, `NCM fora do formato é recusado pelo banco (${erroNcm?.message || "aceitou!"})`);

const { error: erroCfop } = await lojaA.sb
  .from("products")
  .update({ cfop: "51020" })
  .eq("id", produto.id);
check(!!erroCfop, "CFOP fora do formato é recusado pelo banco");

// 3. Cadastro de serviço completo
const { data: servico, error: erroServico } = await lojaA.sb
  .from("services")
  .insert({
    company_id: lojaA.companyId,
    name: "Entrega expressa",
    price: 30,
    unit: "UN",
    lc116_item: "16.01",
    service_national_code: "160101",
    city_ibge_code: "3106200",
    iss_rate: 3,
    iss_withheld: false,
    withhold_inss: true,
    ibscbs_cst: "000",
    ibscbs_class_trib: "000001",
  })
  .select()
  .single();

check(
  !erroServico && servico?.lc116_item === "16.01" && servico?.city_ibge_code === "3106200",
  `serviço grava item da LC 116 e município de incidência (${erroServico?.message || "ok"})`,
);
check(
  Number(servico?.iss_rate) === 3 && servico?.withhold_inss === true,
  "alíquota de ISS e retenção federal ficam no cadastro do serviço",
);

// 4. Isolamento entre lojas
const { data: vistoPorB } = await lojaB.sb.from("services").select("id").eq("id", servico.id);
check((vistoPorB || []).length === 0, "serviço de uma loja não aparece para outra");

// Configuração fiscal mínima para NFS-e
await lojaA.sb.from("company_fiscal_settings").insert({
  company_id: lojaA.companyId,
  cnpj: "11222333000181",
  legal_name: "Servicos Cadastro Ltda",
  trade_name: "Servicos Cadastro",
  im: "987654",
  uf: "MG",
  city_name: "Belo Horizonte",
  city_ibge_code: "3106200",
  tax_regime: "simples",
  crt: "1",
  environment: "homologacao",
  nfse_enabled: true,
  address: "Rua das Flores",
  address_number: "100",
  neighborhood: "Centro",
  cep: "30110000",
});

const emitir = async (sb, body) => {
  const { data, error } = await sb.functions.invoke("fiscal-emit", { body });
  if (data) return data;
  try {
    return await error.context.json();
  } catch {
    return { error: error?.message || "sem resposta" };
  }
};

// 5. Serviço sem item da LC 116 barra a emissão
const { data: semClassificacao } = await lojaA.sb
  .from("services")
  .insert({ company_id: lojaA.companyId, name: "Consultoria avulsa", price: 100 })
  .select()
  .single();

const r1 = await emitir(lojaA.sb, {
  model: "nfse",
  items: [
    {
      service_id: semClassificacao.id,
      name: "Consultoria avulsa",
      quantity: 1,
      price: 100,
      total: 100,
    },
  ],
  customer: { name: "Cliente Servico", document: "11222333000181" },
});

check(
  r1.status !== "authorized" &&
    Array.isArray(r1.details) &&
    r1.details.some((d) => /c[oó]digo do servi/i.test(d.message)),
  `serviço sem item da LC 116 barra a emissão dizendo qual item (${r1.error || r1.status})`,
);

// 6. O corpo da requisição não enquadra o serviço: quem manda é o cadastro.
const r2 = await emitir(lojaA.sb, {
  model: "nfse",
  items: [
    {
      service_id: semClassificacao.id,
      name: "Consultoria avulsa",
      quantity: 1,
      price: 100,
      total: 100,
      lc116_item: "17.01",
      service_national_code: "170101",
    },
  ],
  customer: { name: "Cliente Servico", document: "11222333000181" },
});

check(
  r2.status !== "authorized" &&
    Array.isArray(r2.details) &&
    r2.details.some((d) => /c[oó]digo do servi/i.test(d.message)),
  "classificação enviada pelo cliente não substitui a do cadastro",
);

// Com o cadastro classificado, a validação do item passa e a emissão só para
// adiante, no certificado — nunca em "autorizada".
const r3 = await emitir(lojaA.sb, {
  model: "nfse",
  items: [
    { service_id: servico.id, name: servico.name, quantity: 1, price: 30, total: 30 },
  ],
  customer: { name: "Cliente Servico", document: "11222333000181" },
});

check(
  r3.status !== "authorized" &&
    !(Array.isArray(r3.details) && r3.details.some((d) => /c[oó]digo do servi/i.test(d.message))),
  `serviço classificado passa da validação de item (${r3.error || r3.status})`,
);

const { data: docs } = await admin
  .from("fiscal_documents")
  .select("status, protocol")
  .eq("company_id", lojaA.companyId);
check(
  !(docs || []).some((d) => d.status === "authorized" && !d.protocol),
  "nenhuma NFS-e ficou autorizada sem protocolo do autorizador",
);

await admin.from("companies").delete().eq("id", lojaA.companyId);
await admin.from("companies").delete().eq("id", lojaB.companyId);

console.log("\nSmoke fiscal — cadastros de produto e serviço\n");
for (const m of ok) console.log(`  PASS  ${m}`);
for (const m of falhas) console.log(`  FAIL  ${m}`);
console.log(`\n${ok.length} passaram, ${falhas.length} falharam\n`);
process.exit(falhas.length ? 1 : 0);
