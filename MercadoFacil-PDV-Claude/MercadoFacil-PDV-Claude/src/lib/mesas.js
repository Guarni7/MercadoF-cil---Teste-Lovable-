// Atendimento por mesa/comanda — regras puras (sem React, sem imports `@/`) para testar em Node.
//
// Um atendimento (tabela table_orders) tem:
//   people[] — almoço por peso, uma entrada por pessoa: { id, label, peso, preco_kg, valor, manual, paga }
//              peso (kg) × preço/kg = valor. `manual` = valor ajustado à mão (não recalcula mais).
//   items[]  — produtos normais: { id, product_id, name, price, quantity, paga }
//
// Pessoa NÃO é produto: no pagamento ela vira uma linha avulsa do carrinho do PDV (semEstoque), com o peso e o
// preço/kg na observação da linha. Quem cria a venda, baixa estoque e soma receita é o checkout do PDV — aqui só
// se monta o carrinho e se marca o que foi pago.

const cent = (v) => Math.round((Number(v) || 0) * 100);
const reais = (c) => c / 100;
export const roundMoney = (v) => Math.round((Number(v) || 0) * 100) / 100;

const novoId = () => globalThis.crypto.randomUUID();

/** peso (kg) × preço/kg, arredondado ao centavo. */
export const valorPorPeso = (pesoKg, precoKg) => roundMoney((Number(pesoKg) || 0) * (Number(precoKg) || 0));

export function novaPessoa({ label = "", precoKg = 0, peso = 0 } = {}) {
  return { id: novoId(), label, peso, preco_kg: precoKg, valor: valorPorPeso(peso, precoKg), manual: false, paga: false };
}

/**
 * Altera uma pessoa. Mudar peso/preço recalcula o valor, a menos que o valor tenha sido ajustado à mão;
 * informar `valor` marca como manual; `manual: false` volta ao cálculo automático.
 */
export function atualizarPessoa(pessoa, patch) {
  const n = { ...pessoa, ...patch };
  if ("valor" in patch && !("manual" in patch)) n.manual = true;
  n.valor = n.manual ? roundMoney(n.valor) : valorPorPeso(n.peso, n.preco_kg);
  return n;
}

/** Remove a pessoa; pessoa já paga não sai (a venda dela já existe). */
export function removerPessoa(people, id) {
  const p = (people || []).find((x) => x.id === id);
  if (!p) return people || [];
  if (p.paga) throw new Error("Pessoa já paga não pode ser removida.");
  return people.filter((x) => x.id !== id);
}

/** Soma um produto ao atendimento (mesmo produto ainda não pago acumula quantidade). */
export function adicionarProduto(items, product, quantity = 1) {
  const lista = items || [];
  const existente = lista.find((i) => i.product_id === product.id && !i.paga);
  if (existente) {
    return lista.map((i) => (i === existente ? { ...i, quantity: i.quantity + quantity } : i));
  }
  return [...lista, { id: novoId(), product_id: product.id, name: product.name, price: Number(product.price) || 0, quantity, paga: false }];
}

export function removerProduto(items, id) {
  const i = (items || []).find((x) => x.id === id);
  if (i?.paga) throw new Error("Item já pago não pode ser removido.");
  return (items || []).filter((x) => x.id !== id);
}

export const valorItem = (i) => roundMoney((Number(i.price) || 0) * (Number(i.quantity) || 0));

const soma = (valores) => reais(valores.reduce((s, v) => s + cent(v), 0));

/** Totais do atendimento; `pendente` = o que ainda falta pagar. */
export function totaisDaMesa(order) {
  const people = order?.people || [];
  const items = order?.items || [];
  const pessoas = soma(people.map((p) => p.valor));
  const produtos = soma(items.map(valorItem));
  const pendente = soma([...people.filter((p) => !p.paga).map((p) => p.valor), ...items.filter((i) => !i.paga).map(valorItem)]);
  return { pessoas, produtos, total: reais(cent(pessoas) + cent(produtos)), pendente, qtdPessoas: people.length, qtdItens: items.length };
}

