// Cancelamento de venda, com nota fiscal quando houver — lógica única usada pela lista de Vendas
// (Sales.jsx) e pelo detalhe da venda no Gerenciador (CancelSaleDialog).
//
// Ordem que não pode mudar: a nota fiscal autorizada é cancelada PRIMEIRO, na SEFAZ (evento 110111).
// Só se a SEFAZ confirmar (o servidor devolve status "cancelled" com protocolo) a venda é cancelada,
// o estoque volta e o crediário é ajustado. Recusa ou erro da SEFAZ não cancelam nada.
//
// Quem pode cancelar documento fiscal é decidido pelo servidor (fiscal-document: owner, admin,
// platform_admin). A checagem daqui (podeCancelarDocumentoFiscal) só evita que o operador comum
// ache que iniciou um cancelamento.
import { api } from "@/api/dataClient";
import { bloqueioFiscalDaVenda, cancelarDocumento, carregarConfigFiscal } from "@/lib/fiscalConfig";
import { analisarPrazoCancelamento, mensagemPrazoExpirado } from "@/lib/prazoCancelamento";
import { MSG_FISCAL_NAO_VERIFICADO, estadoFiscalImpedeDesfazer } from "@/lib/acoesFiscaisVenda";
import { valorCrediarioDaVenda } from "@/lib/crediario";
import {
  JUSTIFICATIVA_MAX,
  JUSTIFICATIVA_MIN,
  PAPEIS_ADMIN,
  justificativaValida,
  podeCancelarDocumentoFiscal,
  vendaSincronizada,
} from "@/lib/saleCancellationRules";

export { JUSTIFICATIVA_MAX, JUSTIFICATIVA_MIN, PAPEIS_ADMIN, justificativaValida, podeCancelarDocumentoFiscal, vendaSincronizada };

/**
 * Venda com devolução registrada não é cancelada por inteiro: o cancelamento devolveria ao estoque
 * (e ao crediário) tudo de novo, e o dinheiro já devolvido continuaria descontado do caixa.
 * Lança erro se não conseguir verificar — nunca cancela sem saber.
 */
export async function vendaTemDevolucao(sale) {
  const devolucoes = await api.entities.SaleReturn.filter({ sale_id: sale.id }, "-created_date", 1);
  return devolucoes.length > 0;
}

/**
 * Prazo do cancelamento da nota fiscal da venda (NFC-e em GO: 30 min; NF-e: 24 h; ver
 * prazoCancelamento.js). `bloqueio` é o resultado de bloqueioFiscalDaVenda. Sem prazo conhecido para a
 * UF/modelo, ou se a UF não carregar, NÃO bloqueia: o servidor e a SEFAZ decidem.
 * Devolve { expirado, mensagem, analise } (analise null sem nota).
 */
export async function prazoDaNotaFiscal(bloqueio) {
  if (!bloqueio?.document) return { expirado: false, mensagem: null, analise: null };
  let uf = null;
  try {
    uf = (await carregarConfigFiscal())?.uf ?? null;
  } catch {
    uf = null;
  }
  const doc = bloqueio.document;
  const analise = analisarPrazoCancelamento({ uf, model: doc.model, authorizedAt: doc.authorized_at });
  const mensagem = analise.expirado
    ? mensagemPrazoExpirado({ model: doc.model, limiteMin: /** @type {number} */ (analise.limiteMin), decorridoMin: /** @type {number} */ (analise.decorridoMin) })
    : null;
  return { expirado: analise.expirado, mensagem, analise };
}

/** Erro com a etapa em que parou: "nota" (nada foi cancelado) ou "venda" (a nota já pode ter sido cancelada). */
export class ErroCancelamento extends Error {
  /**
   * @param {string} message
   * @param {{ etapa?: "nota" | "venda", notaCancelada?: boolean, causa?: unknown }} [opcoes]
   */
  constructor(message, { etapa, notaCancelada = false, causa } = {}) {
    super(message);
    this.name = "ErroCancelamento";
    this.etapa = etapa;
    this.notaCancelada = notaCancelada;
    this.cause = causa;
  }
}

