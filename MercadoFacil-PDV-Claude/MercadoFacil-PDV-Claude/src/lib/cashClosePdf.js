import { jsPDF } from "jspdf";
import { formatBRL } from "@/lib/format";

/**
 * Gera e baixa o PDF do fechamento de caixa (formato cupim).
 * @param {Object} params
 * @param {Object} params.register - Registro do caixa
 * @param {Object} params.totals - { salesDinheiro, suprimentos, sangrias, devolucoesDinheiro, expectedInDrawer, totalVendido, qtdVendas, methodTotals, outros } — tudo calculado pelo sistema
 * @param {Array} params.movements - Lista de movimentações [{ time, type, amount }]
 * @param {string} params.operatorName - Nome do operador
 */
export function generateCashClosePdf({
  register,
  totals,
  movements = [],
  operatorName = "—",
}) {
  const doc = new jsPDF({ unit: "mm", format: [80, 200] });
  const W = 80;
  const ML = 4; // margin left
  const MR = 4; // margin right
  const CW = W - ML - MR; // content width
  let y = 6;
  const lh = 3.6;

  const dashed = () => {
    doc.setLineDashPattern([0.4, 0.6], 0);
    doc.setLineWidth(0.1);
    doc.line(ML, y, W - MR, y);
    doc.setLineDashPattern([], 0);
    y += lh * 0.7;
  };
  const solid = () => {
    doc.setLineDashPattern([], 0);
    doc.setLineWidth(0.2);
    doc.line(ML, y, W - MR, y);
    y += lh * 0.7;
  };
  const center = (text, opts = {}) => {
    doc.setFont("courier", opts.bold ? "bold" : "normal");
    doc.setFontSize(opts.size || 8);
    doc.text(text, W / 2, y, { align: "center" });
    y += lh;
  };
  const row = (label, value, opts = {}) => {
    doc.setFont("courier", opts.bold ? "bold" : "normal");
    doc.setFontSize(opts.size || 8);
    doc.text(label, ML, y);
    doc.text(value, W - MR, y, { align: "right" });
    y += lh;
  };

  // Cabeçalho
  center((operatorName || "—").toUpperCase(), { bold: true, size: 9 });
  center("FECHAMENTO DE CAIXA", { bold: true, size: 9 });
  dashed();

  const fmtDt = (d) => {
    if (!d) return "—";
    return new Date(d).toLocaleString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  };
  row("Abertura:", fmtDt(register?.opened_at));
  row("Fechamento:", fmtDt(register?.closed_at || new Date()));
  row("Operador:", operatorName || "—");
  dashed();

  // Resumo
  center("RESUMO", { bold: true });
  row("Valor Abertura:", formatBRL(register?.opening_balance || 0));
  row("(+) Vendas em dinheiro:", formatBRL(totals.salesDinheiro || 0));
  row("(+) Suprimentos:", formatBRL(totals.suprimentos || 0));
  row("(-) Sangrias:", formatBRL(totals.sangrias || 0));
  if ((totals.devolucoesDinheiro || 0) > 0) {
    row("(-) Devolucoes em dinheiro:", formatBRL(totals.devolucoesDinheiro));
  }
  solid();
  row("ESPERADO EM CAIXA (DINHEIRO):", formatBRL(totals.expectedInDrawer || 0), { bold: true });
  dashed();

  // Total vendido por forma de pagamento (calculado, vindo dos pagamentos das vendas)
  center("VENDAS POR FORMA DE PAGAMENTO", { bold: true });
  const formas = [
    ["Dinheiro", "dinheiro"], ["PIX", "pix"], ["Credito", "credito"], ["Debito", "debito"],
    ["Vale Presente", "valepresente"], ["Credito Loja", "crediario"],
  ];
  formas.forEach(([label, key]) => row(`${label}:`, formatBRL(totals.methodTotals?.[key] || 0)));
  if ((totals.outros || 0) > 0) row("Outras formas:", formatBRL(totals.outros));
  solid();
  row(`TOTAL VENDIDO (${totals.qtdVendas || 0}):`, formatBRL(totals.totalVendido || 0), { bold: true });
  dashed();

  // Movimentações
  center("MOVIMENTAÇÕES", { bold: true });
  if (movements.length === 0) {
    center("Sem movimentações.", { size: 7 });
  } else {
    movements.forEach((mv) => {
      const sign = mv.type === "sangria" ? "-" : "+";
      row(
        `${mv.time || ""} (${sign})`,
        formatBRL(mv.amount || 0),
        { size: 7 }
      );
    });
  }
  dashed();

  doc.save(`fechamento-caixa-${Date.now()}.pdf`);
}