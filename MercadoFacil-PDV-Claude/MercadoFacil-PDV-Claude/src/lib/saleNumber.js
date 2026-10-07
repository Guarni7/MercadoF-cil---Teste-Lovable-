/**
 * Quem numera a venda é o banco (trigger sales_assign_number), para dois caixas
 * não gerarem o mesmo número. Vendas feitas offline ficam sem número até a
 * sincronização — mostrar um número provisório confundiria o operador, que
 * poderia repassá-lo ao cliente.
 */
export function saleNumberLabel(sale) {
  return sale?.number ? `#${sale.number}` : "#offline";
}

/** Versão explicada, para comprovante e detalhe da venda. */
export function saleNumberFull(sale) {
  return sale?.number ? `n. ${sale.number}` : "offline — nº após sincronizar";
}

export function isSaleNumberPending(sale) {
  return !sale?.number;
}

/**
 * Mensagem enviada ao cliente: sem número quando a venda ainda não sincronizou,
 * já que esse número não serviria para localizar a venda depois.
 */
export function saleReceiptMessage(sale, formatTotal) {
  const header = sale?.number
    ? `Comprovante de Venda #${sale.number}`
    : "Comprovante de Venda";
  return `${header}\nTotal: ${formatTotal}\nObrigado!`;
}
