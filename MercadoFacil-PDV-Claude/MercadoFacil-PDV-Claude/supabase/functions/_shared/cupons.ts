// Cupons e bônus promocionais da assinatura — lógica PURA (sem banco, sem rede), testada em
// scripts/smoke-cupons-reajuste.mjs. Só calcula; quem grava é o banco (migration 079: coupons,
// coupon_redemptions e as funções redeem_coupon / consume_coupon_cycle).
//
// Regra de ouro: o cupom é SEPARADO do preço. PLAN_PRICES / ADDON_PRICES (plans.ts) nunca são lidos
// com desconto nem alterados: o desconto é um valor à parte, calculado a cada cobrança, e quando o
// benefício acaba a cobrança volta sozinha ao preço-base.
//
// Ainda NÃO está ligado ao checkout (generate-pix-payment) nem à ativação: ver "Ativar na cobrança real"
// no relatório da etapa. Hoje nenhuma cobrança usa cupom.
import { calcPlanMonthlyTotal, PLAN_PRICES } from "./plans.ts";

export type TipoDesconto = "percent" | "fixed";
/** Sobre o que o desconto incide: o total (plano + adicionais), só o plano ou só os adicionais. */
export type AplicaEm = "total" | "plan" | "addons";

export interface Cupom {
  code: string;
  discountType: TipoDesconto;
  /** percent: 0–100 (100 = grátis). fixed: valor em R$ por ciclo. */
  discountValue: number;
  appliesTo: AplicaEm;
  /** Quantos ciclos de cobrança (30 dias cada) o benefício vale depois de resgatado. */
  cycles: number;
  startsAt: Date | string | null;
  expiresAt: Date | string | null;
  /** null = sem limite. Conta EMPRESAS que resgataram, não ciclos. */
  maxRedemptions: number | null;
  redemptionsCount: number;
  active: boolean;
}

/**
 * Resgate de um cupom por uma empresa. Os TERMOS do benefício (tipo, valor, alvo e ciclos) são copiados
 * na hora do resgate e valem até acabarem os ciclos: desativar, expirar ou editar o cupom depois NÃO muda
 * o que já foi concedido.
 */
export interface Resgate {
  discountType: TipoDesconto;
  discountValue: number;
  appliesTo: AplicaEm;
  cyclesTotal: number;
  cyclesUsed: number;
}

export type MotivoCupom =
  | "ok"
  | "inactive"
  | "not_started"
  | "expired"
  | "exhausted"
  | "cycles_finished"
  | "invalid_coupon";

export interface ValidacaoCupom {
  valido: boolean;
  motivo: MotivoCupom;
}

const dt = (v: Date | string | null | undefined): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const t = v instanceof Date ? v.getTime() : new Date(v).getTime();
  return Number.isFinite(t) ? t : null;
};
export const arredonda = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

/** Termos do desconto bem formados (tipo, valor, alvo) — evita desconto absurdo vindo de dado ruim. */
function termosEstruturados(c: { discountType: string; discountValue: number; appliesTo: string } | null | undefined): boolean {
  if (!c) return false;
  if (c.discountType !== "percent" && c.discountType !== "fixed") return false;
  if (!Number.isFinite(c.discountValue) || c.discountValue < 0) return false;
  if (c.discountType === "percent" && c.discountValue > 100) return false;
  if (!["total", "plan", "addons"].includes(c.appliesTo)) return false;
  return true;
}

/** Cupom bem formado? (termos + ciclos) */
export function cupomEstruturado(c: Cupom | null | undefined): boolean {
  if (!c || !termosEstruturados(c)) return false;
  return Number.isInteger(c.cycles) && c.cycles >= 1;
}

/**
 * Este cupom dá desconto AGORA para esta empresa?
 *  - JÁ resgatado (existe `resgate`): vale até acabarem os ciclos concedidos, e SÓ isso decide. Cupom
 *    desativado (active = false), expirado, esgotado ou editado depois não cancela nem muda o benefício.
 *  - Ainda não resgatado: é um NOVO resgate; precisa estar ativo, dentro de início/expiração e ter vaga
 *    no limite de usos (active = false e expires_at impedem NOVOS resgates).
 */
