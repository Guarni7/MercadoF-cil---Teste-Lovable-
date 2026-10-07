// Crediário em vendas com várias formas de pagamento.
//
// Só o valor lançado como crediário vira dívida do cliente (e só ele é abatido no
// cancelamento/devolução) — nunca o total da venda. Ex.: R$ 100 = R$ 60 PIX + R$ 40
// crediário → R$ 40. Mesma leitura de pagamentos do Fechar Caixa (pagamentosDaVenda):
// sales.payments[], ou payment_method + total em venda antiga sem payments[].
import { pagamentosDaVenda } from "./cashClose.js";

const centavos = (v) => Math.round((Number(v) || 0) * 100);

/** Quanto desta venda ficou no crediário do cliente, em reais. */
export function valorCrediarioDaVenda(sale) {
  const c = pagamentosDaVenda(sale)
    .filter((p) => p.method === "crediario")
    .reduce((soma, p) => soma + centavos(p.amount), 0);
  return c / 100;
}

/** Quanto ainda dá para abater do crediário desta venda numa devolução (crediário da venda − já abatido). */
export function crediarioRestanteDaVenda(sale, devolucoesAnteriores = []) {
  const jaAbatido = (devolucoesAnteriores || [])
    .filter((d) => d.refund_method === "crediario")
    .reduce((soma, d) => soma + centavos(d.refund_amount), 0);
  return Math.max(0, centavos(valorCrediarioDaVenda(sale)) - jaAbatido) / 100;
}
