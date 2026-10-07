/**
 * Smoke do dinheiro/troco no checkout (sem rede): src/lib/troco.js.
 * payments[].amount = valor aplicado (soma == total); received/change = entregue e troco.
 * Uso: node scripts/smoke-troco-dinheiro.mjs
 */
import { readFileSync } from "fs";
import { lancamentoDinheiro, totaisDoRecebimento, dinheiroRecebidoDaVenda } from "../src/lib/troco.js";
import { totaisPorForma, esperadoNaGaveta } from "../src/lib/cashClose.js";

const falhas = [];
let passaram = 0;
const check = (cond, msg) => (cond ? passaram++ : falhas.push(msg));
const c = (v) => Math.round(v * 100);

/** Mesma montagem do CheckoutDialog: dinheiro via lancamentoDinheiro, demais formas = valor informado (limitado ao restante). */
function vende(total, linhas) {
  const payments = [];
  for (const l of linhas) {
    const pago = payments.reduce((s, p) => s + c(p.amount), 0);
    const restante = (c(total) - pago) / 100;
    if (restante <= 0) break;
    if (l.method === "dinheiro") {
      const d = lancamentoDinheiro(l.recebido, restante);
      payments.push({ method: "dinheiro", amount: d.amount, received: d.received, change: d.change });
    } else {
      payments.push({ method: l.method, amount: Math.min(l.valor ?? restante, restante) });
    }
  }
  return { payments, ...totaisDoRecebimento(payments) };
}
const somaAplicada = (v) => v.payments.reduce((s, p) => s + c(p.amount), 0);

// Dinheiro com troco: 7,99 recebido 10,00
let v = vende(7.99, [{ method: "dinheiro", recebido: 10 }]);
check(v.payments[0].amount === 7.99 && v.payments[0].received === 10 && v.payments[0].change === 2.01, "7,99/10,00: linha amount 7,99, received 10, change 2,01");
check(v.paidTotal === 7.99 && v.amountReceived === 10 && v.change === 2.01, "7,99/10,00: venda amount_received 10,00, change 2,01");
check(somaAplicada(v) === c(7.99), "7,99/10,00: soma payments.amount == total");

// Dinheiro exato
v = vende(7.99, [{ method: "dinheiro", recebido: 7.99 }]);
check(v.change === 0 && v.amountReceived === 7.99 && somaAplicada(v) === c(7.99), "dinheiro exato: troco 0");

// Campo vazio = paga o restante
v = vende(50, [{ method: "dinheiro", recebido: 0 }]);
check(v.payments[0].amount === 50 && v.change === 0 && v.amountReceived === 50, "dinheiro vazio paga o restante, sem troco");

// Dinheiro insuficiente (parcial): lançamento 80 de 100, sem troco; restante fica para outra forma
v = vende(100, [{ method: "dinheiro", recebido: 80 }]);
check(v.payments[0].amount === 80 && v.change === 0 && somaAplicada(v) === c(80), "dinheiro insuficiente: aplica 80, troco 0, falta 20");
v = vende(100, [{ method: "dinheiro", recebido: 80 }, { method: "pix" }]);
check(somaAplicada(v) === c(100) && v.change === 0 && v.amountReceived === 100, "80 dinheiro + restante PIX: soma 100, troco 0");

// Dinheiro 70 + PIX 30
v = vende(100, [{ method: "dinheiro", recebido: 70 }, { method: "pix", valor: 30 }]);
check(somaAplicada(v) === c(100) && v.amountReceived === 100 && v.change === 0, "dinheiro 70 + PIX 30: amount 100, recebido 100, troco 0");

// Dinheiro 120 em venda de 100
v = vende(100, [{ method: "dinheiro", recebido: 120 }]);
check(v.payments[0].amount === 100 && v.amountReceived === 120 && v.change === 20, "dinheiro 120 em 100: amount 100, recebido 120, troco 20");

