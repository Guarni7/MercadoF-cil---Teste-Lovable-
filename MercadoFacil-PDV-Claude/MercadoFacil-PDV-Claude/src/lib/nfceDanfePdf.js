// DANFE NFC-e — representação visual da nota autorizada pela SEFAZ.
//
// Diferente de cashClosePdf.js (fechamento de caixa, documento interno sem
// valor fiscal), este PDF só existe para um fiscal_documents com status
// "authorized": os dados vêm do que o autorizador confirmou (chave, protocolo,
// QR Code assinado), nunca de um cálculo feito aqui de novo.
import { jsPDF } from "jspdf";
import QRCode from "qrcode";
import { formatBRL } from "@/lib/format";
import { DANFE_SEM_QR_MENSAGEM, extractDanfeXmlData, formatAccessKey, formatCnpj } from "@/lib/nfceDanfeFormat";

/**
 * @param {Object} params
 * @param {Object} params.document - Linha de fiscal_documents (status "authorized").
 * @param {Object} params.settings - company_fiscal_settings da empresa emitente.
 */
export async function generateNfceDanfePdf({ document, settings }) {
  if (document?.status !== "authorized") {
    throw new Error("Só é possível gerar o DANFE de uma NFC-e autorizada pela SEFAZ");
  }

  // QR Code e forma de pagamento vêm do XML enviado (xml_signed); xml_authorized é só a resposta da SEFAZ.
  const { qrUrl, formaPagamento } = extractDanfeXmlData(document);
  const doc = new jsPDF({ unit: "mm", format: [80, 250] });
  const W = 80;
  const ML = 4;
  const MR = 4;
  let y = 6;
  const lh = 3.6;

  const dashed = () => {
    doc.setLineDashPattern([0.4, 0.6], 0);
    doc.setLineWidth(0.1);
    doc.line(ML, y, W - MR, y);
    doc.setLineDashPattern([], 0);
    y += lh * 0.7;
  };
  const center = (text, opts = {}) => {
    doc.setFont("courier", opts.bold ? "bold" : "normal");
    doc.setFontSize(opts.size || 8);
    const lines = doc.splitTextToSize(text, W - ML - MR);
    lines.forEach((line) => {
      doc.text(line, W / 2, y, { align: "center" });
      y += lh;
    });
  };
  const row = (label, value, opts = {}) => {
    doc.setFont("courier", opts.bold ? "bold" : "normal");
    doc.setFontSize(opts.size || 7.5);
    doc.text(label, ML, y);
    doc.text(value, W - MR, y, { align: "right" });
    y += lh;
  };
  const left = (text, opts = {}) => {
    doc.setFont("courier", opts.bold ? "bold" : "normal");
    doc.setFontSize(opts.size || 7.5);
    const lines = doc.splitTextToSize(text, W - ML - MR);
    lines.forEach((line) => {
      doc.text(line, ML, y);
      y += lh;
    });
  };

  // Cabeçalho do emitente
  center((settings?.trade_name || settings?.legal_name || "").toUpperCase(), { bold: true, size: 9 });
  center(`CNPJ ${formatCnpj(settings?.cnpj)}`, { size: 7 });
  if (settings?.address) {
    center(
      `${settings.address}, ${settings.address_number || "S/N"} - ${settings.neighborhood || ""} - ${settings.city_name || ""}/${settings.uf || ""}`,
      { size: 7 },
    );
  }
  dashed();

  if (document.environment === "homologacao") {
    center("AMBIENTE DE HOMOLOGAÇÃO", { bold: true, size: 8 });
    center("SEM VALOR FISCAL", { bold: true, size: 8 });
    dashed();
  }

  center("DANFE NFC-e", { bold: true, size: 9 });
  center("Documento Auxiliar da Nota Fiscal de Consumidor Eletrônica", { size: 6.5 });
  dashed();

  // Itens
  const itens = Array.isArray(document.items) ? document.items : [];
  itens.forEach((item) => {
    left(item.name || "Item", { bold: true, size: 7.5 });
    row(
      `${Number(item.quantity || 0).toFixed(3)} x ${formatBRL(item.price || 0)}`,
      formatBRL(item.total || 0),
      { size: 7 },
    );
  });
  dashed();

  const total = itens.reduce((acc, i) => acc + Number(i.total || 0), 0);
  row("TOTAL", formatBRL(total), { bold: true, size: 9 });
  if (formaPagamento) row("Forma de pagamento", formaPagamento, { size: 7 });
  dashed();

  // Identificação oficial
  center(`NFC-e nº ${document.number || "—"}  Série ${document.series || "—"}`, { size: 7.5, bold: true });
  left(`Chave de acesso:`, { size: 6.5 });
  center(formatAccessKey(document.access_key), { size: 6.5 });
  dashed();
  left(`Protocolo de autorização: ${document.protocol || "—"}`, { size: 6.5 });
  left(
    `Data/hora autorização: ${document.authorized_at ? new Date(document.authorized_at).toLocaleString("pt-BR") : "—"}`,
    { size: 6.5 },
  );
  dashed();

  // QR Code
  if (qrUrl) {
    const qrDataUrl = await QRCode.toDataURL(qrUrl, { margin: 0, width: 300 });
    const qrSize = 32;
    doc.addImage(qrDataUrl, "PNG", (W - qrSize) / 2, y, qrSize, qrSize);
    y += qrSize + 2;
    center("Consulte pela Chave de Acesso em:", { size: 6 });
    center(qrUrl.split("?")[0], { size: 6 });
  } else {
    center(DANFE_SEM_QR_MENSAGEM, { size: 6 });
  }

  return doc;
}

/** Gera e abre o DANFE em nova aba. */
export async function abrirNfceDanfePdf(params) {
  const doc = await generateNfceDanfePdf(params);
  const chave = params.document?.access_key || "nfce";
  doc.save(`DANFE-NFCe-${chave}.pdf`);
}
