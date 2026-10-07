// Validações da configuração de NFC-e (SEFAZ-GO, homologação).
//
// Duas frentes, mesmas regras:
//  - validateFiscalSettingsInput: o que o save-fiscal-settings recusa na hora de
//    gravar (formato de CNPJ, IE, CEP, IBGE, UF, ID CSC, CSC, CRT/regime);
//  - buildNfceChecks: o botão "Testar configuração", que mostra se a emissão
//    tem os dados mínimos para sair (inclusive dados já gravados antes das
//    validações existirem).
//
// Funções puras: o certificado já chega aberto e o CSC só como texto na memória,
// então isto testa sem rede e sem Vault.
//
// O que o teste PROVA: certificado abre com a senha guardada, não está
// vencido, pertence ao CNPJ configurado; CNPJ e IE têm dígito verificador
// válido; ID CSC e CSC têm formato aceitável; há regra tributária vigente e os
// dados mínimos de endereço e dos produtos. O que ele NÃO prova: que a SEFAZ
// reconhece o CSC — isso só acontece na primeira transmissão (o hash do QR
// Code é conferido lá). Os textos dos itens dizem isso, sem fingir.

import { isValidCnpj } from "./validation.ts";

export type Status = "configurado" | "pendente" | "erro";
export type Item = { id: string; label: string; status: Status; detail: string };
export type Issue = { field: string; message: string };

const digits = (v?: unknown) => String(v ?? "").replace(/\D/g, "");
const vazio = (v: unknown) => v === null || v === undefined || String(v).trim() === "";

/** Código IBGE da UF (2 primeiros dígitos do código do município). */
export const UF_IBGE: Record<string, string> = {
  AC: "12", AL: "27", AP: "16", AM: "13", BA: "29", CE: "23", DF: "53",
  ES: "32", GO: "52", MA: "21", MT: "51", MS: "50", MG: "31", PA: "15",
  PB: "25", PR: "41", PE: "26", PI: "22", RJ: "33", RN: "24", RS: "43",
  RO: "11", RR: "14", SC: "42", SP: "35", SE: "28", TO: "17",
};

/** IE de Goiás: 9 dígitos, prefixo 10/11/20–29, DV módulo 11 (pesos 9..2). */
export function validateIeGo(value?: string | null): { ok: boolean; reason?: string } {
  const ie = digits(value);
  if (ie.length !== 9) return { ok: false, reason: "a IE de Goiás tem 9 dígitos" };
  const prefix = ie.slice(0, 2);
  if (!(prefix === "10" || prefix === "11" || (Number(prefix) >= 20 && Number(prefix) <= 29))) {
    return { ok: false, reason: "prefixo inválido para Goiás (10, 11 ou 20–29)" };
  }
  let soma = 0;
  for (let i = 0; i < 8; i++) soma += Number(ie[i]) * (9 - i);
  const resto = soma % 11;
  const base = Number(ie.slice(0, 8));
  let dv: number;
  if (resto === 0) dv = 0;
  else if (resto === 1) dv = base >= 10103105 && base <= 10119997 ? 1 : 0;
  else dv = 11 - resto;
  return dv === Number(ie[8]) ? { ok: true } : { ok: false, reason: "dígito verificador não confere" };
}

/** IE de qualquer UF: GO com dígito verificador; as demais, só formato (2 a 14 dígitos). */
export function validateIe(value: unknown, uf?: unknown): { ok: boolean; reason?: string } {
  if (String(uf ?? "").toUpperCase() === "GO") return validateIeGo(String(value ?? ""));
  const d = digits(value);
  return d.length >= 2 && d.length <= 14 ? { ok: true } : { ok: false, reason: "a IE deve ter de 2 a 14 dígitos" };
}

/** ID do CSC (idToken): numérico, até 6 dígitos, diferente de zero. */
export const validateIdCsc = (value?: string | null) => {
  const v = String(value ?? "").trim();
  return /^\d{1,6}$/.test(v) && Number(v) > 0;
};

/** CSC: alfanumérico (aceita hífen), 16 a 36 caracteres. */
export const validateCscFormat = (value?: string | null) =>
  /^[A-Za-z0-9-]{16,36}$/.test(String(value ?? "").trim());

