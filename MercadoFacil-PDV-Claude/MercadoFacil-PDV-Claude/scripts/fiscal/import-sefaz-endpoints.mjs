/**
 * Carrega a relação oficial de webservices da SEFAZ (NF-e 55 e NFC-e 65) na
 * tabela fiscal_sefaz_endpoints.
 *
 * Por que por arquivo e não baixando sozinho: o Portal Nacional publica a
 * relação numa página que exige sessão e postback, sem endpoint estável para
 * leitura automática. Copiar a lista para um arquivo e importar é honesto;
 * adivinhar URL de SEFAZ não é — nota enviada para endereço errado se perde e o
 * lojista descobre na fiscalização.
 *
 * Fonte da lista: Portal Nacional da NF-e → Serviços → Webservices
 * (https://www.nfe.fazenda.gov.br/portal/webServices.aspx), coluna
 * "NfeAutorizacao4" de cada UF/ambiente. Para NFC-e, o portal da SEFAZ da UF.
 *
 * Formato do arquivo (JSON ou CSV com cabeçalho):
 *   uf,environment,model,service,url
 *   MG,homologacao,65,autorizacao,https://.../NFeAutorizacao4
 *
 * Uso:
 *   node scripts/fiscal/import-sefaz-endpoints.mjs --file webservices.csv
 *   node scripts/fiscal/import-sefaz-endpoints.mjs --file x.json --dry-run
 *   node scripts/fiscal/import-sefaz-endpoints.mjs --list
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { resolve } from "path";

const UFS = [
  "AC", "AL", "AM", "AP", "BA", "CE", "DF", "ES", "GO", "MA", "MG", "MS", "MT",
  "PA", "PB", "PE", "PI", "PR", "RJ", "RN", "RO", "RR", "RS", "SC", "SE", "SP", "TO",
];

const SERVICOS = ["autorizacao", "retautorizacao", "consulta", "status", "evento", "inutilizacao"];

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

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const listar = args.includes("--list");
const fileArg = args.indexOf("--file") >= 0 ? args[args.indexOf("--file") + 1] : null;

const env = loadEnvLocal();
const admin = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

if (listar) {
  const { data, error } = await admin
    .from("fiscal_sefaz_endpoints")
    .select("uf, environment, model, service, url")
    .order("uf");
  if (error) throw new Error(error.message);
  console.log(
    JSON.stringify(
      {
        carregados: data?.length ?? 0,
        ufs_com_autorizacao: [
          ...new Set((data || []).filter((r) => r.service === "autorizacao").map((r) => r.uf)),
        ],
        linhas: data,
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

if (!fileArg) {
  console.error(
    "Informe o arquivo com a relação oficial: --file webservices.csv\n" +
      "Colunas: uf,environment,model,service,url",
  );
  process.exit(1);
}

const bruto = readFileSync(resolve(process.cwd(), fileArg), "utf8").trim();

const parseCsv = (texto) => {
  const linhas = texto.split(/\r?\n/).filter((l) => l.trim());
  const cabecalho = linhas[0].split(/[;,]/).map((c) => c.trim().toLowerCase());
  return linhas.slice(1).map((linha) => {
    const partes = linha.split(/[;,](?=(?:[^"]*"[^"]*")*[^"]*$)/);
    const obj = {};
    cabecalho.forEach((c, i) => {
      obj[c] = String(partes[i] ?? "").trim().replace(/^"|"$/g, "");
    });
    return obj;
  });
};

const registros = bruto.startsWith("[") ? JSON.parse(bruto) : parseCsv(bruto);

const problemas = [];
const linhas = [];

registros.forEach((r, i) => {
  const uf = String(r.uf || "").toUpperCase().trim();
  const environment = String(r.environment || r.ambiente || "").toLowerCase().trim();
  const model = String(r.model || r.modelo || "").trim();
  const service = String(r.service || r.servico || "autorizacao").toLowerCase().trim();
  const url = String(r.url || "").trim();
  const onde = `linha ${i + 2}`;

  if (!UFS.includes(uf)) problemas.push(`${onde}: UF inválida (${r.uf})`);
  if (!["homologacao", "producao"].includes(environment)) {
    problemas.push(`${onde}: ambiente deve ser homologacao ou producao (${r.environment})`);
  }
  if (!["55", "65"].includes(model)) problemas.push(`${onde}: modelo deve ser 55 ou 65 (${r.model})`);
  if (!SERVICOS.includes(service)) problemas.push(`${onde}: serviço desconhecido (${service})`);

  // Só HTTPS e só domínio de fisco. Endpoint apontando para outro lugar mandaria
  // a nota assinada — com dados do contribuinte — para fora do fisco.
  if (!/^https:\/\//i.test(url)) {
    problemas.push(`${onde}: URL precisa ser https (${url})`);
  } else {
    const host = new URL(url).hostname.toLowerCase();
    if (!/\.(gov\.br|rs\.gov\.br)$/.test(host)) {
      problemas.push(`${onde}: host fora do domínio do fisco (${host})`);
    }
  }

  linhas.push({
    uf,
    environment,
    model,
    service,
    url,
    source: r.source || "Portal Nacional da NF-e — Webservices",
  });
});

if (problemas.length) {
  console.error("Arquivo recusado:\n" + problemas.map((p) => `  - ${p}`).join("\n"));
  process.exit(1);
}

if (dryRun) {
  console.log(JSON.stringify({ dry_run: true, linhas: linhas.length, exemplo: linhas[0] }, null, 2));
  process.exit(0);
}

const { error } = await admin
  .from("fiscal_sefaz_endpoints")
  .upsert(linhas, { onConflict: "uf,environment,model,service" });
if (error) throw new Error(`Falha ao gravar os endpoints: ${error.message}`);

const { count } = await admin
  .from("fiscal_sefaz_endpoints")
  .select("uf", { count: "exact", head: true });

console.log(
  JSON.stringify({ ok: true, gravados: linhas.length, total_na_tabela: count }, null, 2),
);
