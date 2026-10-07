import { toast } from "sonner";

/**
 * Exportação das tabelas de relatório.
 *
 * Os botões CSV/XLSX/PDF existiam sem handler nenhum: clicar não fazia nada e
 * não havia erro — o lojista concluía que o sistema estava travado.
 *
 * `colunas`: ["Venda", "Cliente", ...]
 * `linhas`:  [["#1", "Maria", ...], ...]
 */

function baixar(blob, arquivo) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = arquivo;
  a.click();
  URL.revokeObjectURL(url);
}

const carimbo = () => new Date().toISOString().slice(0, 10);

export function exportarCSV({ nome, colunas, linhas }) {
  if (!linhas?.length) {
    toast.info("Nada para exportar no filtro atual.");
    return;
  }
  const escapar = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const csv = [colunas, ...linhas].map((r) => r.map(escapar).join(";")).join("\n");
  // BOM: sem ele o Excel em pt-BR abre acentuação quebrada.
  baixar(new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" }), `${nome}_${carimbo()}.csv`);
  toast.success("CSV exportado.");
}

export async function exportarXLSX({ nome, colunas, linhas }) {
  if (!linhas?.length) {
    toast.info("Nada para exportar no filtro atual.");
    return;
  }
  try {
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(nome.slice(0, 31));
    ws.addRow(colunas);
    linhas.forEach((linha) => ws.addRow(linha));
    const buffer = await wb.xlsx.writeBuffer();
    baixar(
      new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
      `${nome}_${carimbo()}.xlsx`,
    );
    toast.success("XLSX exportado.");
  } catch (e) {
    console.error("Erro ao exportar XLSX:", e);
    toast.error(`Falha ao gerar XLSX: ${e?.message || e}`);
  }
}

/** @param {{ nome: string, titulo?: string, colunas: string[], linhas: any[], subtitulo?: string }} params */
export async function exportarPDF({ nome, titulo, colunas, linhas, subtitulo }) {
  if (!linhas?.length) {
    toast.info("Nada para exportar no filtro atual.");
    return;
  }
  try {
    const { jsPDF } = await import("jspdf");
    const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "landscape" });
    const ML = 10;
    const larguraUtil = 297 - ML * 2;
    const colW = larguraUtil / colunas.length;
    let y = 14;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.text(titulo || nome, ML, y);
    y += 5;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.text(
      subtitulo || `Gerado em ${new Date().toLocaleString("pt-BR")} · ${linhas.length} registro(s)`,
      ML,
      y,
    );
    y += 6;

    const cabecalho = () => {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      colunas.forEach((c, i) => doc.text(String(c), ML + i * colW, y, { maxWidth: colW - 2 }));
      y += 3;
      doc.setLineWidth(0.2);
      doc.line(ML, y, ML + larguraUtil, y);
      y += 4;
      doc.setFont("helvetica", "normal");
    };

    cabecalho();
    linhas.forEach((linha) => {
      if (y > 195) {
        doc.addPage();
        y = 14;
        cabecalho();
      }
      linha.forEach((v, i) =>
        doc.text(String(v ?? ""), ML + i * colW, y, { maxWidth: colW - 2 }),
      );
      y += 5;
    });

    doc.save(`${nome}_${carimbo()}.pdf`);
    toast.success("PDF exportado.");
  } catch (e) {
    console.error("Erro ao exportar PDF:", e);
    toast.error(`Falha ao gerar PDF: ${e?.message || e}`);
  }
}