/** CEP: 8 dígitos (aceita máscara 00000-000). */
export const validateCep = (value?: unknown) => /^\d{8}$/.test(digits(value)) && !/^0{8}$/.test(digits(value));

/** Código IBGE do município: 7 dígitos; os 2 primeiros precisam ser os da UF, quando ela é conhecida. */
export function validateIbge(value: unknown, uf?: unknown): { ok: boolean; reason?: string } {
  const d = String(value ?? "").trim();
  if (!/^\d{7}$/.test(d)) return { ok: false, reason: "o código IBGE do município tem 7 dígitos" };
  const esperado = UF_IBGE[String(uf ?? "").toUpperCase()];
  if (esperado && !d.startsWith(esperado)) {
    return { ok: false, reason: `o código IBGE não pertence à UF ${String(uf).toUpperCase()} (deveria começar com ${esperado})` };
  }
  return { ok: true };
}

const CRT_POR_REGIME: Record<string, string[]> = { mei: ["4"], simples: ["1", "2"], presumido: ["3"], real: ["3"] };
export const crtCombinaComRegime = (regime: unknown, crt: unknown) => {
  const aceitos = CRT_POR_REGIME[String(regime ?? "")];
  return !aceitos || aceitos.includes(String(crt ?? ""));
};

/**
 * Valida o que o lojista está gravando. `tocados` = campos que vieram no corpo
 * (só eles são conferidos); `efetivo` = configuração já com o corpo aplicado,
 * para as regras que cruzam campos (IE e IBGE dependem da UF).
 */
export function validateFiscalSettingsInput(
  tocados: Record<string, unknown>,
  efetivo: Record<string, unknown>,
): Issue[] {
  const issues: Issue[] = [];
  const toca = (...campos: string[]) => campos.some((c) => c in tocados);

  if (toca("cnpj") && !vazio(efetivo.cnpj) && !isValidCnpj(String(efetivo.cnpj))) {
    issues.push({ field: "cnpj", message: "CNPJ inválido (os dígitos verificadores não conferem)" });
  }

  if (toca("uf") && !vazio(efetivo.uf) && !UF_IBGE[String(efetivo.uf)]) {
    issues.push({ field: "uf", message: "UF inválida (use a sigla com duas letras maiúsculas, ex.: GO)" });
  }

  if (toca("ie", "uf", "ie_isento") && !efetivo.ie_isento && !vazio(efetivo.ie)) {
    const ie = validateIe(efetivo.ie, efetivo.uf);
    if (!ie.ok) issues.push({ field: "ie", message: `Inscrição estadual inválida: ${ie.reason}` });
  }

  if (toca("cep") && !vazio(efetivo.cep) && !validateCep(efetivo.cep)) {
    issues.push({ field: "cep", message: "CEP inválido (8 dígitos)" });
  }

  if (toca("city_ibge_code", "uf") && !vazio(efetivo.city_ibge_code)) {
    const ibge = validateIbge(efetivo.city_ibge_code, efetivo.uf);
    if (!ibge.ok) issues.push({ field: "city_ibge_code", message: `Código IBGE inválido: ${ibge.reason}` });
  }

  if (toca("cnae_main") && !vazio(efetivo.cnae_main) && !/^\d{7}$/.test(digits(efetivo.cnae_main))) {
    issues.push({ field: "cnae_main", message: "CNAE principal deve ter 7 dígitos" });
  }

  if (toca("tax_regime", "crt") && !vazio(efetivo.crt) && !vazio(efetivo.tax_regime)) {
    if (!["1", "2", "3", "4"].includes(String(efetivo.crt))) {
      issues.push({ field: "crt", message: "CRT inválido (use 1, 2, 3 ou 4)" });
    } else if (!crtCombinaComRegime(efetivo.tax_regime, efetivo.crt)) {
      issues.push({ field: "crt", message: `CRT ${efetivo.crt} não combina com o regime ${efetivo.tax_regime}` });
    }
  }

  for (const amb of ["homologacao", "producao"]) {
    const campoId = `csc_id_${amb}`;
    const campoCsc = `csc_${amb}`;
    if (toca(campoId) && !vazio(efetivo[campoId]) && !validateIdCsc(String(efetivo[campoId]))) {
      issues.push({ field: campoId, message: `ID CSC (${amb}) deve ser numérico, de 1 a 6 dígitos` });
    }
    // O CSC em si só vem no corpo quando o lojista digitou um novo.
    if (toca(campoCsc) && !vazio(tocados[campoCsc]) && !validateCscFormat(String(tocados[campoCsc]))) {
      issues.push({ field: campoCsc, message: `CSC (${amb}) com formato inválido (16 a 36 caracteres alfanuméricos)` });
    }
  }

  return issues;
}

