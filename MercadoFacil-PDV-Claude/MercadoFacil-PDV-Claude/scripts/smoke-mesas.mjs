/**
 * Smoke de Mesas/comandas e almoço por peso (sem rede): src/lib/mesas.js + integração com o checkout.
 * Cobre regras puras (pessoas, peso × preço/kg, produtos, pagamento único/individual/dividido, fechamento,
 * idempotência) e confere, no código-fonte, o que não dá para rodar sem banco: RLS/company_id da migration 080,
 * PDV sem estoque/produto para linhas avulsas e venda rápida intacta.
 * Uso: node scripts/smoke-mesas.mjs
 */
import { readFileSync } from "fs";
import {
  valorPorPeso, novaPessoa, atualizarPessoa, removerPessoa, adicionarProduto, removerProduto, valorItem,
  totaisDaMesa, statusDaMesa, montarCarrinho, aplicarPagamento, dividirIgual, descricaoPeso,
  faltandoNoProdutoFiscal, produtoFiscalValido, bloqueioFiscalDoAlmoco, ORIGEM_ALMOCO,
} from "../src/lib/mesas.js";
import { lancamentoDinheiro, totaisDoRecebimento } from "../src/lib/troco.js";
import { totaisPorForma } from "../src/lib/cashClose.js";

const falhas = [];
let passaram = 0;
const check = (cond, msg) => (cond ? passaram++ : falhas.push(msg));
const c = (v) => Math.round(v * 100);
const ler = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

const refri = { id: "p-refri", name: "Refrigerante", price: 6, stock: 50 };
const sobremesa = { id: "p-sobre", name: "Sobremesa", price: 8, stock: 20 };
const produtosPorId = { [refri.id]: refri, [sobremesa.id]: sobremesa };
const mesaVazia = () => ({ id: "o1", table_number: "1", status: "aberta", people: [], items: [], sale_ids: [] });

// ---------- abrir / ocupar ----------
check(statusDaMesa(null) === "livre", "mesa sem atendimento = LIVRE");
check(statusDaMesa(mesaVazia()) === "ocupada", "atendimento aberto = OCUPADA");
check(statusDaMesa({ ...mesaVazia(), status: "fechada" }) === "livre", "atendimento fechado = LIVRE");
let t = totaisDaMesa(mesaVazia());
check(t.total === 0 && t.qtdPessoas === 0 && t.qtdItens === 0, "mesa recém-aberta: total 0, sem pessoas/itens");

// ---------- cálculo por peso ----------
check(valorPorPeso(0.45, 80) === 36, "0,450 kg × R$ 80 = R$ 36,00");
check(valorPorPeso(0.62, 80) === 49.6, "0,620 kg × R$ 80 = R$ 49,60");
check(valorPorPeso(0.38, 80) === 30.4, "0,380 kg × R$ 80 = R$ 30,40");
check(valorPorPeso(0.333, 59.9) === 19.95, "arredonda ao centavo (0,333 × 59,90 = 19,95)");
check(valorPorPeso(0, 80) === 0 && valorPorPeso("abc", 80) === 0, "peso vazio/inválido = 0");

// ---------- 1 pessoa ----------
let m = mesaVazia();
m.people = [atualizarPessoa(novaPessoa({ precoKg: 80 }), { peso: 0.45 })];
t = totaisDaMesa(m);
check(t.qtdPessoas === 1 && t.total === 36, "1 pessoa: 36,00");

// ---------- 3 pessoas, pesos diferentes ----------
m = mesaVazia();
const p1 = atualizarPessoa(novaPessoa({ precoKg: 80 }), { peso: 0.45 });
const p2 = atualizarPessoa(novaPessoa({ precoKg: 80 }), { peso: 0.62 });
const p3 = atualizarPessoa(novaPessoa({ precoKg: 80 }), { peso: 0.38 });
m.people = [p1, p2, p3];
t = totaisDaMesa(m);
check(t.qtdPessoas === 3 && t.pessoas === 116 && t.total === 116, "3 pessoas: total R$ 116,00");
check(new Set(m.people.map((p) => p.id)).size === 3, "pessoas têm ids distintos (não são produtos)");
check(m.people.every((p) => !String(p.id).startsWith("p-")), "pessoa não vira produto cadastrado");