// Misto com troco: cartão/PIX 30 + dinheiro recebido 80 → aplicado 70
v = vende(100, [{ method: "pix", valor: 30 }, { method: "dinheiro", recebido: 80 }]);
check(v.payments[1].amount === 70 && v.payments[1].received === 80 && v.amountReceived === 80 + 30 && v.change === 10, "PIX 30 + dinheiro 80: aplicado 70, troco 10");
check(somaAplicada(v) === c(100), "misto com troco: soma payments.amount == total");

// Desconto e acréscimo: o total final é o que vira restante (100 − 10 + 5 = 95; recebido 100 → troco 5)
const totalFinal = Math.max(0, 100 - 10 + 5);
v = vende(totalFinal, [{ method: "dinheiro", recebido: 100 }]);
check(v.payments[0].amount === 95 && v.change === 5 && v.amountReceived === 100, "desconto 10 + acréscimo 5: total 95, recebido 100, troco 5");

// Centavos sem erro de ponto flutuante
v = vende(0.3, [{ method: "dinheiro", recebido: 0.5 }]);
check(v.change === 0.2 && v.payments[0].amount === 0.3, "0,30 recebido 0,50: troco 0,20 exato");
v = vende(19.9, [{ method: "dinheiro", recebido: 20 }]);
check(v.change === 0.1, "19,90 recebido 20,00: troco 0,10 exato");

// Dois lançamentos de dinheiro (adiciona 30, depois finaliza com 100 em cima do restante 70)
v = vende(100, [{ method: "dinheiro", recebido: 30 }, { method: "dinheiro", recebido: 100 }]);
check(somaAplicada(v) === c(100) && v.change === 30 && v.amountReceived === 130, "dinheiro 30 + dinheiro 100: aplicado 100, recebido 130, troco 30");

// Caixa continua contando só o valor aplicado
const venda = { status: "concluida", total: 7.99, payment_method: "dinheiro", amount_received: 10, change: 2.01, payments: [{ method: "dinheiro", amount: 7.99, received: 10, change: 2.01 }] };
const t = totaisPorForma([venda]);
check(Math.abs(t.porForma.dinheiro - 7.99) < 1e-9 && Math.abs(t.total - 7.99) < 1e-9, "fechamento de caixa soma 7,99 (não 10,00)");
check(Math.abs(esperadoNaGaveta({ abertura: 100, vendasDinheiro: t.porForma.dinheiro }) - 107.99) < 1e-9, "gaveta esperada = abertura + 7,99");

// Comprovante: dinheiro recebido vem da linha de dinheiro; venda sem dinheiro/antiga → null
check(dinheiroRecebidoDaVenda(venda) === 10, "dinheiroRecebidoDaVenda = 10,00");
check(dinheiroRecebidoDaVenda({ payments: [{ method: "pix", amount: 10 }] }) === null, "venda sem dinheiro: sem 'Dinheiro recebido'");
check(dinheiroRecebidoDaVenda({ payment_method: "dinheiro", total: 5 }) === null, "venda antiga sem payments[]: sem 'Dinheiro recebido'");
check(dinheiroRecebidoDaVenda({ payments: [{ method: "dinheiro", amount: 5 }] }) === 5, "linha de dinheiro antiga sem received: usa amount");

// Comprovante (texto fonte): troco impresso uma única vez
const fonte = readFileSync(new URL("../src/lib/saleReceipt.js", import.meta.url), "utf8");
check((fonte.match(/<span class="l">Troco<\/span>/g) || []).length === 1, "comprovante tem uma única linha de Troco");
check(/Dinheiro recebido/.test(fonte) && /troco > 0 && dinheiroRecebido != null/.test(fonte), "comprovante só mostra Dinheiro recebido com troco e pagamento em dinheiro");

console.log(JSON.stringify({ passaram, falhas: falhas.length }));
if (falhas.length) {
  falhas.forEach((f) => console.log("FALHA:", f));
  process.exit(1);
}
console.log(`${passaram} passaram, 0 falharam`);