export type CertState =
  | { state: "absent" }
  | { state: "unreadable"; message: string }
  | { state: "ok"; validTo: Date; cnpj: string | null };

export type RegraLite = {
  active?: boolean | null;
  valid_from: string;
  valid_to?: string | null;
  match?: Record<string, unknown> | null;
  taxes?: { icms?: { csosn?: string | null; cst?: string | null } } | null;
};

export type ResumoProdutos = { total: number; incompletos: number; exemplos: string[]; amostra: boolean };

export type NfceCheckInput = {
  settings: {
    cnpj?: string | null;
    legal_name?: string | null;
    ie?: string | null;
    ie_isento?: boolean;
    uf?: string | null;
    crt?: string | null;
    tax_regime?: string | null;
    environment?: string | null;
    nfce_enabled?: boolean | null;
    nfce_series?: number | null;
    csc_id_homologacao?: string | null;
    address?: string | null;
    address_number?: string | null;
    neighborhood?: string | null;
    cep?: string | null;
    city_name?: string | null;
    city_ibge_code?: string | null;
  } | null;
  cert: CertState;
  cscHomologacao: string | null;
  hasEndpoint: boolean;
  nextNumber: number;
  /** Regras tributárias da empresa e globais (já filtradas por empresa pelo chamador). */
  regras?: RegraLite[];
  /** Resumo dos dados fiscais dos produtos; ausente = não verificado. */
  produtos?: ResumoProdutos | null;
  now?: Date;
};

const CHAVES_GERAIS = ["model", "uf", "crt", "tax_regime"];

/**
 * Há regra que cobre qualquer produto de NFC-e hoje? Mesma lógica de seleção do
 * taxEngine (vigência, ativa, `match`), só que sem item: regra geral = sem
 * restrição de NCM/CEST/CFOP/produto, e com ICMS definido (sem ele o XML não
 * monta o grupo ICMS).
 */
export function resumirRegras(regras: RegraLite[], settings: NonNullable<NfceCheckInput["settings"]>, hoje: string) {
  const vigentes = regras.filter((r) => {
    if (r.active === false) return false;
    if (r.valid_from > hoje) return false;
    if (r.valid_to && r.valid_to < hoje) return false;
    const m = r.match || {};
    if (m.model && m.model !== "65") return false;
    if (m.uf && m.uf !== settings.uf) return false;
    if (m.crt && String(m.crt) !== String(settings.crt)) return false;
    if (m.tax_regime && m.tax_regime !== settings.tax_regime) return false;
    return true;
  });
  const temIcms = (r: RegraLite) => !!(r.taxes?.icms?.csosn || r.taxes?.icms?.cst);
  const gerais = vigentes.filter((r) => Object.keys(r.match || {}).every((k) => CHAVES_GERAIS.includes(k)) && temIcms(r));
  return { vigentes: vigentes.length, gerais: gerais.length };
}

const piorStatus = (items: Item[]): Status =>
  items.some((i) => i.status === "erro")
    ? "erro"
    : items.some((i) => i.status === "pendente")
    ? "pendente"
    : "configurado";

