// Regras puras do cancelamento de venda (sem API nem React), para testar com Node
// (scripts/smoke-cancelamento-venda.mjs) e compartilhar entre Sales.jsx e CancelSaleDialog.

export const PAPEIS_ADMIN = ["owner", "admin", "platform_admin"];
export const JUSTIFICATIVA_MIN = 15;
export const JUSTIFICATIVA_MAX = 255;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Mesma regra do servidor (fiscal-document): papel da empresa, ou o papel geral na falta dele. */
export function podeCancelarDocumentoFiscal(user) {
  return !!user && PAPEIS_ADMIN.includes(String(user.company_role || user.role));
}

/** Motivo do cancelamento fiscal: de 15 a 255 caracteres, como o xJust do evento. */
export function justificativaValida(texto) {
  const n = String(texto ?? "").trim().length;
  return n >= JUSTIFICATIVA_MIN && n <= JUSTIFICATIVA_MAX;
}

/** Venda que já existe no servidor (a offline ainda sem sincronizar tem id local e não é cancelada aqui). */
export const vendaSincronizada = (sale) => UUID.test(String(sale?.id || ""));
