// Webhook público Mercado Pago → confirma a venda da loja certa.
//
// URL: https://<project-ref>.supabase.co/functions/v1/mercadopago-webhook
//
// A notificação chega sem sessão. A empresa sai do external_reference
// ("mf:<company_id>:<ref>"), e tanto a assinatura quanto a consulta do pagamento
// usam as credenciais daquela loja — antes tudo dependia de um par de secrets
// globais, o que só funcionaria com uma única conta Mercado Pago no sistema
// inteiro.
import {
  adminClient,
  companyToken,
  platformToken,
  parseExternalReference,
} from "../_shared/mercadoPago.ts";
import { rateLimited, clientIp } from "../_shared/rateLimit.ts";
import { activatePlanFromCharge } from "../_shared/activatePlan.ts";

async function assinaturaConfere(
  req: Request,
  body: Record<string, unknown>,
  secret: string,
): Promise<{ valid: boolean; reason?: string }> {
  const xSignature = req.headers.get("x-signature");
  const xRequestId = req.headers.get("x-request-id");
  if (!xSignature || !xRequestId) {
    return { valid: false, reason: "Cabeçalhos x-signature ou x-request-id ausentes" };
  }

  let ts: string | null = null;
  let v1: string | null = null;
  for (const part of xSignature.split(",")) {
    const [k, v] = part.split("=", 2);
    if (k.trim() === "ts") ts = v?.trim() ?? null;
    else if (k.trim() === "v1") v1 = v?.trim() ?? null;
  }
  if (!ts || !v1) return { valid: false, reason: "Formato de x-signature inválido" };

  const url = new URL(req.url);
  const data = body?.data as { id?: string | number } | undefined;
  const dataId =
    url.searchParams.get("data.id") ||
    url.searchParams.get("id") ||
    String(data?.id || "");
  if (!dataId) return { valid: false, reason: "data.id não encontrado" };

  const manifest = `id:${dataId};request-id:${xRequestId};ts:${ts};`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sigBuf = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(manifest),
  );
  const calculado = Array.from(new Uint8Array(sigBuf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  if (calculado !== v1) return { valid: false, reason: "Assinatura não confere" };
  return { valid: true };
}

Deno.serve(async (req) => {
  try {
    const admin = adminClient();
    // Endpoint público (sem sessão) — Mercado Pago pode reenviar em rajada
    // legítima, então o limite é por IP e generoso: 120/min barra flood de uma
    // única origem sem incomodar o retry normal do provedor.
    const limited = await rateLimited(admin, {
      key: `mp:webhook:${clientIp(req)}`,
      max: 120,
      windowSeconds: 60,
    });
    if (limited) return limited;

    const body = await req.json().catch(() => ({}));
    const type = (body as { type?: string }).type;
    const data = (body as { data?: { id?: string | number } }).data;

    if (type !== "payment" || !data?.id) {
      return Response.json({ received: true, ignored: true });
    }

    const paymentId = Number(data.id);
    if (!Number.isInteger(paymentId) || paymentId <= 0) {
      return Response.json({ received: true, error: "ID de pagamento inválido" }, { status: 400 });
    }

    // A cobrança foi gravada quando o PIX foi gerado: é por ela que se sabe a
    // loja antes de confiar em qualquer dado vindo na notificação.
    const { data: cobrancas } = await admin
      .from("pix_charges")
      .select("id,company_id,amount,sale_id,external_reference,purpose,plan_id,addon_ids,activated_at")
      .eq("payment_id", String(paymentId))
      .limit(1);

    const cobranca = cobrancas?.[0] || null;
    if (!cobranca?.company_id) {
      console.error("Webhook: não foi possível identificar a loja do pagamento", paymentId);
      // 200 (não 202): o Mercado Pago só considera 200/201 como notificação
      // recebida — com 202 o simulador marca falha e o MP fica reenviando
      // eventos de pagamentos que este sistema nunca vai reconhecer.
      return Response.json({ received: true, error: "Loja não identificada" });
    }
    const companyId = cobranca.company_id;

    const daPlataforma = cobranca.purpose === "platform";

    let secret = "";
    if (daPlataforma) {
      secret = (Deno.env.get("MERCADO_PAGO_WEBHOOK_SECRET") || "").trim();
    } else {
      // mp_webhook_secret vive criptografado no Vault (migration 039).
      const { data: segredos } = await admin
        .rpc("get_payment_secrets", { p_company_id: companyId })
        .maybeSingle();
      secret = (segredos?.mp_webhook_secret || "").trim();
    }

    if (!secret) {
      console.error("Webhook: sem secret para validar a notificação", companyId);
      return Response.json(
        { received: true, error: "Webhook não configurado" },
        { status: 401 },
      );
    }

    const sig = await assinaturaConfere(req, body as Record<string, unknown>, secret);
    if (!sig.valid) {
      console.error("Webhook: assinatura inválida —", sig.reason);
      return Response.json({ received: true, error: "Assinatura inválida" }, { status: 401 });
    }

    const mp = daPlataforma
      ? platformToken()
      : await companyToken(admin, companyId);
    if (!mp.token) {
      return Response.json({ error: "Mercado Pago não configurado" }, { status: 503 });
    }

    const response = await fetch(`${mp.apiBase}/v1/payments/${paymentId}`, {
      headers: { Authorization: `Bearer ${mp.token}` },
    });
    const payment = await response.json();

    if (response.ok && payment?.status) {
      await admin
        .from("pix_charges")
        .update({ status: payment.status, updated_at: new Date().toISOString() })
        .eq("id", cobranca.id);
    }

    if (!response.ok || payment.status !== "approved") {
      return Response.json({ received: true, status: payment?.status || "erro" });
    }

    // Assinatura e add-on não fecham venda: ativação de plano acontece aqui,
    // não no fluxo de "sales" logo abaixo (que é só pra venda do PDV).
    if (daPlataforma) {
      const resultado = await activatePlanFromCharge(admin, String(paymentId), payment);
      return Response.json({ received: true, status: "aprovado", purpose: "platform", ...resultado });
    }

    const externalRef = String(payment.external_reference || "");
    const { companyId: refCompany, sufixo } = parseExternalReference(externalRef);
    if (refCompany && refCompany !== companyId) {
      console.error("Webhook: referência de outra loja", externalRef);
      return Response.json({ received: true, error: "Referência de outra loja" }, { status: 409 });
    }

    const paidAmount = Number(payment.transaction_amount) || 0;

    // Toda busca é presa à empresa: sem isso uma referência forjada poderia
    // fechar a venda de outro tenant.
    let saleQuery = admin.from("sales").select("*").eq("company_id", companyId);
    const saleIdMatch = sufixo.match(/^sale:([0-9a-f-]{36})$/i);
    const numberMatch = sufixo.match(/pdv-(\d+)/i);
    if (cobranca.sale_id) saleQuery = saleQuery.eq("id", cobranca.sale_id);
    else if (saleIdMatch) saleQuery = saleQuery.eq("id", saleIdMatch[1]);
    else if (numberMatch) saleQuery = saleQuery.eq("number", Number(numberMatch[1]));
    else saleQuery = saleQuery.eq("pix_external_reference", externalRef);

    const { data: sales, error } = await saleQuery.limit(5);
    if (error) {
      console.error("Webhook: erro ao buscar venda", error.message);
      return Response.json({ received: true, error: "Falha ao buscar venda" }, { status: 500 });
    }
    if (!sales?.length) {
      console.error("Webhook: venda não encontrada para", externalRef);
      return Response.json({ received: true, error: "Venda não encontrada" }, { status: 202 });
    }

    const sale = sales[0];
    if (Math.abs(paidAmount - Number(sale.total)) > 0.01) {
      console.error(`Webhook: valor divergente — pago ${paidAmount}, venda ${sale.total}`);
      return Response.json({ received: true, error: "Valor divergente" }, { status: 409 });
    }
    if (sale.status === "concluida") {
      return Response.json({ received: true, status: "ja_concluida" });
    }

    await admin
      .from("sales")
      .update({
        status: "concluida",
        pix_payment_id: String(payment.id),
        updated_at: new Date().toISOString(),
      })
      .eq("id", sale.id);

    return Response.json({ received: true, status: "concluida", sale_id: sale.id });
  } catch (error) {
    console.error("Webhook error:", error);
    return Response.json({ received: true, error: "Erro interno ao processar notificação" });
  }
});