/** LIVRE (sem atendimento aberto) ou OCUPADA. */
export const statusDaMesa = (order) => (order && order.status === "aberta" ? "ocupada" : "livre");

const fmtKg = (kg) => `${(Number(kg) || 0).toFixed(3).replace(".", ",")} kg`;
const fmtBRL = (v) => `R$ ${(Number(v) || 0).toFixed(2).replace(".", ",")}`;

/** Texto da linha de peso: vai para sales.items[].notes. */
export const descricaoPeso = (p) =>
  `${fmtKg(p.peso)} × ${fmtBRL(p.preco_kg)}/kg${p.manual ? " (valor ajustado)" : ""}`;

/** Marca gravada em sales.items[].origem nas linhas de almoço por peso (fiscal e devolução reconhecem por ela). */
export const ORIGEM_ALMOCO = "almoco_peso";

// Mesma definição de "produto fiscal completo" de fiscal-nfce-config: NCM de 8 dígitos + CFOP + unidade + origem.
// Só confere o que está no cadastro — nada de NCM/CFOP é inventado ou preenchido aqui.
const vazio = (v) => v === null || v === undefined || String(v).trim() === "";
export function faltandoNoProdutoFiscal(product) {
  if (!product) return ["produto não encontrado"];
  const falta = [];
  if (!/^\d{8}$/.test(String(product.ncm ?? ""))) falta.push("NCM (8 dígitos)");
  if (vazio(product.cfop)) falta.push("CFOP");
  if (vazio(product.unit)) falta.push("unidade");
  if (vazio(product.origin)) falta.push("origem");
  return falta;
}
export const produtoFiscalValido = (product) => faltandoNoProdutoFiscal(product).length === 0;

/**
 * Linha de carrinho do PDV para uma pessoa: avulsa (sem estoque). `produtoFiscal` (opcional) é o produto da empresa,
 * ex. "Almoço por quilo", que fornece os dados fiscais; a pessoa continua sendo uma linha própria, nunca um produto.
 */
export function linhaDaPessoa(p, produtoFiscal = null) {
  return {
    product: {
      id: `mesa-pessoa-${p.id}`,
      name: p.label ? `Almoço por peso — ${p.label}` : "Almoço por peso",
      price: p.valor,
      stock: 1,
      unit: "UN",
      semEstoque: true,
      mesaPessoaId: p.id,
      origem: ORIGEM_ALMOCO,
      produtoFiscalId: produtoFiscal?.id || null,
    },
    quantity: 1,
    notes: descricaoPeso(p),
  };
}

/**
 * Monta o carrinho do PDV com o que será cobrado agora (pessoas/itens pendentes escolhidos; sem seleção = tudo
 * que está pendente). `produtosPorId` traz o produto completo (estoque etc.); item cujo produto sumiu vai em `faltando`.
 */
/** @param {any} order @param {{ pessoaIds?: string[], itemIds?: string[], produtosPorId?: Record<string, any>, produtoFiscal?: any }} [opts] */
export function montarCarrinho(order, { pessoaIds, itemIds, produtosPorId = {}, produtoFiscal = null } = {}) {
  const todos = !pessoaIds && !itemIds;
  const querP = (p) => !p.paga && (todos || (pessoaIds || []).includes(p.id));
  const querI = (i) => !i.paga && (todos || (itemIds || []).includes(i.id));
  const pessoas = (order?.people || []).filter(querP);
  const itens = (order?.items || []).filter(querI);
  const cart = pessoas.map((p) => linhaDaPessoa(p, produtoFiscal));
  const faltando = [];
  for (const i of itens) {
    const product = produtosPorId[i.product_id];
    if (!product) {
      faltando.push(i.name);
      continue;
    }
    const linha = { product, quantity: i.quantity };
    if (roundMoney(i.price) !== roundMoney(product.price)) linha.customPrice = i.price;
    cart.push(linha);
  }
  return {
    cart,
    faltando,
    pessoaIds: pessoas.map((p) => p.id),
    itemIds: itens.map((i) => i.id),
    total: soma([...pessoas.map((p) => p.valor), ...itens.map(valorItem)]),
  };
}

