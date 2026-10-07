/**
 * Importa a tabela oficial de Classificação Tributária do IBS/CBS (cClassTrib)
 * do IT 2025.002 para o banco.
 *
 * Por que importar em vez de escrever no código: são centenas de códigos, cada
 * um com indicadores que comandam as regras de validação do autorizador, e a
 * lista muda a cada versão do Informe Técnico (a v1.60 criou cinco códigos e
 * encerrou três). Código inventado ou defasado vira rejeição na SEFAZ.
 *
 * Fonte: Portal dos Documentos Fiscais Eletrônicos — SVRS, a mesma página
 * interativa indicada pelo IT 2025.002 (item "Tabelas Online"):
 *   https://dfe-portal.svrs.rs.gov.br/DFE/TabelaClassificacaoTributaria
 * A página traz a tabela completa embutida; o serviço JSON equivalente do SVRS
 * exige certificado digital, por isso a leitura é feita daqui.
 *
 * Uso:
 *   node scripts/fiscal/import-class-trib.mjs            # baixa do portal
 *   node scripts/fiscal/import-class-trib.mjs --file x.html
 *   node scripts/fiscal/import-class-trib.mjs --dry-run  # não grava
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { resolve } from "path";

const PORTAL = "https://dfe-portal.svrs.rs.gov.br/DFE/TabelaClassificacaoTributaria";
const FONTE = "IT 2025.002 — Portal DF-e SVRS";

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
const fileArg = args.indexOf("--file") >= 0 ? args[args.indexOf("--file") + 1] : null;

const html = fileArg
  ? readFileSync(resolve(process.cwd(), fileArg), "utf8")
  : await (async () => {
      const res = await fetch(PORTAL, { redirect: "follow" });
      if (!res.ok) throw new Error(`Portal SVRS respondeu ${res.status}`);
      return await res.text();
    })();

// A página monta a tabela a partir de um literal JavaScript com a tabela
// inteira. Se o portal mudar o nome da variável, é melhor falhar alto do que
// gravar dado pela metade.
const inicio = html.indexOf("var dadosOriginais");
if (inicio < 0) {
  throw new Error(
    "Não encontrei a tabela na página do SVRS. O portal pode ter mudado o formato — confira a fonte antes de importar.",
  );
}
const fim = html.indexOf("\n", inicio);
const literal = html.slice(html.indexOf("[", inicio), fim).trim().replace(/;$/, "");

let csts;
try {
  csts = JSON.parse(literal);
} catch (e) {
  throw new Error(`Tabela do SVRS não pôde ser lida como JSON: ${e.message}`);
}

const soData = (v) => (v ? String(v).slice(0, 10) : null);

const cstRows = csts.map((c) => ({
  code: c.Cst,
  name: c.NomeCst,
  tax: "ibscbs",
  valid_from: soData(c.DthIniVig),
  valid_to: soData(c.DthFimVig),
  source: FONTE,
}));

const classRows = [];
for (const cst of csts) {
  for (const cls of cst.ClassificacoesTributarias || []) {
    classRows.push({
      code: cls.CodClassTrib,
      cst_code: cls.Cst || cst.Cst,
      name: cls.NomeReduzido || cls.NomeClassTrib,
      // Os indicadores viajam inteiros: são eles que dizem em qual documento o
      // código pode ser usado e como a alíquota é tratada. Recortar campo aqui
      // seria decidir hoje o que a validação de amanhã vai exigir.
      indicators: {
        descricao: cls.NomeClassTrib,
        trib_regular: cls.IndTribRegular,
        permite_cred_pres: cls.IndPermiteCredPres,
        perc_red_ibs: cls.PercRedIbs,
        perc_red_cbs: cls.PercRedCbs,
        tipo_aliq: cls.TipoAliq,
        mono_retem: cls.IndMonoRetem,
        mono_ret: cls.IndMonoRet,
        mono_dif: cls.IndMonoDif,
        mono_val: cls.IndMonoVal,
        estorno_cred: cls.IndEstornoCred,
        documentos: {
          nfe: cls.IndNfe,
          nfce: cls.IndNfce,
          nfse: cls.IndNfse,
          cte: cls.IndCte,
          nfcom: cls.IndNfcom,
          nf3e: cls.IndNf3e,
          bpe: cls.IndBpe,
        },
        legislacao: cls.TexUrlLegislacao,
        anexo: cls.NroAnexo,
        publicado_em: soData(cls.DthPublicacao),
      },
      valid_from: soData(cls.DthIniVig),
      valid_to: soData(cls.DthFimVig),
      source: FONTE,
    });
  }
}

if (!classRows.length) {
  throw new Error("A tabela veio sem nenhuma classificação tributária — importação abortada.");
}

const vigentes = classRows.filter((r) => !r.valid_to || new Date(r.valid_to) >= new Date());

if (dryRun) {
  console.log(
    JSON.stringify(
      {
        dry_run: true,
        fonte: fileArg || PORTAL,
        csts: cstRows.length,
        classificacoes: classRows.length,
        vigentes: vigentes.length,
        exemplo: classRows[0],
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

const env = loadEnvLocal();
const admin = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

// CST primeiro: a classificação referencia o CST por chave estrangeira.
const { error: erroCst } = await admin
  .from("fiscal_cst_codes")
  .upsert(cstRows, { onConflict: "code" });
if (erroCst) throw new Error(`Falha ao gravar os CST: ${erroCst.message}`);

const lote = 200;
for (let i = 0; i < classRows.length; i += lote) {
  const { error } = await admin
    .from("fiscal_class_trib_codes")
    .upsert(classRows.slice(i, i + lote), { onConflict: "code" });
  if (error) throw new Error(`Falha ao gravar a classificação tributária: ${error.message}`);
}

const { count } = await admin
  .from("fiscal_class_trib_codes")
  .select("code", { count: "exact", head: true });

console.log(
  JSON.stringify(
    {
      ok: true,
      fonte: fileArg || PORTAL,
      csts_gravados: cstRows.length,
      classificacoes_gravadas: classRows.length,
      vigentes_hoje: vigentes.length,
      total_na_tabela: count,
    },
    null,
    2,
  ),
);