// preços/kg diferentes
const pa = atualizarPessoa(novaPessoa({ precoKg: 70 }), { peso: 0.5 });
const pb = atualizarPessoa(novaPessoa({ precoKg: 90 }), { peso: 0.5 });
check(pa.valor === 35 && pb.valor === 45, "preços/kg diferentes: 35,00 e 45,00");

// ---------- ajuste manual ----------
let pm = atualizarPessoa(p2, { valor: 45 });
check(pm.manual === true && pm.valor === 45, "valor ajustado à mão fica manual");
pm = atualizarPessoa(pm, { peso: 0.7 });
check(pm.valor === 45, "manual não recalcula ao mudar o peso");
pm = atualizarPessoa(pm, { manual: false });
check(pm.manual === false && pm.valor === 56, "voltar ao automático recalcula (0,700 × 80 = 56,00)");
check(descricaoPeso(atualizarPessoa(p2, { valor: 45 })).includes("valor ajustado"), "descrição indica valor ajustado");
check(descricaoPeso(p2) === "0,620 kg × R$ 80,00/kg", "descrição do peso: 0,620 kg × R$ 80,00/kg");

// ---------- alterar / remover pessoa ----------
const alterada = atualizarPessoa(p1, { peso: 0.5, label: "João" });
check(alterada.valor === 40 && alterada.label === "João", "alterar pessoa: peso e identificação");
check(removerPessoa(m.people, p3.id).length === 2 && totaisDaMesa({ ...m, people: removerPessoa(m.people, p3.id) }).total === 85.6, "remover pessoa 3: total 85,60");
let recusou = false;
try { removerPessoa([{ ...p1, paga: true }], p1.id); } catch { recusou = true; }
check(recusou, "pessoa já paga não pode ser removida");

// ---------- produtos normais junto ----------
m.items = adicionarProduto(m.items, refri, 1);
m.items = adicionarProduto(m.items, sobremesa, 1);
check(m.items.length === 2 && totaisDaMesa(m).produtos === 14, "produtos normais: refri + sobremesa = 14,00");
m.items = adicionarProduto(m.items, refri, 2);
check(m.items.length === 2 && m.items.find((i) => i.product_id === refri.id).quantity === 3, "mesmo produto acumula quantidade");
m.items = removerProduto(m.items, m.items.find((i) => i.product_id === refri.id).id);
m.items = adicionarProduto(m.items, refri, 1);
t = totaisDaMesa(m);
check(t.pessoas === 116 && t.produtos === 14 && t.total === 130 && t.qtdItens === 2, "TOTAL da mesa = 116 + 14 = R$ 130,00");

// ---------- pagamento único: carrinho do PDV ----------
const todo = montarCarrinho(m, { produtosPorId });
check(todo.cart.length === 5 && todo.total === 130 && todo.faltando.length === 0, "pagamento único: 3 pessoas + 2 produtos, total 130");
const avulsas = todo.cart.filter((l) => l.product.semEstoque);
check(avulsas.length === 3 && avulsas.every((l) => l.quantity === 1 && l.notes.includes("kg ×")), "pessoas viram linhas avulsas (sem estoque) com peso e preço/kg na observação");
check(todo.cart.filter((l) => !l.product.semEstoque).every((l) => produtosPorId[l.product.id]), "produtos normais mantêm o produto real (baixa de estoque)");
// o mesmo cálculo de items[].total do PDV (price × qtd − desconto, por linha) == total da mesa
const itensVenda = todo.cart.map((l) => ({ total: Math.round((l.customPrice || l.product.price) * l.quantity * 100) / 100 }));
check(c(itensVenda.reduce((s, i) => s + i.total, 0)) === c(130), "soma de sales.items[].total == total da mesa (receita única)");
check(todo.cart.filter((l) => l.product.semEstoque).every((l) => l.product.stock === 1), "linha avulsa não depende de estoque");

