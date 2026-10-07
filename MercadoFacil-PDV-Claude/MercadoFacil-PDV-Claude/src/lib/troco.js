// Dinheiro e troco — cálculo puro (sem React, sem imports `@/`) para testar em Node.
//
// payments[].amount é SEMPRE o valor aplicado à venda (a soma bate com sales.total — trigger
// sales_validate_payments e fechamento de caixa dependem disso). O que o cliente entregou e o
// troco ficam à parte: `received` e `change` na linha de dinheiro.

const cent = (v) => Math.round((Number(v) || 0) * 100);

/** Lançamento de dinheiro: recebido vazio = paga o restante. */
export function lancamentoDinheiro(recebido, restante) {
  const rest = cent(restante);
  const rec = cent(recebido) > 0 ? cent(recebido) : rest;
  const aplicado = Math.min(rec, rest);
  return { amount: aplicado / 100, received: rec / 100, change: (rec - aplicado) / 100 };
}

/** Totais para gravar na venda: valor aplicado, troco e quanto o cliente entregou no total. */
export function totaisDoRecebimento(payments) {
  let paid = 0;
  let change = 0;
  for (const p of payments || []) {
    paid += cent(p.amount);
    change += cent(p.change);
  }
  return { paidTotal: paid / 100, change: change / 100, amountReceived: (paid + change) / 100 };
}

/** Dinheiro entregue em uma venda gravada (linhas de dinheiro; venda antiga sem payments[] → null). */
export function dinheiroRecebidoDaVenda(sale) {
  const linhas = (Array.isArray(sale?.payments) ? sale.payments : []).filter((p) => p?.method === "dinheiro");
  if (linhas.length === 0) return null;
  return linhas.reduce((s, p) => s + cent(p.received ?? p.amount), 0) / 100;
}
