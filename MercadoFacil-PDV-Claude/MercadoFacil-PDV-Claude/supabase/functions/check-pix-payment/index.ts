// Consulta o status de um PIX na conta da própria loja.
import {
  corsHeaders,
  json,
  resolveCaller,
  companyToken,
  platformToken,
  parseExternalReference,
  mensagemDoMercadoPago,
  NAO_CONFIGURADO,
} from "../_shared/mercadoPago.ts";
import { rateLimited } from "../_shared/rateLimit.ts";
import { activatePlanFromCharge } from "../_shared/activatePlan.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const caller = await resolveCaller(req);
    if ("error" in caller) return json({ error: caller.error }, 401);
    const { profile, admin } = caller;

    const companyId = profile?.company_id;
    if (!companyId) return json({ error: "Usuário sem empresa vinculada" }, 400);

    // Tela de checkout pode pollar status — limite generoso pra não travar
    // um polling legítimo de alguns segundos.
    const limited = await rateLimited(admin, {
      key: `pix:check:${companyId}`,
      max: 60,
      windowSeconds: 60,
    });
    if (limited) return limited;

    const body = await req.json().catch(() => ({}));
    const paymentId = Number(body?.paymentId ?? body?.id);
    if (!Number.isInteger(paymentId) || paymentId <= 0) {
      return json({ error: "paymentId inválido" }, 400);
    }

    // A cobrança registrada diz de qual conta ela saiu; sem ela, só consulto na
    // conta da loja de quem perguntou.
    const { data: cobranca } = await admin
      .from("pix_charges")
      .select("company_id,purpose")
      .eq("payment_id", String(paymentId))
      .maybeSingle();

    if (cobranca && cobranca.company_id !== companyId) {
      return json({ approved: false, error: "Pagamento de outra loja" }, 403);
    }

    const mp = cobranca?.purpose === "platform"
      ? platformToken()
      : await companyToken(admin, companyId);
    if (!mp.token) {
      return json({ approved: false, configured: false, error: NAO_CONFIGURADO }, 503);
    }

    const response = await fetch(`${mp.apiBase}/v1/payments/${paymentId}`, {
      headers: { Authorization: `Bearer ${mp.token}` },
    });
    const payment = await response.json();
    if (!response.ok) {
      return json(
        {
          approved: false,
          status: payment?.status || "error",
          error: mensagemDoMercadoPago(response.status, payment),
        },
        response.status >= 400 && response.status < 600 ? response.status : 502,
      );
    }

    // Um pagamento só conta para quem o gerou: com o token certo o Mercado Pago
    // já não devolveria cobrança de outra conta, mas a referência confirma.
    const ref = parseExternalReference(String(payment.external_reference || ""));
    if (ref.companyId && ref.companyId !== companyId) {
      return json({ approved: false, error: "Pagamento de outra loja" }, 403);
    }

    // Polling e webhook usam a mesma função de ativação — garante que o
    // usuário vendo "aprovado" na tela já encontra o plano ativo no banco,
    // sem esperar a notificação assíncrona do Mercado Pago chegar.
    //
    // Contrato pro frontend: "approved" é só o que o Mercado Pago diz (pode
    // ser true mesmo que a ativação não tenha concluído). "activated" é a
    // verdade do banco — só true quando a RPC realmente ativou (agora ou
    // antes). Sucesso de assinatura = approved && activated, nunca approved
    // sozinho.
    let ativacao: Awaited<ReturnType<typeof activatePlanFromCharge>> | null = null;
    if (cobranca?.purpose === "platform" && payment.status === "approved") {
      ativacao = await activatePlanFromCharge(admin, String(paymentId), payment);
    }

    return json({
      approved: payment.status === "approved",
      status: payment.status,
      paymentId: payment.id,
      amount: payment.transaction_amount,
      externalReference: payment.external_reference || null,
      ...(ativacao
        ? {
            activated: ativacao.activated,
            activationReason: ativacao.reason,
          }
        : {}),
    });
  } catch (error) {
    console.error(error);
    return json({ approved: false, error: "Erro interno" }, 500);
  }
});
