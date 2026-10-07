// Regra tributária de NFC-e: formulário <-> linha de tax_rules.
//
// Funções puras (sem rede), usadas pela tela Configurações > Fiscal > Tributação
// e testadas sem navegador. O fiscal-emit lê `tax_rules` (da empresa ou
// globais, active) e escolhe a regra por vigência, `match` e especificidade
// (supabase/functions/_shared/fiscal/taxEngine.ts); `tax_rule_sets` só agrupa.
//
// Só oferece o que o montador de XML atual (documents.ts) consegue expressar
// de forma válida: ICMS do Simples/MEI nos CSOSN 102/103/300/400 e PIS/COFINS
// em CST 01/02 (grupo PISAliq/COFINSAliq). IBS/CBS não entra: para CRT 1, 2 e 4
// só começa em 2027 (art. 348 da LC 214/2025).

/** CRT com tributação suportada hoje: 1 e 2 (Simples) e 4 (MEI). */
export const CRTS_SUPORTADOS = ["1", "2", "4"];
export const regimeSuportado = (crt) => CRTS_SUPORTADOS.includes(String(crt));

export const CSOSN_OPCOES = [
  { value: "102", label: "102 — Tributada pelo Simples, sem crédito" },
  { value: "103", label: "103 — Isenção do ICMS (faixa de receita bruta)" },
  { value: "300", label: "300 — Imune" },
  { value: "400", label: "400 — Não tributada pelo Simples" },
];

export const CST_PIS_COFINS_OPCOES = [
  { value: "01", label: "01 — Tributável, alíquota básica" },
  { value: "02", label: "02 — Tributável, alíquota diferenciada" },
];

export const inicioDoAno = (d = new Date()) => `${d.getFullYear()}-01-01`;
export const hojeISO = (d = new Date()) => d.toISOString().slice(0, 10);

export const formVazio = () => ({
  id: null,
  description: "",
  ncm: "", // vazio = vale para todos os produtos
  csosn: "102",
  pisCst: "01",
  pisAliquota: "0",
  cofinsCst: "01",
  cofinsAliquota: "0",
  validFrom: inicioDoAno(),
  validTo: "",
  active: true,
});

const num = (v) => Number(String(v ?? "").trim().replace(",", "."));
const DATA = /^\d{4}-\d{2}-\d{2}$/;

/** Lista de problemas do formulário; vazia = pode salvar. */
export function validarForm(f) {
  const erros = [];
  const ncm = String(f.ncm ?? "").trim();
  if (ncm && !/^\d{2,8}$/.test(ncm)) erros.push("NCM deve ter de 2 a 8 dígitos (prefixo) ou ficar vazio para todos os produtos.");
  if (!CSOSN_OPCOES.some((o) => o.value === f.csosn)) erros.push("Escolha o CSOSN do ICMS.");
  for (const [nome, cst, aliq] of [["PIS", f.pisCst, f.pisAliquota], ["COFINS", f.cofinsCst, f.cofinsAliquota]]) {
    if (!CST_PIS_COFINS_OPCOES.some((o) => o.value === cst)) erros.push(`Escolha o CST do ${nome}.`);
    const n = num(aliq);
    if (!Number.isFinite(n) || n < 0 || n > 100) erros.push(`Alíquota do ${nome} deve estar entre 0 e 100.`);
  }
  if (!DATA.test(String(f.validFrom ?? ""))) erros.push("Informe o início da vigência.");
  if (f.validTo && (!DATA.test(f.validTo) || f.validTo < f.validFrom)) erros.push("O fim da vigência não pode ser anterior ao início.");
  return erros;
}

/** Colunas de tax_rules a partir do formulário (sem rule_set_id / company_id). */
export function montarRegra(f) {
  const ncm = String(f.ncm ?? "").trim();
  return {
    description: String(f.description ?? "").trim() || (ncm ? `NFC-e — NCM ${ncm}` : "NFC-e — todos os produtos"),
    priority: 100, // empate resolve por especificidade: com NCM vence a regra geral
    match: { model: "65", ...(ncm ? { ncm } : {}) },
    taxes: {
      icms: { csosn: f.csosn },
      pis: { cst: f.pisCst, aliquota: num(f.pisAliquota) },
      cofins: { cst: f.cofinsCst, aliquota: num(f.cofinsAliquota) },
    },
    valid_from: f.validFrom,
    valid_to: f.validTo || null,
    active: !!f.active,
  };
}

/** Linha de tax_rules -> formulário de edição. */
export function regraParaForm(r) {
  const t = r.taxes || {};
  return {
    id: r.id,
    description: r.description || "",
    ncm: r.match?.ncm || "",
    csosn: t.icms?.csosn || "102",
    pisCst: t.pis?.cst || "01",
    pisAliquota: String(t.pis?.aliquota ?? 0),
    cofinsCst: t.cofins?.cst || "01",
    cofinsAliquota: String(t.cofins?.aliquota ?? 0),
    validFrom: r.valid_from || inicioDoAno(),
    validTo: r.valid_to || "",
    active: r.active !== false,
  };
}

/** A regra vale hoje para NFC-e de qualquer produto (sem restrição de NCM)? */
export const ehRegraGeralVigente = (r, hoje = hojeISO()) =>
  r.active !== false &&
  !r.match?.ncm &&
  (!r.match?.model || r.match.model === "65") &&
  r.valid_from <= hoje &&
  (!r.valid_to || r.valid_to >= hoje);
