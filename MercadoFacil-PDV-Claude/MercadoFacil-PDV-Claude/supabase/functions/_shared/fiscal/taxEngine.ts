// Motor tributário.
//
// Recebe as regras vigentes (tabela tax_rules) e devolve os grupos de imposto
// no vocabulário do leiaute oficial. Não existe alíquota padrão aqui: item sem
// regra vigente volta como erro de validação, porque chutar tributo produz nota
// rejeitada ou, pior, autorizada com imposto errado.
//
// Referências: NT 2025.002-RTC (grupo UB — det/imposto/IBSCBS e totais W03),
// IT 2025.002 (tabelas CST e cClassTrib), LC 214/2025.

export type TaxRule = {
  id: string;
  company_id: string | null;
  priority: number;
  match: Record<string, unknown>;
  taxes: Record<string, any>;
  valid_from: string;
  valid_to: string | null;
  active: boolean;
  description?: string | null;
};

export type FiscalItem = {
  product_id?: string | null;
  service_id?: string | null;
  name: string;
  quantity: number;
  unit?: string | null;
  price: number;
  total: number;
  discount?: number;
  ncm?: string | null;
  cest?: string | null;
  cfop?: string | null;
  origin?: string | null;
  gtin?: string | null;
  service_national_code?: string | null;
  lc116_item?: string | null;
};

export type FiscalContext = {
  model: "55" | "65" | "nfse";
  uf: string;
  city_ibge_code?: string | null;
  crt: string;
  tax_regime: string;
  issued_at: Date;
};

const round = (value: number, decimals = 2) => {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
};

const toNumber = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const withinValidity = (rule: TaxRule, when: Date) => {
  const day = when.toISOString().slice(0, 10);
  if (rule.valid_from && day < rule.valid_from) return false;
  if (rule.valid_to && day > rule.valid_to) return false;
  return true;
};

// Um campo ausente no match não restringe. Presente, precisa bater.
// ncm aceita prefixo ("2201" pega 22011000), que é como a legislação costuma
// tratar capítulo e posição.
const matchesItem = (rule: TaxRule, item: FiscalItem, ctx: FiscalContext) => {
  const m = rule.match || {};

  if (m.product_id && m.product_id !== item.product_id) return false;
  if (m.service_id && m.service_id !== item.service_id) return false;
  if (m.model && m.model !== ctx.model) return false;
  if (m.uf && m.uf !== ctx.uf) return false;
  if (m.crt && String(m.crt) !== String(ctx.crt)) return false;
  if (m.tax_regime && m.tax_regime !== ctx.tax_regime) return false;
  if (m.cfop && m.cfop !== item.cfop) return false;
  if (m.cest && m.cest !== item.cest) return false;

  if (m.ncm) {
    const prefix = String(m.ncm);
    if (!item.ncm || !String(item.ncm).startsWith(prefix)) return false;
  }

  if (Array.isArray(m.ncm_in)) {
    const list = m.ncm_in as string[];
    if (!item.ncm || !list.some((p) => String(item.ncm).startsWith(String(p)))) return false;
  }

  return true;
};

// Quanto mais campos a regra exige, mais específica ela é. Empate resolve pela
// prioridade declarada e, por último, regra da própria loja vence a regra base.
const specificity = (rule: TaxRule) => Object.keys(rule.match || {}).length;

export const selectRule = (
  rules: TaxRule[],
  item: FiscalItem,
  ctx: FiscalContext,
): TaxRule | null => {
  const candidates = rules
    .filter((r) => r.active !== false)
    .filter((r) => withinValidity(r, ctx.issued_at))
    .filter((r) => matchesItem(r, item, ctx));

  if (!candidates.length) return null;

  candidates.sort((a, b) => {
    if (!!b.company_id !== !!a.company_id) return b.company_id ? 1 : -1;
    if (a.priority !== b.priority) return a.priority - b.priority;
    return specificity(b) - specificity(a);
  });

  return candidates[0];
};

// Alíquota efetiva depois da redução, conforme pAliqEfet do leiaute
// (UB28 / UB47 / UB66).
const effectiveRate = (rate: number, reduction: number) =>
  round(rate * (1 - reduction / 100), 4);

export type IbsCbsGroup = {
  CST: string;
  cClassTrib: string;
  gIBSCBS: {
    vBC: number;
    gIBSUF: { pIBSUF: number; pRedAliq: number; pAliqEfet: number; vIBSUF: number };
    gIBSMun: { pIBSMun: number; pRedAliq: number; pAliqEfet: number; vIBSMun: number };
    vIBS: number;
    gCBS: { pCBS: number; pRedAliq: number; pAliqEfet: number; vCBS: number };
  };
};

export type ItemTaxes = {
  icms?: Record<string, unknown>;
  pis?: Record<string, unknown>;
  cofins?: Record<string, unknown>;
  iss?: Record<string, unknown>;
  ibscbs?: IbsCbsGroup;
  rule_id: string;
  rule_description?: string | null;
};

export type TaxError = { item: string; field: string; message: string };

