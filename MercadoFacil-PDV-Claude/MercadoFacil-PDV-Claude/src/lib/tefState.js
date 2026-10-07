// Máquina de estados da transação TEF — sem I/O, sem depender de configuração
// de rede. Separado de tef.js (que fala HTTP com o agente) para poder ser
// testado sozinho (scripts/smoke-tef-state.mjs) e para não misturar "o que é
// uma transação" com "como ela é enviada".

/** Estados possíveis de uma transação TEF, do início ao fim. */
export const TefStatus = Object.freeze({
  IDLE: "idle",
  INITIATING: "initiating",
  PENDING: "pending",
  APPROVED: "approved",
  DECLINED: "declined",
  TIMEOUT: "timeout",
  ERROR: "error",
  CANCELLING: "cancelling",
  CANCELLED: "cancelled",
});

/** Só este estado autoriza tratar o valor como efetivamente pago. */
export const isTefApproved = (status) => status === TefStatus.APPROVED;

/** Estados que ainda podem virar aprovado/recusado — não finais. */
export const isTefInFlight = (status) =>
  status === TefStatus.INITIATING || status === TefStatus.PENDING;

export const createTefTransactionId = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `tef-${Date.now()}-${Math.random().toString(16).slice(2)}`;

/**
 * Classifica a resposta do agente num TefStatus. `data.approved`/`data.pending`
 * são os únicos campos que este projeto já assume hoje; um agente real pode
 * devolver mais campos, ignorados aqui até existir especificação da Software
 * Express.
 */
export function classifyTefResponse(data) {
  if (data?.pending === true) return TefStatus.PENDING;
  if (data?.approved === true) return TefStatus.APPROVED;
  return TefStatus.DECLINED;
}

// --- Recuperação de transação ---
//
// Estado guardado no sessionStorage (por aba, não sobrevive fechar o
// navegador) enquanto uma transação TEF está em curso. Sem isto, um F5 ou
// uma queda do app no meio de uma cobrança aprovada na maquininha perde
// completamente o rastro do transactionId, e o operador não tem como saber
// se pode vender de novo ou precisa consultar/cancelar primeiro.
const PENDING_KEY = "tef_pending_transaction";

export function savePendingTefTransaction(info) {
  try {
    sessionStorage.setItem(PENDING_KEY, JSON.stringify(info));
  } catch {
    // sessionStorage indisponível (modo privado, etc.) — recuperação fica
    // melhor-esforço, não crítica para a transação em si.
  }
}

export function clearPendingTefTransaction() {
  try {
    sessionStorage.removeItem(PENDING_KEY);
  } catch {}
}

export function getPendingTefTransaction() {
  try {
    return JSON.parse(sessionStorage.getItem(PENDING_KEY) || "null");
  } catch {
    return null;
  }
}
