// ConnectTEF — pareamento de Smart POS (só o necessário para iniciar o vínculo).
//
// O navegador nunca fala com o ConnectTEF e nunca vê a API Key: pede o QR Code a
// uma Edge Function (connecttef-pair-smartpos), que guarda a chave como secret.
// O vínculo em si chega pelo webhook (connecttef-webhook) e aparece na tabela
// connecttef_smartpos, que o navegador só lê (RLS por empresa).

import { api } from "@/api/dataClient";
import { supabase } from "@/lib/supabase";

/** Pede o QR Code de pareamento. Devolve { id, referencia, qrCode, expiresAt }. */
export async function iniciarPareamentoSmartPos(documentoCliente) {
  const res = await api.functions.invoke("connectTefPairSmartpos", { documentoCliente });
  const data = res?.data || res;
  if (data?.error) throw new Error(data.error);
  return data;
}

/** Smart POS e pareamentos da empresa, do mais novo para o mais antigo. */
export const listarSmartPos = () => api.entities.ConnectTefSmartpos.list("-created_at");

/** Estado atual de um pareamento (leitura direta, RLS por empresa). */
export async function buscarPareamento(id) {
  const rows = await api.entities.ConnectTefSmartpos.filter({ id });
  return rows?.[0] || null;
}

/**
 * Solicita a cobrança no Smart POS. Devolve { id, referencia, status, ... }: status
 * "processando" (HTTP 202) significa SÓ que o ConnectTEF aceitou — quem decide se
 * foi aprovado é o webhook; acompanhe com buscarPagamentoTef até "aprovado"/"recusado".
 * Passe `chaveIdempotencia` (um id por tentativa de cobrança) para que um retry não
 * cobre duas vezes.
 */
export async function solicitarPagamentoTef({ valorCentavos, formaPagamento, parcelas, parcelamento, smartposId, chaveIdempotencia }) {
  const res = await api.functions.invoke("connectTefRequestPayment", {
    valorCentavos, formaPagamento, parcelas, parcelamento, smartposId, chaveIdempotencia,
  });
  const data = res?.data || res;
  if (data?.error) throw new Error(data.error);
  return data;
}

/** Estado atual da operação (leitura direta, RLS por empresa). */
export async function buscarPagamentoTef(id) {
  const rows = await api.entities.ConnectTefPayment.filter({ id });
  return rows?.[0] || null;
}

/** Resultado definitivo? Só "aprovado" libera a venda; "recusado" e "falhou" não. */
export const pagamentoTefFinal = (status) => ["aprovado", "recusado", "falhou"].includes(status);

/** O QR Code ainda vale? Sem data de expiração conhecida, considera válido. */
export const qrAindaValido = (expiresAt, agora = Date.now()) => !expiresAt || new Date(expiresAt).getTime() > agora;

/** Vincula a operação aprovada à venda (RPC valida empresa, estado e valor). */
export async function vincularPagamentoTefAVenda(paymentId, saleId) {
  const { data, error } = await supabase.rpc("link_connecttef_payment_to_sale", { p_payment_id: paymentId, p_sale_id: saleId });
  if (error) throw new Error(error.message);
  return data;
}
