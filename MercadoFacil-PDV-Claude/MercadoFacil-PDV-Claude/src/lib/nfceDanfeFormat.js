// Funções puras do DANFE NFC-e — sem dependência de jsPDF/qrcode, para poder
// ser testado com Node puro (scripts/smoke-fiscal-danfe.mjs) e usado por
// nfceDanfePdf.js.

// Inverso de PAYMENT_CODES em supabase/functions/_shared/fiscal/documents.ts —
// o XML autorizado traz o código SEFAZ (tPag), não o nome do meio de pagamento.
export const TPAG_LABELS = {
  "01": "Dinheiro",
  "02": "Cheque",
  "03": "Crédito",
  "04": "Débito",
  "05": "Crédito Loja",
  "17": "PIX",
};

/** Chave de acesso em grupos de 4, como impresso no cupom oficial. */
export function formatAccessKey(key) {
  const digits = String(key || "").replace(/\D/g, "");
  return digits.replace(/(\d{4})(?=\d)/g, "$1 ");
}

export function formatCnpj(cnpj) {
  const d = String(cnpj || "").replace(/\D/g, "").padStart(14, "0");
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12, 14)}`;
}

export function extractQrCodeUrl(xml) {
  const m = String(xml || "").match(/<qrCode>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/qrCode>/s);
  return m ? m[1].trim() : null;
}

export function extractPaymentLabel(xml) {
  const tPag = String(xml || "").match(/<tPag>(\d+)<\/tPag>/)?.[1];
  return tPag ? TPAG_LABELS[tPag] || `Código ${tPag}` : null;
}

/**
 * QR Code e forma de pagamento do DANFE saem do XML que foi enviado e autorizado
 * (xml_signed, com infNFeSupl e detPag). xml_authorized guarda só a resposta SOAP da
 * SEFAZ (retEnviNFe/protNFe: protocolo e status), que não traz o <NFe>; ele fica como
 * reserva para o dia em que guardar o nfeProc completo.
 */
export function extractDanfeXmlData(document) {
  const fontes = [document?.xml_signed, document?.xml_authorized];
  const primeiro = (extrair) => fontes.map(extrair).find(Boolean) || null;
  return { qrUrl: primeiro(extractQrCodeUrl), formaPagamento: primeiro(extractPaymentLabel) };
}

/** Quando o QR Code não é achado nos XMLs do documento. Não atribui a causa ao CSC: o CSC não é consultado aqui. */
export const DANFE_SEM_QR_MENSAGEM = "QR Code não encontrado neste documento — consulte a nota pela chave de acesso";
