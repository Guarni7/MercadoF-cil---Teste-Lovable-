import { createClientFromRequest } from 'npm:@base44/sdk@0.8.44';
import { secrets } from 'base44:runtime';

// Webhook do Mercado Pago para confirmação de pagamento PIX
// URL para cadastrar no Mercado Pago: https://lovely-mercado-facil-pro.base44.app/functions/mercadopagoWebhook

// Valida a assinatura x-signature do Mercado Pago (HMAC-SHA256).
// Template: id:{dataId};request-id:{xRequestId};ts:{ts};
// Só valida se a secret MERCADO_PAGO_WEBHOOK_SECRET estiver configurada; caso contrário, registra aviso.
async function verifySignature(req: Request, body: any): Promise<{ valid: boolean; reason?: string }> {
  const secret = secrets.get('MERCADO_PAGO_WEBHOOK_SECRET');
  if (!secret) {
    console.error('MERCADO_PAGO_WEBHOOK_SECRET não configurada — webhook rejeitado por segurança.');
    return { valid: false, reason: 'Secret do webhook não configurada' };
  }

  const xSignature = req.headers.get('x-signature');
  const xRequestId = req.headers.get('x-request-id');
  if (!xSignature || !xRequestId) {
    return { valid: false, reason: 'Cabeçalhos x-signature ou x-request-id ausentes' };
  }

  // Parseia ts e v1 do formato "ts=...,v1=..."
  const parts = xSignature.split(',');
  let ts: string | null = null;
  let v1: string | null = null;
  for (const part of parts) {
    const [k, v] = part.split('=', 2);
    if (k.trim() === 'ts') ts = v.trim();
    else if (k.trim() === 'v1') v1 = v.trim();
  }
  if (!ts || !v1) {
    return { valid: false, reason: 'Formato de x-signature inválido' };
  }

  // data.id pode vir no query string ou no body
  const url = new URL(req.url);
  const dataId = url.searchParams.get('data.id') || url.searchParams.get('id') || String(body?.data?.id || '');
  if (!dataId) {
    return { valid: false, reason: 'data.id não encontrado' };
  }

  const manifest = `id:${dataId};request-id:${xRequestId};ts:${ts};`;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sigBuf = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(manifest));
  const calculated = Array.from(new Uint8Array(sigBuf)).map(b => b.toString(16).padStart(2, '0')).join('');

  if (calculated !== v1) {
    return { valid: false, reason: 'Assinatura não confere' };
  }
  return { valid: true };
}

export default async function(req: Request): Promise<Response> {
  try {
    const body = await req.json();
    const { type, data } = body;

    // Valida assinatura (se secret configurada)
    const sigCheck = await verifySignature(req, body);
    if (!sigCheck.valid) {
      console.error('Webhook: assinatura inválida —', sigCheck.reason);
      return Response.json({ received: true, error: 'Assinatura inválida' }, { status: 401 });
    }

    // Mercado Pago envia notificações com type e data.id
    if (type === 'payment' && data?.id) {
      // Valida que data.id é um número inteiro (evita injeção na URL da API)
      const paymentId = Number(data.id);
      if (!Number.isInteger(paymentId) || paymentId <= 0) {
        console.error('Webhook: data.id inválido —', data.id);
        return Response.json({ received: true, error: 'ID de pagamento inválido' }, { status: 400 });
      }

      const accessToken = secrets.get('MERCADO_PAGO_ACCESS_TOKEN');
      if (!accessToken) {
        return Response.json({ error: 'Mercado Pago não configurado' }, { status: 503 });
      }

      const isSandbox = accessToken.startsWith('TEST-');
      const apiBase = isSandbox
        ? 'https://sandbox.api.mercadopago.com'
        : 'https://api.mercadopago.com';

      // Consulta o status do pagamento
      const response = await fetch(`${apiBase}/v1/payments/${paymentId}`, {
        headers: { 'Authorization': `Bearer ${accessToken}` },
      });

      const payment = await response.json();

      if (response.ok && payment.status === 'approved') {
        const base44 = createClientFromRequest(req);
        const externalRef = payment.external_reference;
        const paidAmount = Number(payment.transaction_amount) || 0;

        if (externalRef) {
          try {
            const sales = await base44.asServiceRole.entities.Sale.filter({
              number: parseInt(externalRef.replace('pdv-', '')) || 0,
            });
            if (sales.length > 0) {
              const sale = sales[0];
              // Valida o valor transacionado contra o total da venda (tolerância de R$0,01)
              if (Math.abs(paidAmount - Number(sale.total)) > 0.01) {
                console.error(`Webhook: valor divergente — pago ${paidAmount}, venda ${sale.total}, external_ref ${externalRef}`);
                // Não marca como concluída — possível fraude ou erro
              } else if (sale.status === 'concluida') {
                // Já confirmada — idempotência, apenas registra
                console.log('Webhook: venda já estava concluída', sale.id);
              } else {
                await base44.asServiceRole.entities.Sale.update(sale.id, {
                  status: 'concluida',
                });
              }
            } else {
              console.error('Webhook: venda não encontrada para external_reference', externalRef);
            }
          } catch (e) {
            console.error('Erro ao atualizar venda:', e.message);
          }
        } else {
          console.error('Webhook: pagamento aprovado sem external_reference', data.id);
        }
      }
    }

    // Sempre retorna 200 para o Mercado Pago não reenviar
    return Response.json({ received: true });
  } catch (error) {
    console.error('Webhook error:', error.message);
    return Response.json({ received: true, error: error.message });
  }
}