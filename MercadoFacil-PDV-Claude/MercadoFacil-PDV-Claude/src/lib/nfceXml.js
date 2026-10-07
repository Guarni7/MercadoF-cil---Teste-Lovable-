// XML autorizado completo da NFC-e (nfeProc) para download pelo cliente e pelo contador.
//
// Notas autorizadas depois desta mudança guardam o nfeProc em fiscal_documents.xml_authorized
// (NFe enviada + protNFe da SEFAZ, montado em supabase/functions/_shared/fiscal/nfeProc.ts).
// Notas anteriores guardam só a resposta SOAP da SEFAZ, que não é um XML de nota fiscal: para
// elas o download fica indisponível até o backfill (scripts/backfill-nfeproc.ts).
//
// Funções puras, sem dependência de React, para testar com Node (scripts/smoke-fiscal-nfeproc.mjs).

export const MSG_XML_INDISPONIVEL = "XML completo indisponível para esta nota";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** O texto é um nfeProc (e não a resposta SOAP da SEFAZ de notas antigas)? */
export function ehNfeProc(xml) {
  return /^\s*(<\?xml[^>]*\?>\s*)?<nfeProc[\s>]/.test(String(xml || ""));
}

/** `<chave-de-acesso>.xml`; null se a chave não tiver os 44 dígitos. */
export function nomeArquivoXml(doc) {
  const chave = String(doc?.access_key || "").replace(/\D/g, "");
  return chave.length === 44 ? `${chave}.xml` : null;
}

/** NFC-e (65) autorizada, com nfeProc e chave: só nesse caso há XML autorizado completo. */
export function xmlDisponivel(doc) {
  return doc?.model === "65" && doc?.status === "authorized" && ehNfeProc(doc?.xml_authorized) && !!nomeArquivoXml(doc);
}

/** Baixa o nfeProc como `<chave>.xml`. Lança erro se o documento não tiver XML autorizado completo. */
export function baixarXmlNfce(doc) {
  if (!xmlDisponivel(doc)) throw new Error(MSG_XML_INDISPONIVEL);
  const blob = new Blob([doc.xml_authorized], { type: "application/xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nomeArquivoXml(doc);
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * NFC-e autorizada da venda, ou null. Usa a API normal (RLS por empresa): outra empresa nunca
 * enxerga a nota. Venda offline ainda sem UUID de servidor não tem nota.
 */
export async function buscarNfceAutorizadaDaVenda(api, saleId) {
  if (!UUID.test(String(saleId || ""))) return null;
  const docs = await api.entities.FiscalDocument.filter({ sale_id: saleId, status: "authorized", model: "65" });
  return docs?.[0] || null;
}
