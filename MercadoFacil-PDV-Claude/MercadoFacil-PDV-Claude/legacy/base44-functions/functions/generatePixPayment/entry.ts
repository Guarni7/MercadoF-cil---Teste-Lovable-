import { createClientFromRequest } from 'npm:@base44/sdk@0.8.44';
import { secrets } from 'base44:runtime';

const buckets = new Map();
function rateLimit(key, { max = 20, windowMs = 60_000 } = {}) {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || now - b.start > windowMs) {
    b = { start: now, count: 0 };
    buckets.set(key, b);
  }
  b.count += 1;
  if (b.count > max) {
    return { ok: false, retryAfterSec: Math.ceil((b.start + windowMs - now) / 1000) };
  }
  return { ok: true };
}
function publicError(error, fallback = 'Erro interno. Tente novamente.') {
  const msg = String(error?.message || error || '');
  if (/unauthorized|forbidden|inválid|invalid|limite|não autoriz|plano|documento|empresa/i.test(msg)) {
    return msg.slice(0, 200);
  }
  console.error('[fn]', msg);
  return fallback;
}
function jsonError(status, message, extra = {}) {
  return Response.json({ error: message, ...extra }, { status });
}

export default async function (req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return jsonError(401, 'Unauthorized');

    const rl = rateLimit(`pix:gen:${user.id}`, { max: 15, windowMs: 60_000 });
    if (!rl.ok) {
      return jsonError(429, 'Muitas tentativas. Aguarde e tente novamente.', {
        retryAfterSec: rl.retryAfterSec,
      });
    }

    const body = await req.json();
    const { amount, description, externalReference } = body || {};
    if (body?.accessToken) {
      console.warn('generatePixPayment: accessToken no body ignorado');
    }
    if (!amount || Number(amount) <= 0) return jsonError(400, 'Valor inválido');
    if (Number(amount) > 50000) return jsonError(400, 'Valor acima do limite permitido');

    const accessToken = secrets.get('MERCADO_PAGO_ACCESS_TOKEN');
    if (!accessToken) {
      return Response.json({
        configured: false,
        error: 'Mercado Pago não configurado. Defina MERCADO_PAGO_ACCESS_TOKEN nas Secrets.',
      }, { status: 503 });
    }

    const isSandbox = accessToken.startsWith('TEST-');
    const apiBase = isSandbox
      ? 'https://sandbox.api.mercadopago.com'
      : 'https://api.mercadopago.com';
    const extRef = String(externalReference || `pdv-${Date.now()}`).slice(0, 256);

    const response = await fetch(`${apiBase}/v1/payments`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'X-Idempotency-Key': crypto.randomUUID(),
      },
      body: JSON.stringify({
        transaction_amount: Number(amount),
        description: String(description || 'Venda PDV MercadoFácil').slice(0, 200),
        payment_method_id: 'pix',
        external_reference: extRef,
        payer: {
          email: user.email || 'cliente@mercadofacil.com',
          first_name: user.full_name || 'Cliente',
        },
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      return Response.json({
        configured: true,
        error: 'Erro ao gerar PIX no Mercado Pago',
      }, { status: response.status >= 400 && response.status < 600 ? response.status : 502 });
    }

    return Response.json({
      configured: true,
      paymentId: data.id,
      status: data.status,
      qrCode: data.point_of_interaction?.transaction_data?.qr_code || '',
      qrCodeImage: data.point_of_interaction?.transaction_data?.qr_code_base64 || '',
      expiresAt: data.date_of_expiration || null,
      externalReference: extRef,
    });
  } catch (error) {
    return jsonError(500, publicError(error));
  }
}
