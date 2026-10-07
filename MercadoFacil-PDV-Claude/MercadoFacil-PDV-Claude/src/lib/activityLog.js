import { api } from "@/api/dataClient";
import { formatBRL } from "@/lib/format";

/**
 * Registra uma atividade no log de auditoria.
 * @param {Object} params
 * @param {string} params.type - Tipo da atividade (venda, abertura_caixa, fechamento_caixa, discrepancia_caixa, troco)
 * @param {string} params.description - Descrição legível
 * @param {string} [params.severity] - info | warning | alert
 * @param {number} [params.amount] - Valor monetário envolvido
 * @param {number} [params.changeAmount] - Troco dado
 * @param {number} [params.discrepancy] - Diferença detectada
 * @param {number} [params.saleNumber] - Número da venda
 * @param {string} [params.cashRegisterId] - ID do caixa
 * @param {string} [params.paymentMethod] - Forma de pagamento
 * @param {string} [params.details] - Detalhes adicionais
 */
export async function logActivity(params) {
  try {
    let user = null;
    try {
      user = await api.auth.me();
    } catch {}

    await api.entities.ActivityLog.create({
      type: params.type,
      description: params.description,
      user_name: user?.full_name || user?.email || "—",
      user_role: user?.role || "",
      severity: params.severity || "info",
      amount: params.amount || 0,
      change_amount: params.changeAmount || 0,
      discrepancy: params.discrepancy || 0,
      sale_number: params.saleNumber || null,
      cash_register_id: params.cashRegisterId || "",
      payment_method: params.paymentMethod || "",
      details: params.details || "",
    });
  } catch (e) {
    console.error("Erro ao registrar log de atividade:", e);
  }
}

/**
 * Gera a descrição para uma venda.
 */
export function describeSale(saleNumber, total, paymentMethod, change, customerName, note) {
  const methodLabels = {
    dinheiro: "Dinheiro",
    pix: "PIX",
    credito: "Crédito",
    debito: "Débito",
    crediario: "Crediário",
  };
  const method = methodLabels[paymentMethod] || paymentMethod;
  let desc = `Venda #${saleNumber} — ${formatBRL(total)} via ${method}`;
  if (customerName && customerName !== "Consumidor") {
    desc += ` · Cliente: ${customerName}`;
  }
  if (change && change > 0) {
    desc += ` · Troco: ${formatBRL(change)}`;
  }
  if (note) desc += ` · ${note}`;
  return desc;
}

/**
 * Gera a descrição para fechamento de caixa com discrepância.
 */
export function describeCashClose(openedBy, expected, counted, discrepancy) {
  let desc = `Fechamento de caixa de ${openedBy}`;
  desc += ` · Esperado: ${formatBRL(expected)} · Contado: ${formatBRL(counted)}`;
  if (discrepancy > 0) {
    desc += ` · Faltou ${formatBRL(discrepancy)}`;
  } else if (discrepancy < 0) {
    desc += ` · Sobrou ${formatBRL(Math.abs(discrepancy))}`;
  } else {
    desc += ` · Conferiu exato`;
  }
  return desc;
}