/**
 * Resultado de uma venda paga: marca pessoas/itens como pagos, guarda o id da venda e, quando não sobra nada
 * pendente, fecha o atendimento (mesa volta a LIVRE). Idempotente para o mesmo saleId.
 */
/** @param {any} order @param {{ pessoaIds?: string[], itemIds?: string[], saleId?: string | null, agora?: string }} [opts] */
export function aplicarPagamento(order, { pessoaIds = [], itemIds = [], saleId = null, agora = new Date().toISOString() } = {}) {
  const people = (order.people || []).map((p) => (pessoaIds.includes(p.id) ? { ...p, paga: true } : p));
  const items = (order.items || []).map((i) => (itemIds.includes(i.id) ? { ...i, paga: true } : i));
  const sale_ids = saleId && !(order.sale_ids || []).includes(saleId) ? [...(order.sale_ids || []), saleId] : order.sale_ids || [];
  const pendente = people.some((p) => !p.paga) || items.some((i) => !i.paga);
  const fechou = !pendente && (people.length > 0 || items.length > 0);
  return { ...order, people, items, sale_ids, status: fechou ? "fechada" : order.status, closed_at: fechou ? order.closed_at || agora : order.closed_at || null };
}

/** Divide um valor em N partes iguais ao centavo (as sobras vão para as primeiras partes); a soma é exata. */
export function dividirIgual(total, partes) {
  const n = Math.max(1, Math.floor(Number(partes) || 1));
  const c = cent(total);
  const base = Math.floor(c / n);
  const resto = c - base * n;
  return Array.from({ length: n }, (_, i) => reais(base + (i < resto ? 1 : 0)));
}

const ORIENTACAO = "Cadastre o produto \"Almoço por quilo\" (com NCM, CFOP, unidade e origem) em Produtos e selecione-o em Mesas → Produto fiscal do almoço.";

/**
 * Antes de emitir NFC-e/NF-e: as linhas de almoço por peso da venda precisam estar ligadas a um produto fiscal
 * completo da empresa. Sem isso a nota NÃO é emitida (não existe NCM/CFOP "padrão"). Venda sem almoço por peso → null.
 * @param {any[]} saleItems sales.items  @param {Record<string, any>} produtosPorId produtos (por id) dos itens ligados
 * @returns {{ message: string } | null}
 */
export function bloqueioFiscalDoAlmoco(saleItems, produtosPorId = {}) {
  const linhas = (saleItems || []).filter((i) => i?.origem === ORIGEM_ALMOCO);
  if (linhas.length === 0) return null;
  if (linhas.some((i) => !i.product_id)) {
    return { message: `Esta venda tem almoço por peso sem produto fiscal vinculado, então a NFC-e não pode ser emitida. ${ORIENTACAO}` };
  }
  for (const id of [...new Set(linhas.map((i) => i.product_id))]) {
    const p = produtosPorId[id];
    const falta = faltandoNoProdutoFiscal(p);
    if (falta.length) {
      const nome = p?.name ? `"${p.name}"` : "vinculado ao almoço por peso";
      return { message: `O produto fiscal ${nome} está incompleto (falta: ${falta.join(", ")}), então a NFC-e não pode ser emitida. Complete o cadastro em Produtos.` };
    }
  }
  return null;
}

/** Nome do atendimento na tela e nas mensagens: "Cartão 023" (comanda) ou "Mesa 5" (atendimento de mesa). */
export function rotuloDoAtendimento(order) {
  if (order?.card_number) return `Cartão ${String(order.card_number).padStart(3, "0")}`;
  return `Mesa ${order?.table_number ?? ""}`.trim();
}

/**
 * Abre a mesa se estiver LIVRE ou devolve o atendimento existente se estiver OCUPADA — nunca cria um segundo.
 * `store` isola o acesso ao banco: { buscarAberto(numero) → atendimento|null, criar(numero) → atendimento }.
 * Se outro caixa abrir a mesma mesa no meio (índice único recusa), busca de novo e devolve o existente.
 * @returns {Promise<{ acao: "abrir" | "ver", order: any }>}
 */
