// Corpo enviado à Edge Function fiscal-document (src/lib/fiscalConfig.js).
//
// O servidor valida o corpo com zod (supabase/functions/fiscal-document/index.ts, bodySchema):
// `motivo` só aceita "1", "2" ou "9" e `justificativa` só aceita texto, e os dois são opcionais,
// ou seja, podem faltar, mas NÃO podem ser null. Por isso um campo sem valor é omitido do corpo,
// nunca enviado como null (o JSON preserva o null; só undefined some).
//
// Função pura, sem dependências, para testar com Node e com Deno.

const semValor = (v) => v === null || v === undefined || v === "";

/**
 * Corpo da ação "cancelar". `motivo` só se aplica à NFS-e (o servidor ignora para NFC-e/NF-e,
 * que usam só `justificativa` no evento 110111).
 */
export function montarPayloadCancelamento({ documentId, motivo, justificativa }) {
  const payload = { action: "cancelar", document_id: documentId };
  if (!semValor(motivo)) payload.motivo = motivo;
  if (!semValor(justificativa)) payload.justificativa = justificativa;
  return payload;
}