// ---------- dinheiro e troco no checkout existente ----------
const dinheiro = lancamentoDinheiro(150, todo.total);
check(dinheiro.amount === 130 && dinheiro.received === 150 && dinheiro.change === 20, "dinheiro 150 em 130: aplicado 130, troco 20");
const pagamentos = [{ method: "dinheiro", amount: dinheiro.amount, received: dinheiro.received, change: dinheiro.change }];
check(totaisDoRecebimento(pagamentos).amountReceived === 150 && c(pagamentos[0].amount) === c(todo.total), "soma dos pagamentos == total da venda da mesa");
const caixa = totaisPorForma([{ status: "concluida", total: 130, payments: pagamentos }]);
check(caixa.porForma.dinheiro === 130, "caixa conta só o valor aplicado (130), não o troco");

// ---------- fechamento: libera a mesa, histórico, sem duplicar ----------
let fechada = aplicarPagamento(m, { pessoaIds: todo.pessoaIds, itemIds: todo.itemIds, saleId: "sale-1" });
check(fechada.status === "fechada" && statusDaMesa(fechada) === "livre" && !!fechada.closed_at, "pagou tudo: atendimento fechado, mesa LIVRE");
check(JSON.stringify(fechada.sale_ids) === JSON.stringify(["sale-1"]), "histórico: venda registrada no atendimento");
check(fechada.people.length === 3 && fechada.items.length === 2 && fechada.people.every((p) => p.paga), "itens e pessoas preservados no histórico");
const repetida = aplicarPagamento(fechada, { pessoaIds: todo.pessoaIds, itemIds: todo.itemIds, saleId: "sale-1" });
check(repetida.sale_ids.length === 1 && repetida.status === "fechada", "mesmo saleId não duplica (idempotente)");
check(montarCarrinho(fechada, { produtosPorId }).cart.length === 0, "atendimento já pago não gera nova cobrança (sem receita duplicada)");

// ---------- pagamento individual por pessoa ----------
const sel2 = montarCarrinho(m, { pessoaIds: [p2.id], itemIds: [], produtosPorId });
check(sel2.cart.length === 1 && sel2.total === 49.6, "individual: só a Pessoa 2 (49,60)");
let parcial = aplicarPagamento(m, { pessoaIds: sel2.pessoaIds, itemIds: sel2.itemIds, saleId: "sale-p2" });
check(parcial.status === "aberta" && statusDaMesa(parcial) === "ocupada", "pagou uma pessoa: mesa continua OCUPADA");
check(totaisDaMesa(parcial).pendente === 130 - 49.6 && totaisDaMesa(parcial).total === 130, "pendente 80,40; total da mesa preservado");
check(montarCarrinho(parcial, { produtosPorId }).cart.every((l) => l.product.mesaPessoaId !== p2.id), "pessoa paga não volta ao carrinho");
const sel13 = montarCarrinho(parcial, { pessoaIds: [p1.id, p3.id], itemIds: [], produtosPorId });
parcial = aplicarPagamento(parcial, { pessoaIds: sel13.pessoaIds, itemIds: [], saleId: "sale-p13" });
check(parcial.status === "aberta", "produtos ainda pendentes: mesa segue aberta");
const resto = montarCarrinho(parcial, { produtosPorId });
parcial = aplicarPagamento(parcial, { pessoaIds: resto.pessoaIds, itemIds: resto.itemIds, saleId: "sale-resto" });
check(parcial.status === "fechada" && parcial.sale_ids.length === 3, "três vendas individuais: mesa fecha e guarda as 3 vendas");
check(c(49.6) + c(sel13.total) + c(resto.total) === c(130), "soma das vendas individuais == total da mesa (sem duplicar receita)");
check(removerProdutoPago(), "item pago não pode ser removido");
function removerProdutoPago() {
  try { removerProduto([{ id: "x", paga: true }], "x"); return false; } catch { return true; }
}

