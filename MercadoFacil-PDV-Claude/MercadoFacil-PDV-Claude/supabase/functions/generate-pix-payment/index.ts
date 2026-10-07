// Gera cobrança PIX na conta Mercado Pago da própria loja.
//
// Antes o token vinha de um Secret global (todo pagamento cairia na mesma conta)
// ou do corpo da requisição (token trafegando a partir do navegador). Agora sai
// de company_payment_secrets, resolvido pela empresa de quem chamou.
import {
  corsHeaders,
  json,
  resolveCaller,
  companyToken,
  platformToken,
  buildExternalReference,
  mensagemDoMercadoPago,
  NAO_CONFIGURADO,
  PLATAFORMA_NAO_CONFIGURADA,
} from "../_shared/mercadoPago.ts";
import { rateLimited } from "../_shared/rateLimit.ts";
import { calcPlanMonthlyTotal, PlanInputError } from "../_shared/plans.ts";
import { z } from "https://esm.sh/zod@3.23.8";

const bodySchema = z.object({
  // Venda PDV (purpose "sale", default): valor vem do carrinho já calculado
  // no front — fluxo existente, intocado.
  amount: z.number().positive().max(50000).optional(),
  description: z.string().trim().max(200).optional(),
  externalReference: z.string().trim().max(200).optional(),
  purpose: z.enum(["platform"]).optional(),
  // Assinatura/addon (purpose "platform"): o valor é sempre recalculado no
  // servidor a partir de planId/addonIds — nunca confia em "amount" do
  // client pra esse caso.
  planId: z.enum(["mei", "simples"]).optional(),
  addonIds: z.array(z.string().trim().max(50)).max(10).optional(),
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const caller = await resolveCaller(req);
    if ("error" in caller) return json({ error: caller.error }, 401);
    const { user, profile, admin } = caller;

    const companyId = profile?.company_id;
    if (!companyId) return json({ error: "Usuário sem empresa vinculada" }, 400);

    // Cada cobrança gerada chama o Mercado Pago (custo real por chamada) —
    // 30/min por loja cobre uma correria de caixa com folga, sem abrir para
    // automação disparando cobranças sem parar.
    const limited = await rateLimited(admin, {
      key: `pix:gen:${companyId}`,
      max: 30,
      windowSeconds: 60,
    });
    if (limited) return limited;

    const rawBody = await req.json().catch(() => ({}));
    const parsed = bodySchema.safeParse(rawBody);
    if (!parsed.success) {
      return json({ error: "Dados inválidos", details: parsed.error.flatten() }, 400);
    }
    const { amount, description, externalReference, purpose, planId, addonIds } = parsed.data;

    // Venda vai para a conta do lojista; assinatura e add-on, para a conta da
    // plataforma. Trocar isso faria o lojista pagar a mensalidade a si mesmo.
    const plataforma = purpose === "platform";
    const mp = plataforma ? platformToken() : await companyToken(admin, companyId);
    if (!mp.token) {
      return json(
        {
          configured: false,
          error: plataforma ? PLATAFORMA_NAO_CONFIGURADA : NAO_CONFIGURADO,
        },
        200,
      );
    }

    let amountFinal: number;
    let planIdFinal: string | null = null;
    let addonIdsFinal: string[] = [];
    if (plataforma) {
      if (!planId) return json({ error: "planId obrigatório para assinatura" }, 400);
      try {
        amountFinal = calcPlanMonthlyTotal(planId, addonIds || []);
      } catch (e) {
        if (e instanceof PlanInputError) return json({ error: e.message }, 400);
        throw e;
      }
      planIdFinal = planId;
      addonIdsFinal = addonIds || [];
    } else {
      if (!amount) return json({ error: "amount obrigatório" }, 400);
      amountFinal = amount;
    }

    const extRef = buildExternalReference(
      companyId,
      String(externalReference || `pdv-${Date.now()}`),
    );

    const response = await fetch(`${mp.apiBase}/v1/payments`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${mp.token}`,
        "Content-Type": "application/json",
        "X-Idempotency-Key": crypto.randomUUID(),
      },
      body: JSON.stringify({
        transaction_amount: amountFinal,
        description: String(
          description || (plataforma ? "Assinatura MercadoFácil" : "Venda PDV MercadoFácil"),
        ).slice(0, 200),
        payment_method_id: "pix",
        external_reference: extRef,
        payer: {
          email: user.email || "cliente@mercadofacil.com",
          first_name:
            profile?.full_name || user.email?.split("@")[0] || "Cliente",
        },
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      console.error("MP create payment error", data);
      return json(
        {
          configured: true,
          error: mensagemDoMercadoPago(response.status, data),
        },
        response.status >= 400 && response.status < 600 ? response.status : 502,
      );
    }

    // Guardar a cobrança é o que permite ao webhook, que chega sem sessão,
    // saber de qual loja é este pagamento.
    const { error: chargeErr } = await admin.from("pix_charges").upsert(
      {
        company_id: companyId,
        payment_id: String(data.id),
        external_reference: extRef,
        amount: amountFinal,
        description: String(
          description || (plataforma ? "Assinatura MercadoFácil" : "Venda PDV MercadoFácil"),
        ).slice(0, 200),
        purpose: plataforma ? "platform" : "sale",
        plan_id: planIdFinal,
        addon_ids: addonIdsFinal,
        status: data.status || "pending",
        created_by: user.id,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "payment_id" },
    );
    if (chargeErr) console.error("Falha ao registrar cobrança PIX", chargeErr.message);

    return json({
      configured: true,
      sandbox: mp.sandbox,
      paymentId: data.id,
      status: data.status,
      amount: amountFinal,
      qrCode: data.point_of_interaction?.transaction_data?.qr_code || "",
      qrCodeImage:
        data.point_of_interaction?.transaction_data?.qr_code_base64 || "",
      expiresAt: data.date_of_expiration || null,
      externalReference: extRef,
    });
  } catch (error) {
    console.error(error);
    return json({ error: "Erro interno. Tente novamente." }, 500);
  }
});
