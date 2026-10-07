// Ativação de assinatura a partir de uma cobrança PIX aprovada (purpose
// "platform"). Chamada tanto pelo webhook do Mercado Pago quanto pelo
// polling de check-pix-payment — mesma função, mesma fonte de verdade, nunca
// duas lógicas de ativação divergentes.
//
// Toda a mutação (gravar activated_at + atualizar companies + profiles)
// acontece dentro da RPC `activate_plan_subscription` (migration 067), numa
// única transação Postgres com `select ... for update` travando a linha da
// cobrança. Isto não faz escritas independentes por conta própria — nunca
// reintroduzir esse padrão aqui, é exatamente o que causava estado parcial
// (activated_at gravado sem companies atualizado) quando uma das 3 escritas
// falhava no meio.
import { adminClient } from "./mercadoPago.ts";

export type PagamentoMP = {
  status: string;
  transaction_amount: number;
};

export type ResultadoAtivacao =
  | { activated: true; reason: "activated" | "already_activated"; planId: string | null; planExpiresAt: string | null }
  | {
      activated: false;
      reason: "not_approved" | "not_a_subscription_charge" | "amount_mismatch" | "charge_not_found";
    };

type RpcRow = {
  activated: boolean;
  reason: string;
  company_id: string | null;
  plan_id: string | null;
  plan_expires_at: string | null;
};

export async function activatePlanFromCharge(
  admin: ReturnType<typeof adminClient>,
  paymentId: string,
  payment: PagamentoMP,
): Promise<ResultadoAtivacao> {
  const { data, error } = await admin
    .rpc("activate_plan_subscription", {
      p_payment_id: paymentId,
      p_mp_status: payment.status,
      p_mp_amount: payment.transaction_amount,
    })
    .single<RpcRow>();
  if (error) throw error;

  if (data.activated) {
    return {
      activated: true,
      reason: data.reason as "activated" | "already_activated",
      planId: data.plan_id,
      planExpiresAt: data.plan_expires_at,
    };
  }
  return {
    activated: false,
    reason: data.reason as "not_approved" | "not_a_subscription_charge" | "amount_mismatch" | "charge_not_found",
  };
}