export function validarCupom(cupom: Cupom | null | undefined, opcoes: { agora: Date | string; resgate?: Resgate | null }): ValidacaoCupom {
  const r = opcoes.resgate ?? null;
  if (r) {
    if (!termosEstruturados(r)) return { valido: false, motivo: "invalid_coupon" };
    if (r.cyclesUsed >= r.cyclesTotal) return { valido: false, motivo: "cycles_finished" };
    return { valido: true, motivo: "ok" };
  }

  if (!cupomEstruturado(cupom)) return { valido: false, motivo: "invalid_coupon" };
  const c = cupom as Cupom;
  if (!c.active) return { valido: false, motivo: "inactive" };

  const agora = dt(opcoes.agora);
  if (agora === null) return { valido: false, motivo: "invalid_coupon" };
  const ini = dt(c.startsAt);
  const fim = dt(c.expiresAt);
  if (ini !== null && agora < ini) return { valido: false, motivo: "not_started" };
  if (fim !== null && agora >= fim) return { valido: false, motivo: "expired" };
  if (c.maxRedemptions !== null && c.redemptionsCount >= c.maxRedemptions) return { valido: false, motivo: "exhausted" };
  return { valido: true, motivo: "ok" };
}

export interface CobrancaCalculada {
  /** Preço-base do plano + adicionais (o MESMO calcPlanMonthlyTotal de sempre; cupom nunca entra aqui). */
  baseTotal: number;
  planoBase: number;
  adicionaisBase: number;
  /** Desconto deste ciclo (0 quando não há cupom válido). */
  desconto: number;
  /** O que cobrar neste ciclo = baseTotal - desconto. */
  total: number;
  cupomAplicado: boolean;
  motivo: MotivoCupom | "sem_cupom";
  /** Qual ciclo do benefício é este (1 = primeiro), ou null sem cupom aplicado. */
  cicloDoBeneficio: number | null;
  /** Ciclos de benefício que sobram DEPOIS desta cobrança ser paga. */
  ciclosRestantesAposPagar: number;
}

/**
 * Quanto cobrar neste ciclo. `resgate` = o que a empresa já resgatou (null = primeiro uso: o benefício
 * começa agora, com os termos do cupom). Com resgate, os TERMOS DO RESGATE mandam (o cupom pode até ter sido
 * desativado, expirado ou editado, ou nem vir). Nunca altera plans.ts nem o cupom recebido.
 */
export function calcularCobranca(entrada: {
  planId: string;
  addonIds?: string[];
  cupom?: Cupom | null;
  resgate?: Resgate | null;
  agora?: Date | string;
}): CobrancaCalculada {
  const addonIds = entrada.addonIds ?? [];
  const baseTotal = calcPlanMonthlyTotal(entrada.planId, addonIds);
  const planoBase = PLAN_PRICES[entrada.planId];
  const adicionaisBase = arredonda(baseTotal - planoBase);
  const semDesconto = (motivo: CobrancaCalculada["motivo"]): CobrancaCalculada => ({
    baseTotal,
    planoBase,
    adicionaisBase,
    desconto: 0,
    total: baseTotal,
    cupomAplicado: false,
    motivo,
    cicloDoBeneficio: null,
    ciclosRestantesAposPagar: 0,
  });

  const resgate = entrada.resgate ?? null;
  if (!entrada.cupom && !resgate) return semDesconto("sem_cupom");
  const v = validarCupom(entrada.cupom, { agora: entrada.agora ?? new Date(), resgate });
  if (!v.valido) return semDesconto(v.motivo);

  // termos do benefício: do resgate (já concedido) ou, no 1º uso, do cupom
  const c = resgate ?? (entrada.cupom as Cupom);
  const elegivel = c.appliesTo === "plan" ? planoBase : c.appliesTo === "addons" ? adicionaisBase : baseTotal;
  const bruto = c.discountType === "percent" ? (elegivel * c.discountValue) / 100 : c.discountValue;
  // nunca desconta mais do que a parte elegível, e o total nunca fica negativo
  const desconto = arredonda(Math.min(Math.max(bruto, 0), elegivel));
  const total = arredonda(baseTotal - desconto);

  const cyclesTotal = resgate ? resgate.cyclesTotal : (entrada.cupom as Cupom).cycles;
  const usados = resgate ? resgate.cyclesUsed : 0;
  return {
    baseTotal,
    planoBase,
    adicionaisBase,
    desconto,
    total,
    cupomAplicado: desconto > 0,
    motivo: "ok",
    cicloDoBeneficio: usados + 1,
    ciclosRestantesAposPagar: Math.max(cyclesTotal - (usados + 1), 0),
  };
}

/** Estado do resgate depois de UM ciclo pago com o benefício (puro; o banco faz o mesmo em consume_coupon_cycle). */
export function consumirCiclo(resgate: Resgate): Resgate {
  return { ...resgate, cyclesUsed: Math.min(resgate.cyclesUsed + 1, resgate.cyclesTotal) };
}

/** Primeiro resgate: copia os termos do cupom (editar/desativar o cupom depois não muda o benefício já concedido). */
export function novoResgate(cupom: Cupom): Resgate {
  return { discountType: cupom.discountType, discountValue: cupom.discountValue, appliesTo: cupom.appliesTo, cyclesTotal: cupom.cycles, cyclesUsed: 0 };
}