// ---------- divisão da conta ----------
const partes = dividirIgual(130, 3);
check(partes.length === 3 && c(partes.reduce((s, v) => s + v, 0)) === c(130), "dividir 130 em 3: soma exata");
check(JSON.stringify(partes) === JSON.stringify([43.34, 43.33, 43.33]), "dividir 130 em 3: 43,34 + 43,33 + 43,33");
check(dividirIgual(100, 1)[0] === 100 && dividirIgual(0.01, 3).reduce((s, v) => s + c(v), 0) === 1, "divisões extremas mantêm a soma");

// ---------- produto sumido do cadastro ----------
const semProduto = montarCarrinho(m, { produtosPorId: {} });
check(semProduto.faltando.length === 2 && semProduto.cart.length === 3, "produto removido do cadastro é avisado (não vira linha sem estoque)");

// ---------- preço alterado depois do lançamento ----------
const antigo = montarCarrinho({ ...m, items: [{ id: "i", product_id: refri.id, name: "Refrigerante", price: 5, quantity: 1, paga: false }], people: [] }, { produtosPorId });
check(antigo.cart[0].customPrice === 5, "preço lançado diferente do cadastro vira customPrice");

// ---------- fonte: banco / multi-tenant ----------
const mig = ler("supabase/migrations/080_table_orders.sql");
check(/create table if not exists public\.table_orders/.test(mig), "migration 080 cria table_orders idempotente");
check(/company_id uuid not null references public\.companies/.test(mig), "table_orders.company_id obrigatório");
check(/enable row level security/.test(mig) && /company_id = public\.current_company_id\(\)/.test(mig), "RLS por empresa (isolamento por company_id)");
check(/using \(company_id = public\.current_company_id\(\)\)[\s\S]*with check \(company_id = public\.current_company_id\(\)\)/.test(mig), "RLS cobre leitura e escrita");
check(/unique index if not exists table_orders_open_uidx[\s\S]*where status = 'aberta'/.test(mig), "uma mesa só pode ter um atendimento aberto por empresa");
check(!/create table[^;]*\b(mesas|comandas)\b/i.test(mig), "sem tabelas duplicadas (mesa e comanda = mesmo atendimento)");
const dados = ler("src/api/supabaseData.js");
check(/TableOrder: "table_orders"/.test(dados) && /TENANT_TABLES[\s\S]*"table_orders"/.test(dados), "TableOrder mapeada e preenchida com company_id do usuário");

