// Espelho mínimo de src/lib/plans.js — só o necessário para calcular quanto
// cobrar de verdade no servidor. src/lib/plans.js continua sendo a fonte de
// verdade do FRONTEND (preço exibido); este arquivo é a fonte de verdade do
// QUANTO É COBRADO — nunca confiar no valor que vem do navegador. Mudou um
// preço lá, muda aqui também.
export const PLAN_PRICES: Record<string, number> = {
  mei: 119.9,
  simples: 169.9,
};

export const ADDON_PRICES: Record<string, number> = {
  pdv_pos: 50,
  tef_sitef: 90,
  nfse: 29.9,
  whatsapp: 19.9,
  mesas: 19.9,
};

// Nenhum adicional é incluso em plano: TEF (SiTef) é cobrado também no Simples Nacional,
// como em src/lib/plans.js. (Mantido como mapa para o dia em que um adicional voltar a ser incluso.)
const ADDON_INCLUDED_IN_PLAN: Record<string, string[]> = {};

export class PlanInputError extends Error {}

export function calcPlanMonthlyTotal(planId: string, addonIds: string[]): number {
  const base = PLAN_PRICES[planId];
  if (base === undefined) throw new PlanInputError(`Plano inválido: ${planId}`);

  let total = base;
  for (const id of addonIds) {
    const price = ADDON_PRICES[id];
    if (price === undefined) throw new PlanInputError(`Addon inválido: ${id}`);
    const included = ADDON_INCLUDED_IN_PLAN[id]?.includes(planId);
    if (!included) total += price;
  }
  return Math.round(total * 100) / 100;
}