export const computeItemTaxes = (
  rule: TaxRule,
  item: FiscalItem,
  _ctx: FiscalContext,
): { taxes: ItemTaxes; errors: TaxError[] } => {
  const errors: TaxError[] = [];
  const t = rule.taxes || {};
  const base = round(item.total ?? 0);

  const taxes: ItemTaxes = { rule_id: rule.id, rule_description: rule.description };

  if (t.icms) {
    const rate = toNumber(t.icms.aliquota);
    taxes.icms = {
      cst: t.icms.cst ?? null,
      csosn: t.icms.csosn ?? null,
      origem: item.origin ?? t.icms.origem ?? null,
      vBC: t.icms.csosn ? 0 : base,
      pICMS: rate ?? 0,
      vICMS: t.icms.csosn ? 0 : round(base * ((rate ?? 0) / 100)),
    };
  }

  for (const key of ["pis", "cofins"] as const) {
    if (!t[key]) continue;
    const rate = toNumber(t[key].aliquota);
    taxes[key] = {
      cst: t[key].cst ?? null,
      vBC: base,
      aliquota: rate ?? 0,
      valor: round(base * ((rate ?? 0) / 100)),
    };
  }

  if (t.iss) {
    const rate = toNumber(t.iss.aliquota);
    if (rate === null) {
      errors.push({ item: item.name, field: "iss.aliquota", message: "Alíquota de ISS não definida na regra vigente" });
    }
    taxes.iss = {
      vBC: base,
      aliquota: rate ?? 0,
      valor: round(base * ((rate ?? 0) / 100)),
      retido: !!t.iss.retido,
      exigibilidade: t.iss.exigibilidade ?? null,
    };
  }

  // IBS/CBS. A base é única para os dois (vBC, UB16) e o IBS se divide em
  // parcela estadual e municipal, somadas em vIBS (UB54a).
  if (t.ibs || t.cbs) {
    const cst = t.ibs?.cst ?? t.cbs?.cst ?? null;
    const classTrib = t.ibs?.cClassTrib ?? t.cbs?.cClassTrib ?? null;

    if (!cst) {
      errors.push({ item: item.name, field: "ibscbs.CST", message: "CST do IBS/CBS não definido na regra vigente" });
    }
    if (!classTrib) {
      errors.push({ item: item.name, field: "ibscbs.cClassTrib", message: "cClassTrib não definido na regra vigente" });
    }

    const pIBSUF = toNumber(t.ibs?.pIBSUF) ?? 0;
    const pIBSMun = toNumber(t.ibs?.pIBSMun) ?? 0;
    const pCBS = toNumber(t.cbs?.pCBS) ?? 0;
    const redIBSUF = toNumber(t.ibs?.pRedAliq) ?? 0;
    const redIBSMun = toNumber(t.ibs?.pRedAliqMun) ?? toNumber(t.ibs?.pRedAliq) ?? 0;
    const redCBS = toNumber(t.cbs?.pRedAliq) ?? 0;

    const aliqUF = effectiveRate(pIBSUF, redIBSUF);
    const aliqMun = effectiveRate(pIBSMun, redIBSMun);
    const aliqCBS = effectiveRate(pCBS, redCBS);

    const vIBSUF = round(base * (aliqUF / 100));
    const vIBSMun = round(base * (aliqMun / 100));

    taxes.ibscbs = {
      CST: String(cst ?? ""),
      cClassTrib: String(classTrib ?? ""),
      gIBSCBS: {
        vBC: base,
        gIBSUF: { pIBSUF, pRedAliq: redIBSUF, pAliqEfet: aliqUF, vIBSUF },
        gIBSMun: { pIBSMun, pRedAliq: redIBSMun, pAliqEfet: aliqMun, vIBSMun },
        vIBS: round(vIBSUF + vIBSMun),
        gCBS: {
          pCBS,
          pRedAliq: redCBS,
          pAliqEfet: aliqCBS,
          vCBS: round(base * (aliqCBS / 100)),
        },
      },
    };
  }

  return { taxes, errors };
};

export type TaxedItem = FiscalItem & { taxes: ItemTaxes };

export type EngineResult = {
  items: TaxedItem[];
  totals: Record<string, number>;
  errors: TaxError[];
};

export const applyTaxRules = (
  rules: TaxRule[],
  items: FiscalItem[],
  ctx: FiscalContext,
): EngineResult => {
  const errors: TaxError[] = [];
  const taxed: TaxedItem[] = [];

  for (const item of items) {
    const rule = selectRule(rules, item, ctx);
    if (!rule) {
      errors.push({
        item: item.name,
        field: "tax_rule",
        message:
          `Nenhuma regra tributária vigente para este item em ${ctx.issued_at.toISOString().slice(0, 10)}` +
          (item.ncm ? ` (NCM ${item.ncm})` : " (produto sem NCM)"),
      });
      continue;
    }
    const { taxes, errors: itemErrors } = computeItemTaxes(rule, item, ctx);
    errors.push(...itemErrors);
    taxed.push({ ...item, taxes });
  }

  // Totais W03: IBSCBSTot com vIBSUF, vIBSMun, vIBS e vCBS.
  const totals = taxed.reduce(
    (acc, item) => {
      const g = item.taxes.ibscbs?.gIBSCBS;
      acc.vProd = round(acc.vProd + (item.total ?? 0));
      if (g) {
        acc.vBCIBSCBS = round(acc.vBCIBSCBS + g.vBC);
        acc.vIBSUF = round(acc.vIBSUF + g.gIBSUF.vIBSUF);
        acc.vIBSMun = round(acc.vIBSMun + g.gIBSMun.vIBSMun);
        acc.vIBS = round(acc.vIBS + g.vIBS);
        acc.vCBS = round(acc.vCBS + g.gCBS.vCBS);
      }
      const iss = item.taxes.iss as { valor?: number } | undefined;
      if (iss?.valor) acc.vISS = round(acc.vISS + iss.valor);
      return acc;
    },
    { vProd: 0, vBCIBSCBS: 0, vIBSUF: 0, vIBSMun: 0, vIBS: 0, vCBS: 0, vISS: 0 },
  );

  return { items: taxed, totals, errors };
};