// ---------- fonte: PDV (estoque, venda rápida, sem duplicar) ----------
const pdv = ler("src/pages/PDV.jsx");
const dl = ler("src/lib/dataLayer.js");
check((pdv.match(/product_id: item\.product\.semEstoque \? item\.product\.produtoFiscalId \|\| null : item\.product\.id/g) || []).length === 3, "PDV: linha avulsa grava o produto fiscal (ou nulo) nas 3 montagens de itens; produto normal segue com o próprio id");
check((pdv.match(/\.\.\.\(item\.product\.origem \? \{ origem: item\.product\.origem \} : \{\}\)/g) || []).length === 3, "PDV: itens de almoço por peso levam origem; produtos normais não ganham campo novo");
check(/cart\.filter\(\(i\) => !i\.product\.semEstoque\)/.test(pdv), "PDV: baixa de estoque online ignora linhas avulsas");
check((dl.match(/cart\.filter\(\(i\) => !i\.product\.semEstoque\)/g) || []).length === 2, "dataLayer: estoque local e fila de baixa ignoram linhas avulsas");
check(/cartEstoque/.test(pdv) && /cartEstoque\.filter/.test(pdv), "PDV: validação de estoque só para produtos reais");
check(/if \(mesaCtx && !isOnline\(\)\)/.test(pdv), "mesa só fecha online (evita cobrar duas vezes)");
check(/if \(mesaCtx\) \{[\s\S]*registrarPagamentoDaMesa/.test(pdv), "PDV baixa a mesa depois da venda");
check(/const \[cart, setCart\] = useState\(mesaInicial\?\.cart \|\| \[\]\)/.test(pdv), "venda rápida: carrinho começa vazio sem mesa");
check(/handleCheckout = async \(paymentData\)/.test(pdv) && !/handleCheckoutMesa/.test(pdv), "um único fluxo de venda (checkout existente reaproveitado)");
const ck = ler("src/components/pos/CheckoutDialog.jsx");
check(!/mesa/i.test(ck), "CheckoutDialog não foi alterado para mesas (dinheiro/troco/PIX/cartão intactos)");

// ---------- fiscal: almoço por peso ligado a UM produto fiscal da empresa ----------
const fiscal = { id: "p-almoco", name: "Almoço por quilo", ncm: "21069090", cfop: "5102", unit: "KG", origin: "0", price: 80, stock: 0 };
check(produtoFiscalValido(fiscal) && faltandoNoProdutoFiscal(fiscal).length === 0, "produto fiscal completo é válido");
check(faltandoNoProdutoFiscal(null).join() === "produto não encontrado", "sem produto fiscal: 'produto não encontrado'");
check(faltandoNoProdutoFiscal({ ...fiscal, ncm: "2106" }).includes("NCM (8 dígitos)"), "NCM curto é recusado (nada é completado)");
check(faltandoNoProdutoFiscal({ ...fiscal, ncm: "", cfop: " " }).length === 2, "NCM e CFOP vazios: falta os dois");
check(faltandoNoProdutoFiscal({ ...fiscal, unit: null, origin: undefined }).join() === "unidade,origem", "unidade/origem ausentes são apontadas");
const cartFiscal = montarCarrinho(m, { produtosPorId, produtoFiscal: fiscal });
const linhasAlmoco = cartFiscal.cart.filter((l) => l.product.origem === ORIGEM_ALMOCO);
check(linhasAlmoco.length === 3 && linhasAlmoco.every((l) => l.product.produtoFiscalId === fiscal.id && l.product.semEstoque), "3 pessoas ligadas ao MESMO produto fiscal, cada uma como linha própria sem estoque");
check(new Set(linhasAlmoco.map((l) => l.product.id)).size === 3 && linhasAlmoco.every((l) => l.product.id.startsWith("mesa-pessoa-")), "não existe produto Pessoa 1/2/3 (ids de linha, não de cadastro)");
check(JSON.stringify(linhasAlmoco.map((l) => l.product.price)) === JSON.stringify([36, 49.6, 30.4]), "valores por pessoa preservados: 36,00 / 49,60 / 30,40");
check(montarCarrinho(m, { produtosPorId }).cart.filter((l) => l.product.origem === ORIGEM_ALMOCO).every((l) => l.product.produtoFiscalId === null), "sem produto fiscal configurado a linha segue sem vínculo (nada é inventado)");
// itens da venda como o PDV monta
const itemVenda = (l) => ({ product_id: l.product.semEstoque ? l.product.produtoFiscalId || null : l.product.id, name: l.product.name, price: l.product.price, quantity: l.quantity, ...(l.product.origem ? { origem: l.product.origem } : {}) });
const itensComFiscal = cartFiscal.cart.map(itemVenda);
check(itensComFiscal.filter((i) => i.origem === ORIGEM_ALMOCO).every((i) => i.product_id === fiscal.id), "sales.items do almoço levam o product_id fiscal + origem");
check(itensComFiscal.filter((i) => !i.origem).every((i) => produtosPorId[i.product_id]), "produtos normais mantêm o próprio product_id e não ganham 'origem'");
const baixas = cartFiscal.cart.filter((l) => !l.product.semEstoque).map((l) => l.product.id);
check(!baixas.includes(fiscal.id) && baixas.length === 2, "baixa de estoque só dos 2 produtos normais — o produto fiscal do almoço NÃO baixa estoque");
check(c(cartFiscal.cart.reduce((s, l) => s + (l.customPrice || l.product.price) * l.quantity, 0)) === c(130), "receita da venda com produto fiscal continua 130,00 (não duplica)");
// bloqueio na emissão
const vendaSemVinculo = montarCarrinho(m, { produtosPorId }).cart.map(itemVenda);
let b = bloqueioFiscalDoAlmoco(vendaSemVinculo, {});
check(b && /Almoço por quilo/.test(b.message) && /NCM, CFOP, unidade e origem/.test(b.message) && /Mesas → Produto fiscal do almoço/.test(b.message), "sem configuração fiscal: NFC-e bloqueada com orientação clara de cadastro/configuração");
b = bloqueioFiscalDoAlmoco(itensComFiscal, { [fiscal.id]: { ...fiscal, ncm: "" } });
check(b && /incompleto/.test(b.message) && /NCM \(8 dígitos\)/.test(b.message) && /Almoço por quilo/.test(b.message), "produto fiscal sem NCM: bloqueia e diz o que falta");
b = bloqueioFiscalDoAlmoco(itensComFiscal, {});
check(b && /incompleto/.test(b.message) && /produto não encontrado/.test(b.message), "produto fiscal apagado: bloqueia");
check(bloqueioFiscalDoAlmoco(itensComFiscal, { [fiscal.id]: fiscal }) === null, "produto fiscal completo: libera a emissão");
check(bloqueioFiscalDoAlmoco([{ product_id: "p-refri", name: "Refrigerante", quantity: 1 }], {}) === null, "venda de produtos normais: nenhum bloqueio novo");
check(bloqueioFiscalDoAlmoco([], {}) === null && bloqueioFiscalDoAlmoco(undefined, {}) === null, "venda rápida/sem itens de mesa: nenhum bloqueio");
const libMesas = ler("src/lib/mesas.js");
check(!/ncm\s*[:=]\s*["']?\d/i.test(libMesas) && !/cfop\s*[:=]\s*["']?\d/i.test(libMesas), "mesas.js não contém NCM/CFOP fixos");
const fc = ler("src/lib/fiscalConfig.js");
check(/throw new Error\(bloqueio\.message\)/.test(fc) && fc.indexOf("bloqueioFiscalDoAlmoco(venda.items") < fc.indexOf('api.functions.invoke("fiscalEmit"'), "emitirDocumento bloqueia antes de chamar fiscal-emit");
check(/item\.origem === "almoco_peso"/.test(ler("src/components/sales/ReturnExchangeDialog.jsx")), "devolução ignora a linha de almoço (não devolve estoque ao produto fiscal)");

// ---------- comercial: Mesas sem cobrança/regra automática ----------
const rn = ler("src/lib/releaseNotes.js");
const blocoMesas = rn.slice(rn.indexOf('id: "mesas"'), rn.indexOf('id: "comandas"'));
check(blocoMesas.length > 0 && /priceLabel: formatAddonPrice\(ADDONS\.find\(\(a\) => a\.id === "mesas"\)\)/.test(blocoMesas), "módulo Mesas mostra o preço do adicional vindo do catálogo de planos (uma fonte só)");
check(/id: "mesas", label: "Mesas", monthlyPrice: 19\.9/.test(ler("src/lib/plans.js")) && /mesas: 19\.9/.test(ler("supabase/functions/_shared/plans.ts")), "Mesas é adicional do catálogo (frontend e espelho do servidor: R$ 19,90)");
check(!/mei: 1[^\n]*\n[^\n]*simples: 1[^\n]*mesas/.test(ler("supabase/functions/_shared/plans.ts")) && /mei: 119\.9/.test(ler("supabase/functions/_shared/plans.ts")) && /simples: 169\.9/.test(ler("supabase/functions/_shared/plans.ts")), "preços dos planos MEI/Simples intactos");

// ---------- fonte: opcional por estabelecimento / balança intacta ----------
const layout = ler("src/components/Layout.jsx");
check(/opcional: "mesas"/.test(layout) && /mesasAtivas/.test(layout), "menu Mesas só aparece quando ativado");
check(!/balan/i.test(ler("src/lib/mesas.js")) && !/balan/i.test(ler("src/pages/Mesas.jsx")), "sem integração de balança (peso manual)");

console.log(JSON.stringify({ passaram, falhas: falhas.length }));
if (falhas.length) {
  falhas.forEach((f) => console.log("FALHA:", f));
  process.exit(1);
}
console.log(`${passaram} passaram, 0 falharam`);
