// Mesas como adicional pago — regras puras (sem React, sem imports `@/`) para testar em Node.
//
// Mesas é um adicional (+ R$ 19,90/mês no catálogo de planos, id "mesas"). Quem pode usar:
//   - platform_admin (conta da própria MercadoFácil);
//   - empresa em TESTE vigente (nada é cobrado no teste);
//   - empresa com plano ativo que contratou o adicional (plan_addons inclui "mesas").
// Plano ativo sem o adicional, teste vencido ou sem plano: não usa; a tela pede "Ativar Mesas".
// O bloqueio é de interface (o banco não restringe por adicional); a COBRANÇA continua sendo do servidor.

export const ID_ADICIONAL_MESAS = "mesas";

const arredonda = (v) => Math.round((Number(v) || 0) * 100) / 100;

/**
 * @param {{ plataforma?: boolean, status?: string, expirado?: boolean, addons?: string[] }} u
 *   status = companies.plan_status; expirado = teste/plano já vencido (planAccess.isTrialExpired).
 */
export function mesasLiberadas({ plataforma = false, status = "none", expirado = false, addons = [] } = {}) {
  if (plataforma) return true;
  if (expirado) return false;
  if (status === "trial") return true;
  if (status === "active") return (addons || []).includes(ID_ADICIONAL_MESAS);
  return false;
}

/** "teste": ativa na hora, sem cobrança; "contratar": o adicional entra na assinatura (PIX no fluxo de planos). */
export const modoDeAtivacao = ({ status = "none", expirado = false } = {}) => (status === "trial" && !expirado ? "teste" : "contratar");

/** Reajuste mostrado antes de ativar: plano atual (com os adicionais que já tem) + Mesas = novo total mensal. */
export function reajusteDoPlano({ planoAtualMensal, adicionalMensal }) {
  return { planoAtual: arredonda(planoAtualMensal), adicional: arredonda(adicionalMensal), novoTotal: arredonda(arredonda(planoAtualMensal) + arredonda(adicionalMensal)) };
}

/** Adicionais da assinatura com Mesas incluído (sem duplicar), para abrir o fluxo de contratação. */
export const addonsComMesas = (addons = []) => [...new Set([...(addons || []), ID_ADICIONAL_MESAS])];