/**
 * Cancela a nota fiscal (se houver) e depois a venda.
 * `bloqueio` (opcional) é o resultado de bloqueioFiscalDaVenda, quando quem chama já o consultou.
 * Devolve { nota: { numero, protocolo } | null }.
 * @param {any} sale
 * @param {{ justificativa?: string | null, bloqueio?: any }} [opcoes]
 */
export async function cancelarVendaCompleta(sale, { justificativa, bloqueio } = {}) {
  // NFC-e sem resolução (incerta, em transmissão ou em andamento): a SEFAZ pode autorizar depois. Não
  // cancela nada, nem nota, nem venda, nem estoque. Sem conseguir verificar, também não cancela.
  let estadoFiscal;
  try {
    estadoFiscal = await estadoFiscalImpedeDesfazer(api, sale.id);
  } catch (e) {
    throw new ErroCancelamento(MSG_FISCAL_NAO_VERIFICADO, { etapa: "nota", causa: e });
  }
  if (estadoFiscal.bloqueado) throw new ErroCancelamento(/** @type {string} */ (estadoFiscal.mensagem), { etapa: "nota" });

  const fiscal = bloqueio === undefined ? await bloqueioFiscalDaVenda(sale.id) : bloqueio;

  let nota = null;
  if (fiscal) {
    // Fora do prazo nem adianta pedir à SEFAZ: ela recusaria (cStat 501) e a tentativa ficaria na trilha.
    const prazo = await prazoDaNotaFiscal(fiscal);
    if (prazo.expirado) throw new ErroCancelamento(/** @type {string} */ (prazo.mensagem), { etapa: "nota" });
    if (!justificativaValida(justificativa)) {
      throw new ErroCancelamento(
        `Informe o motivo do cancelamento (de ${JUSTIFICATIVA_MIN} a ${JUSTIFICATIVA_MAX} caracteres). Nada foi cancelado.`,
        { etapa: "nota" },
      );
    }
    try {
      const resultado = await cancelarDocumento({ documentId: fiscal.document.id, justificativa: String(justificativa).trim() });
      if (resultado?.status !== "cancelled" || !resultado?.protocol) {
        throw new Error(resultado?.message || resultado?.error || "A SEFAZ não confirmou o cancelamento da nota.");
      }
      nota = { numero: fiscal.document.number, protocolo: resultado.protocol };
    } catch (e) {
      throw new ErroCancelamento(
        e.message || "Não foi possível cancelar a nota fiscal na SEFAZ. Venda não foi cancelada.",
        { etapa: "nota", causa: e },
      );
    }
  }

  try {
    if (sale.items && sale.items.length > 0) {
      const updates = await Promise.all(
        sale.items.map(async (item) => {
          try {
            const product = await api.entities.Product.get(item.product_id);
            return { id: item.product_id, stock: (product.stock || 0) + item.quantity };
          } catch {
            return null;
          }
        }),
      );
      const validUpdates = updates.filter(Boolean);
      if (validUpdates.length > 0) await api.entities.Product.bulkUpdate(validUpdates);
    }

    await api.entities.Sale.update(sale.id, { status: "cancelada" });

    // Só o que foi lançado como crediário volta (venda mista: não o total).
    const valorCrediario = valorCrediarioDaVenda(sale);
    if (valorCrediario > 0 && sale.customer_id) {
      const customer = await api.entities.Customer.get(sale.customer_id);
      await api.entities.Customer.update(sale.customer_id, {
        credit_balance: Math.max(0, (customer.credit_balance || 0) - valorCrediario),
      });
    }
  } catch (e) {
    throw new ErroCancelamento(
      nota
        ? "A nota fiscal foi cancelada na SEFAZ, mas a venda não foi cancelada por completo. Confira a venda e o estoque."
        : "Erro ao cancelar venda.",
      { etapa: "venda", notaCancelada: !!nota, causa: e },
    );
  }

  return { nota };
}
