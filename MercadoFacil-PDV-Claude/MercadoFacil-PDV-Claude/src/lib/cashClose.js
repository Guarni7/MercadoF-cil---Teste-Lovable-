// Fechamento de caixa — cálculo puro (sem React, sem imports `@/`) para testar em Node.
//
// Fonte dos valores: os pagamentos REGISTRADOS em cada venda (sales.payments[], um item
// por forma de pagamento, com o valor líquido — sem troco), das vendas concluídas do
// caixa. Venda antiga sem payments[] cai em payment_method + total. Nada é digitado.
//
// Só o dinheiro mexe na gaveta: PIX, crédito, débito, vale presente e crédito loja são
// totais vendidos, não dinheiro físico.

export const FORMAS_FECHAMENTO = [
  { key: "dinheiro", label: "Dinheiro" },
  { key: "pix", label: "PIX" },
  { key: "credito", label: "Crédito" },
  { key: "debito", label: "Débito" },
  { key: "valepresente", label: "Vale Presente" },
  { key: "crediario", label: "Crédito Loja" },
];

const centavos = (v) => Math.round((Number(v) || 0) * 100);
const emReais = (c) => c / 100;

/** Venda que conta no caixa: concluída (status vazio = padrão do banco, "concluida"). */
export const vendaConcluida = (sale) => (sale?.status ?? "concluida") === "concluida";

/** Pagamentos registrados na venda: [{ method, amount }]. */
export function pagamentosDaVenda(sale) {
  if (Array.isArray(sale?.payments) && sale.payments.length > 0) {
    return sale.payments.map((p) => ({ method: String(p?.method || ""), amount: Number(p?.amount) || 0 }));
  }
  // Venda anterior ao detalhamento (migration 053): uma forma só, o total inteiro.
  return [{ method: String(sale?.payment_method || ""), amount: Number(sale?.total) || 0 }];
}

/**
 * Totais por forma de pagamento das vendas concluídas.
 * Forma que não está na lista fixa vai para `outros` (nunca some do total).
 * @returns {{ porForma: Record<string, number>, outros: number, total: number, vendas: number }}
 */
export function totaisPorForma(sales) {
  const conhecidas = new Set(FORMAS_FECHAMENTO.map((f) => f.key));
  const soma = Object.fromEntries(FORMAS_FECHAMENTO.map((f) => [f.key, 0]));
  let outros = 0;
  let vendas = 0;
  for (const sale of sales || []) {
    if (!vendaConcluida(sale)) continue;
    vendas++;
    for (const p of pagamentosDaVenda(sale)) {
      if (conhecidas.has(p.method)) soma[p.method] += centavos(p.amount);
      else outros += centavos(p.amount);
    }
  }
  const porForma = Object.fromEntries(Object.entries(soma).map(([k, c]) => [k, emReais(c)]));
  const total = emReais(Object.values(soma).reduce((a, b) => a + b, 0) + outros);
  return { porForma, outros: emReais(outros), total, vendas };
}

/** Dinheiro que deve estar na gaveta: abertura + vendas em dinheiro + suprimentos − sangrias − devoluções em dinheiro. */
export function esperadoNaGaveta({ abertura = 0, vendasDinheiro = 0, suprimentos = 0, sangrias = 0, devolucoesDinheiro = 0 }) {
  return emReais(centavos(abertura) + centavos(vendasDinheiro) + centavos(suprimentos) - centavos(sangrias) - centavos(devolucoesDinheiro));
}

/**
 * Resumo do caixa — a ÚNICA regra de "dinheiro esperado em caixa". O Fechar Caixa e a tela
 * do caixa aberto usam esta função, então nunca divergem.
 * @param {any} register caixa (opening_balance, supplies_total, withdrawals_total, returns_total)
 * @param {any[]} sales vendas do caixa
 */
export function resumoDoCaixa(register, sales) {
  const totais = totaisPorForma(sales);
  const base = {
    abertura: register?.opening_balance || 0,
    vendasDinheiro: totais.porForma.dinheiro || 0,
    suprimentos: register?.supplies_total || 0,
    sangrias: register?.withdrawals_total || 0,
    devolucoesDinheiro: register?.returns_total || 0,
  };
  return { ...totais, ...base, expectedInDrawer: esperadoNaGaveta(base) };
}

/**
 * Junta vendas do servidor e as do banco local deste terminal (offline / ainda sem sincronizar).
 * A mesma venda tem a mesma chave (client_id, ou id quando não há) — nunca conta duas vezes.
 */
export function unirVendas(remotas, locais) {
  const chave = (s) => s.client_id || s.id;
  const vistos = new Set((remotas || []).map(chave));
  return [...(remotas || []), ...(locais || []).filter((s) => !vistos.has(chave(s)))];
}

/**
 * Lê todas as páginas de uma consulta limitada (PostgREST devolve no máximo 1000 linhas).
 * buscarPagina(de, ate) → linhas; para quando uma página vem menor que o tamanho.
 */
export async function lerTodasAsPaginas(buscarPagina, tamanho = 1000) {
  const todas = [];
  for (let de = 0; ; de += tamanho) {
    const linhas = (await buscarPagina(de, de + tamanho - 1)) || [];
    todas.push(...linhas);
    if (linhas.length < tamanho) return todas;
  }
}