export function buildNfceChecks(input: NfceCheckInput): { status: Status; items: Item[] } {
  const { settings, cert } = input;
  const now = input.now ?? new Date();
  const items: Item[] = [];
  const add = (id: string, label: string, status: Status, detail: string) =>
    items.push({ id, label, status, detail });

  if (!settings) {
    add("settings", "Dados fiscais da empresa", "pendente", "Configuração fiscal ainda não preenchida");
    return { status: "pendente", items };
  }

  const homologacao = settings.environment === "homologacao";
  add(
    "ambiente",
    "Ambiente",
    homologacao ? "configurado" : "erro",
    homologacao
      ? "Homologação — os testes não têm valor fiscal"
      : "Esta etapa só valida homologação. Volte o ambiente para Homologação para testar.",
  );

  add(
    "nfce_habilitada",
    "NFC-e habilitada",
    settings.nfce_enabled ? "configurado" : "erro",
    settings.nfce_enabled ? "Emissão de NFC-e ligada em Documentos e ambiente" : "Ligue NFC-e em Documentos e ambiente: sem isso a emissão é recusada",
  );

  const cnpjOk = isValidCnpj(settings.cnpj);
  add(
    "cnpj",
    "CNPJ do emitente",
    cnpjOk ? "configurado" : "erro",
    cnpjOk ? "CNPJ válido (dígitos verificadores conferem)" : "CNPJ inválido ou não preenchido",
  );

  const razao = String(settings.legal_name ?? "").trim();
  add("razao_social", "Razão social", razao ? "configurado" : "erro", razao ? razao : "Razão social não preenchida (vai no XML como xNome)");

  const uf = String(settings.uf ?? "").toUpperCase();
  add(
    "uf",
    "UF / autorizador",
    uf === "GO" ? "configurado" : "erro",
    uf === "GO" ? "SEFAZ-GO" : `UF ${uf || "não preenchida"} — esta configuração é para SEFAZ-GO`,
  );

  if (settings.ie_isento) {
    add("ie", "Inscrição estadual", "erro", "NFC-e exige contribuinte de ICMS com IE — empresa marcada como isenta");
  } else if (!settings.ie) {
    add("ie", "Inscrição estadual", "erro", "IE não preenchida");
  } else {
    const ie = validateIeGo(settings.ie);
    add("ie", "Inscrição estadual", ie.ok ? "configurado" : "erro", ie.ok ? "IE de Goiás válida" : `IE inválida: ${ie.reason}`);
  }

  const regimeOk = !!(settings.crt && settings.tax_regime);
  if (!regimeOk) {
    add("regime", "Regime tributário", "erro", "Regime ou CRT não definido");
  } else if (!crtCombinaComRegime(settings.tax_regime, settings.crt)) {
    add("regime", "Regime tributário", "erro", `CRT ${settings.crt} não combina com o regime ${settings.tax_regime}`);
  } else if (!["1", "2", "4"].includes(String(settings.crt))) {
    add("regime", "Regime tributário", "erro", `CRT ${settings.crt} (${settings.tax_regime}): a emissão de NFC-e ainda só monta o ICMS do Simples Nacional e do MEI`);
  } else {
    add("regime", "Regime tributário", "configurado", `CRT ${settings.crt} (${settings.tax_regime})`);
  }

  const faltaEndereco = [
    ["logradouro", settings.address],
    ["número", settings.address_number],
    ["bairro", settings.neighborhood],
  ].filter(([, v]) => vazio(v)).map(([n]) => n);
  add(
    "endereco",
    "Endereço do estabelecimento",
    faltaEndereco.length ? "erro" : "configurado",
    faltaEndereco.length ? `Falta: ${faltaEndereco.join(", ")}` : "Logradouro, número e bairro preenchidos",
  );

  add(
    "cep",
    "CEP",
    validateCep(settings.cep) ? "configurado" : "erro",
    validateCep(settings.cep) ? "CEP válido" : vazio(settings.cep) ? "CEP não preenchido" : "CEP inválido (8 dígitos)",
  );

  const ibge = validateIbge(settings.city_ibge_code, settings.uf);
  const municipioOk = !vazio(settings.city_name) && ibge.ok;
  add(
    "municipio",
    "Município e código IBGE",
    municipioOk ? "configurado" : "erro",
    municipioOk
      ? `${settings.city_name} (${settings.city_ibge_code})`
      : vazio(settings.city_name)
      ? "Nome do município não preenchido"
      : vazio(settings.city_ibge_code)
      ? "Código IBGE do município não preenchido"
      : `Código IBGE inválido: ${ibge.reason}`,
  );

  // Certificado: perguntas distintas, para o lojista saber exatamente o que falhou.
  if (cert.state === "absent") {
    add("certificado", "Certificado digital A1", "pendente", "Certificado ou senha não cadastrados");
  } else if (cert.state === "unreadable") {
    add("certificado", "Certificado digital A1", "erro", cert.message);
  } else {
    add("certificado", "Certificado digital A1", "configurado", "Abre com a senha cadastrada");

    const dias = Math.floor((cert.validTo.getTime() - now.getTime()) / 86_400_000);
    const vencimento = cert.validTo.toLocaleDateString("pt-BR");
    add(
      "validade",
      "Validade do certificado",
      dias < 0 ? "erro" : dias <= 30 ? "pendente" : "configurado",
      dias < 0
        ? `Vencido em ${vencimento}`
        : dias <= 30
        ? `Vence em ${dias} dia(s), em ${vencimento} — renove em breve`
        : `Válido até ${vencimento}`,
    );

    const cnpjConfig = digits(settings.cnpj);
    add(
      "certificado_cnpj",
      "Certificado × CNPJ",
      !cert.cnpj ? "pendente" : cert.cnpj === cnpjConfig ? "configurado" : "erro",
      !cert.cnpj
        ? "Não foi possível ler o CNPJ do certificado — a conferência fica para a emissão"
        : cert.cnpj === cnpjConfig
        ? "O certificado pertence ao CNPJ configurado"
        : "O certificado pertence a outro CNPJ",
    );
  }

  const idOk = validateIdCsc(settings.csc_id_homologacao);
  add(
    "csc_id",
    "ID do CSC (homologação)",
    !settings.csc_id_homologacao ? "pendente" : idOk ? "configurado" : "erro",
    !settings.csc_id_homologacao
      ? "ID CSC não preenchido"
      : idOk
      ? "Formato válido"
      : "ID CSC deve ter de 1 a 6 dígitos numéricos",
  );

  const cscOk = validateCscFormat(input.cscHomologacao);
  add(
    "csc",
    "CSC (homologação)",
    !input.cscHomologacao ? "pendente" : cscOk ? "configurado" : "erro",
    !input.cscHomologacao
      ? "CSC não cadastrado"
      : cscOk
      ? "Cadastrado e com formato válido. A SEFAZ só confirma o CSC na primeira transmissão."
      : "CSC com formato inválido (16 a 36 caracteres alfanuméricos)",
  );

  add(
    "endpoint",
    "Autorizador SEFAZ-GO (NFC-e, homologação)",
    input.hasEndpoint ? "configurado" : "pendente",
    input.hasEndpoint
      ? "Endereço do serviço de autorização cadastrado"
      : "Endereço do serviço de autorização não carregado",
  );

  if (input.regras) {
    const hoje = now.toISOString().slice(0, 10);
    const r = resumirRegras(input.regras, settings, hoje);
    add(
      "regras_tributarias",
      "Regras tributárias vigentes",
      r.gerais ? "configurado" : r.vigentes ? "pendente" : "erro",
      r.gerais
        ? `${r.gerais} regra(s) vigente(s) para todos os produtos`
        : r.vigentes
        ? "Só há regras por NCM: produtos fora desses NCMs ficarão sem tributação. Crie uma regra para todos os produtos."
        : "Nenhuma regra tributária vigente — sem ela a emissão para. Cadastre em Configurações > Fiscal > Tributação.",
    );
  }

  if (input.produtos) {
    const p = input.produtos;
    add(
      "produtos",
      "Dados fiscais dos produtos",
      p.total === 0 ? "pendente" : p.incompletos ? "pendente" : "configurado",
      p.total === 0
        ? "Nenhum produto cadastrado"
        : p.incompletos
        ? `${p.incompletos} de ${p.total}${p.amostra ? "+" : ""} produto(s) sem NCM (8 dígitos), CFOP, unidade ou origem — ex.: ${p.exemplos.join(", ")}. Esses itens não emitem NFC-e.`
        : `${p.total}${p.amostra ? "+" : ""} produto(s) com NCM, CFOP, unidade e origem`,
    );
  }

  add(
    "numeracao",
    "Série e próximo número",
    "configurado",
    `Série ${settings.nfce_series ?? 1}, próximo número ${input.nextNumber}`,
  );

  return { status: piorStatus(items), items };
}
