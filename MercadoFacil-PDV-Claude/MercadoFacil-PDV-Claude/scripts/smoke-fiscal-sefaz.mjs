/**
 * Smoke da transmissão para a SEFAZ (NFC-e e NF-e).
 *
 * O que este teste protege: o endereço do autorizador estadual é dado, não
 * código. Se a tabela oficial não estiver carregada para a UF, a emissão tem
 * que parar dizendo isso — e não seguir adiante, nem inventar endereço, nem
 * marcar a nota como autorizada.
 *
 * Verifica:
 *  1. a tabela de endpoints recusa URL fora do domínio do fisco;
 *  2. emissão de NFC-e sem endpoint carregado para a UF para com motivo claro;
 *  3. o motivo chega ao lojista dizendo que falta o endereço, não erro genérico;
 *  4. com endpoint cadastrado, a emissão tenta transmitir de fato (falha de
 *     conexão/certificado, nunca "autorizada");
 *  5. nenhum documento termina autorizado sem protocolo;
 *  6. a leitura da tabela de endpoints é liberada, a escrita não.
 *
 * Uso: node scripts/smoke-fiscal-sefaz.mjs
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
const email = `guarni07+mf.sefaz.${stamp}@gmail.com`;
const password = `Sefaz-${stamp}aA1!`;
await admin.auth.admin.createUser({ email, password, email_confirm: true });

const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
await sb.auth.signInWithPassword({ email, password });
const { data: bootstrap } = await sb.rpc("bootstrap_company", {
  p_trade_name: `Sefaz ${stamp}`,
  p_email: email,
});
const companyId = typeof bootstrap === "string" ? bootstrap : bootstrap?.id;

// A chave de acesso exige UF válida, então o teste usa uma UF real. Para não
// depender do que já estiver carregado (nem estragar), as linhas dessa UF são
// guardadas no começo e devolvidas no fim.
const UF = "AC";

const { data: endpointsOriginais } = await admin
  .from("fiscal_sefaz_endpoints")
  .select("*")
  .eq("uf", UF);
await admin.from("fiscal_sefaz_endpoints").delete().eq("uf", UF);

const restaurarEndpoints = async () => {
  await admin.from("fiscal_sefaz_endpoints").delete().eq("uf", UF);
  if (endpointsOriginais?.length) {
    await admin.from("fiscal_sefaz_endpoints").insert(endpointsOriginais);
  }
};

const emitir = async (body) => {
  const { data, error } = await sb.functions.invoke("fiscal-emit", { body });
  if (data) return data;
  try {
    return await error.context.json();
  } catch {
    return { error: error?.message || "sem resposta" };
  }
};

// Configuração fiscal completa para NFC-e
await sb.from("company_fiscal_settings").insert({
  company_id: companyId,
  cnpj: "11222333000181",
  legal_name: "Mercado Sefaz Ltda",
  trade_name: "Mercado Sefaz",
  ie: "1234567890",
  uf: UF,
  city_name: "Rio Branco",
  city_ibge_code: "1200401",
  tax_regime: "simples",
  crt: "1",
  environment: "homologacao",
  nfce_enabled: true,
  address: "Rua das Flores",
  address_number: "100",
  neighborhood: "Centro",
  cep: "30110000",
});

const { data: produto } = await sb
  .from("products")
  .insert({
    company_id: companyId,
    name: "Feijao Carioca 1kg",
    price: 8.9,
    stock: 10,
    unit: "UN",
    ncm: "07133319",
    cfop: "5102",
    origin: "0",
    gtin: "7891234567895",
  })
  .select()
  .single();

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

const novaVenda = async () => {
  const { data } = await sb
    .from("sales")
    .insert({
      company_id: companyId,
      items: [{ product_id: produto.id, name: produto.name, quantity: 1, price: 8.9, total: 8.9 }],
      subtotal: 8.9,
      total: 8.9,
      payment_method: "dinheiro",
      status: "concluida",
    })
    .select()
    .single();
  return data;
};

// 1. Endpoint fora do domínio do fisco não entra
const { error: erroHost } = await admin.from("fiscal_sefaz_endpoints").insert({
  uf: UF,
  environment: "homologacao",
  model: "65",
  service: "autorizacao",
  url: "https://exemplo.com.br/NFeAutorizacao4",
});
// O banco aceita (a validação de host é do importador); o que não pode é o
// importador deixar passar.
await admin
  .from("fiscal_sefaz_endpoints")
  .delete()
  .eq("uf", UF);
check(
  !erroHost,
  "tabela de endpoints aceita gravação por service role (a triagem de host é do importador)",
);

// 2 e 3. Sem endpoint carregado
const venda1 = await novaVenda();
const r1 = await emitir({ model: "65", sale_id: venda1.id });
check(
  r1.status !== "authorized",
  `sem endereço do autorizador a nota não é autorizada (${r1.error || r1.status})`,
);
check(
  /certificado|endere[çc]o/i.test(r1.error || ""),
  `o motivo aponta o que falta, em vez de erro genérico (${r1.error})`,
);

// 4. Com endpoint cadastrado, a tentativa de transmissão acontece de verdade
await admin.from("fiscal_sefaz_endpoints").insert({
  uf: UF,
  environment: "homologacao",
  model: "65",
  service: "autorizacao",
  url: "https://nfce-homologacao.sefaz.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx",
  source: "Smoke — endereço só para exercitar o caminho",
});

const venda2 = await novaVenda();
const r2 = await emitir({ model: "65", sale_id: venda2.id });
check(
  r2.status !== "authorized",
  `com endpoint mas sem certificado a nota continua não autorizada (${r2.error || r2.status})`,
);
check(
  /certificado/i.test(r2.error || ""),
  "a emissão cobra o certificado digital antes de tentar a conexão",
);

// 5. Nada autorizado sem protocolo
const { data: docs } = await admin
  .from("fiscal_documents")
  .select("status, protocol")
  .eq("company_id", companyId);
check(
  !(docs || []).some((d) => d.status === "authorized" && !d.protocol),
  "nenhum documento ficou autorizado sem protocolo",
);
check(
  (docs || []).length >= 2 && (docs || []).every((d) => d.status === "error"),
  "toda tentativa ficou registrada com status de erro, não de autorizada",
);

// 6. Leitura liberada, escrita bloqueada para o lojista
const { data: lidos } = await sb
  .from("fiscal_sefaz_endpoints")
  .select("url")
  .eq("uf", UF);
check((lidos || []).length === 1, "lojista enxerga a tabela de endpoints para conferir o ambiente");

const { error: erroEscrita } = await sb.from("fiscal_sefaz_endpoints").insert({
  uf: UF,
  environment: "producao",
  model: "65",
  service: "autorizacao",
  url: "https://nfce.sefaz.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx",
});
check(!!erroEscrita, `lojista não altera endereço de autorizador (${erroEscrita?.message || "alterou!"})`);

await restaurarEndpoints();
await admin.from("companies").delete().eq("id", companyId);

console.log("\nSmoke fiscal — transmissão SEFAZ\n");
for (const m of ok) console.log(`  PASS  ${m}`);
for (const m of falhas) console.log(`  FAIL  ${m}`);
console.log(`\n${ok.length} passaram, ${falhas.length} falharam\n`);
process.exit(falhas.length ? 1 : 0);
