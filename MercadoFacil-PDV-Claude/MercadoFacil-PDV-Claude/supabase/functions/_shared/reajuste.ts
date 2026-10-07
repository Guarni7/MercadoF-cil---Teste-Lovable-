// Reajuste anual das assinaturas — só ESTRUTURA e cálculo puro (sem banco, sem rede, sem efeito).
// Testado em scripts/smoke-cupons-reajuste.mjs. O histórico fica na tabela price_adjustments
// (migration 079).
//
// Regra comercial: o preço atual continua exatamente igual. Nada aqui altera PLAN_PRICES/ADDON_PRICES
// (plans.ts) nem dispara reajuste sozinho: não existe job nem rotina que chame isto. Reajustar no
// futuro = (1) simular, (2) registrar em price_adjustments, (3) mudar o preço em plans.js/plans.ts na mão.
import { arredonda } from "./cupons.ts";

/** Período mínimo antes do primeiro reajuste. */
export const MESES_MINIMOS_REAJUSTE = 12;
/** Índice previsto inicialmente. */
export const INDICE_PADRAO = "IPCA";

export type TipoItem = "plan" | "addon";

export interface RegistroReajuste {
  item_type: TipoItem;
  /** Id como em src/lib/plans.js: "mei", "simples", "tef_sitef"... */
  item_id: string;
  index_name: string;
  percent_applied: number;
  /** Data-base do índice (início do período acumulado), AAAA-MM-DD. */
  base_date: string;
  applied_at: string;
  previous_price: number;
  new_price: number;
  note: string | null;
}

const ms = (v: Date | string | null | undefined): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const t = v instanceof Date ? v.getTime() : new Date(v).getTime();
  return Number.isFinite(t) ? t : null;
};

/**
 * A assinatura já completou o período mínimo (12 meses) desde a PRIMEIRA ativação paga?
 * Só informa; reajustar continua sendo uma decisão manual.
 */
export function completouPeriodoMinimo(primeiraAtivacao: Date | string | null | undefined, agora: Date | string, meses: number = MESES_MINIMOS_REAJUSTE): boolean {
  const ini = ms(primeiraAtivacao);
  const fim = ms(agora);
  if (ini === null || fim === null) return false;
  const limite = new Date(ini);
  limite.setUTCMonth(limite.getUTCMonth() + meses);
  return fim >= limite.getTime();
}

/** Simula (NÃO aplica): preço anterior, percentual e novo preço arredondado a centavos. */
export function simularReajuste(precoAtual: number, percentual: number): { precoAnterior: number; percentual: number; novoPreco: number } {
  if (!Number.isFinite(precoAtual) || precoAtual <= 0) throw new Error("preço atual inválido");
  if (!Number.isFinite(percentual) || percentual < -100) throw new Error("percentual inválido");
  return { precoAnterior: arredonda(precoAtual), percentual, novoPreco: arredonda(precoAtual * (1 + percentual / 100)) };
}

/**
 * Monta a linha do histórico (price_adjustments) validando que preço anterior, percentual e novo preço
 * batem. Só devolve o objeto: gravar é com quem chamar (service role), e NÃO muda nenhum preço.
 */
export function montarRegistroReajuste(e: {
  itemType: TipoItem;
  itemId: string;
  indice?: string;
  percentual: number;
  dataBase: string;
  aplicadoEm: Date | string;
  precoAnterior: number;
  novoPreco: number;
  observacao?: string | null;
}): RegistroReajuste {
  if (e.itemType !== "plan" && e.itemType !== "addon") throw new Error("item_type inválido");
  if (!e.itemId || !e.itemId.trim()) throw new Error("item_id obrigatório");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(e.dataBase)) throw new Error("data-base deve ser AAAA-MM-DD");
  const aplicado = ms(e.aplicadoEm);
  if (aplicado === null) throw new Error("data de aplicação inválida");
  const esperado = simularReajuste(e.precoAnterior, e.percentual).novoPreco;
  if (!Number.isFinite(e.novoPreco) || e.novoPreco <= 0) throw new Error("novo preço inválido");
  if (Math.abs(arredonda(e.novoPreco) - esperado) > 0.01) {
    throw new Error(`novo preço (${e.novoPreco}) não bate com preço anterior ${e.precoAnterior} + ${e.percentual}% (= ${esperado})`);
  }
  return {
    item_type: e.itemType,
    item_id: e.itemId.trim(),
    index_name: (e.indice ?? INDICE_PADRAO).trim() || INDICE_PADRAO,
    percent_applied: e.percentual,
    base_date: e.dataBase,
    applied_at: new Date(aplicado).toISOString(),
    previous_price: arredonda(e.precoAnterior),
    new_price: arredonda(e.novoPreco),
    note: e.observacao?.trim() ? e.observacao.trim() : null,
  };
}