export async function abrirOuVerAtendimento(store, numero) {
  const existente = await store.buscarAberto(numero);
  if (existente) return { acao: "ver", order: existente };
  try {
    return { acao: "abrir", order: await store.criar(numero) };
  } catch (e) {
    const agora = await store.buscarAberto(numero);
    if (agora) return { acao: "ver", order: agora };
    throw e;
  }
}

/**
 * Faixa de mesas (ex.: 1 até 10) → ["1", ..., "10"]. Só números 1..200 (o QR da mesa usa esse intervalo).
 * @returns {any} { ok: true, numeros } ou { ok: false, erro }
 */
export function faixaDeMesas(de, ate) {
  const a = Number(String(de).trim());
  const b = Number(String(ate).trim());
  const inteiro = (n) => Number.isInteger(n) && n >= 1 && n <= 200;
  if (!inteiro(a) || !inteiro(b)) return { ok: false, erro: "Informe números inteiros de 1 a 200." };
  if (a > b) return { ok: false, erro: "O número inicial não pode ser maior que o final." };
  return { ok: true, numeros: Array.from({ length: b - a + 1 }, (_, i) => String(a + i)) };
}

/** Só as mesas que ainda não existem (criar faixa repetida não duplica). */
export const mesasNovas = (numeros, cadastradas) => {
  const ja = new Set((cadastradas || []).map(String));
  return numeros.filter((n) => !ja.has(String(n)));
};

/**
 * Remoção de faixa: remove só mesas cadastradas e SEM atendimento aberto; mesa ocupada fica (e é avisada).
 * @returns {{ remover: string[], ocupadas: string[], inexistentes: string[] }}
 */
export function planejarRemocao(numeros, cadastradas, ocupadas) {
  const cad = new Set((cadastradas || []).map(String));
  const oc = new Set((ocupadas || []).map(String));
  const remover = [], ocup = [], inexistentes = [];
  for (const n of numeros.map(String)) {
    if (!cad.has(n)) inexistentes.push(n);
    else if (oc.has(n)) ocup.push(n);
    else remover.push(n);
  }
  return { remover, ocupadas: ocup, inexistentes };
}

const porNumero = (a, b) => (Number(a) - Number(b)) || String(a).localeCompare(String(b));

/**
 * Mesas exibidas: as cadastradas + qualquer mesa com atendimento aberto (nunca some uma mesa em uso).
 * `cadastradas === null` = cadastro indisponível (migration ainda não aplicada): usa 1..quantidade como antes.
 */
export function mesasParaExibir(cadastradas, abertas, quantidadePadrao = 10) {
  const base = cadastradas === null
    ? Array.from({ length: Math.max(1, Number(quantidadePadrao) || 1) }, (_, i) => String(i + 1))
    : cadastradas.map(String);
  const extras = (abertas || []).map(String).filter((n) => !base.includes(n));
  return [...new Set([...base, ...extras])].sort(porNumero);
}

/** Resumo do cabeçalho: total, livres e ocupadas. */
export function resumoDasMesas(numeros, abertas) {
  const oc = new Set((abertas || []).map(String));
  const ocupadas = numeros.filter((n) => oc.has(String(n))).length;
  return { total: numeros.length, ocupadas, livres: numeros.length - ocupadas };
}

/**
 * Código curto do atendimento ("Cód. 313144"): 6 dígitos derivados do id do atendimento, sempre os mesmos para o mesmo
 * atendimento (nada é gravado) e diferentes entre atendimentos. Serve para o operador identificar/conferir a conta.
 */
export function codigoDoAtendimento(order) {
  const id = String(order?.id ?? "");
  if (!id) return "";
  let h = 0x811c9dc5; // FNV-1a 32 bits
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return String(100000 + (h % 900000));
}

/** "172 min · aberta" ou "91 min · último pedido" (há itens lançados). Minutos desde a abertura. */
export function tempoEStatusDaMesa(order, agora = Date.now()) {
  const abertura = order?.created_at ? new Date(order.created_at).getTime() : agora;
  const min = Math.max(0, Math.round((agora - abertura) / 60000));
  const temItens = (order?.items || []).length > 0;
  return `${min} min · ${temItens ? "último pedido" : "aberta"}`;
}
