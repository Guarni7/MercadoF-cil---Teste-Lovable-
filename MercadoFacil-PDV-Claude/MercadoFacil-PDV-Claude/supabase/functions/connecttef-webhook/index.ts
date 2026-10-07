// Webhook do ConnectTEF — recebimento e registro de eventos.
//
// URL (configurar em Integração, no portal do parceiro ConnectTEF):
//   https://<project-ref>.supabase.co/functions/v1/connecttef-webhook
//
// Registra o evento e processa os tipos conhecidos (process_connecttef_event):
//   smartpos.identificado  -> vincula o Smart POS ao pareamento;
//   pagamento.aprovado / pagamento.recusado (ou .rejeitado) -> grava o resultado na
//     operação, uma única vez. Não fecha venda: isso é de outra etapa.
// Os demais tipos ficam registrados, sem processar. A resposta é 2xx rápida (o
// ConnectTEF espera 1–2 s e trata 4xx/5xx/timeout como falha).
//
// Autenticação: "Authorization: Bearer <token>" comparado com o secret
// CONNECTTEF_WEBHOOK_TOKEN. A documentação do ConnectTEF diz que o token é
// opcional do lado deles; aqui é obrigatório — sem secret configurado a função
// recusa tudo (503) em vez de aceitar evento sem autenticação. A API Key do
// ConnectTEF (x-api-key) não é usada nem aparece aqui: este endpoint só recebe.
//
// Idempotência: X-ConnectTEF-Event-Id (ou o `id` do corpo) — mesmo evento
// reenviado só incrementa delivery_count, via record_connecttef_event.

import { adminClient, corsHeaders, json } from "../_shared/mercadoPago.ts";
import { clientIp, rateLimited } from "../_shared/rateLimit.ts";
import { diagnosticarAutorizacao, nomesDosCabecalhos } from "../_shared/connecttefAuthDiag.ts";

const MAX_BYTES = 256 * 1024;
const TIPOS_PROCESSADOS = ["smartpos.identificado", "pagamento.aprovado", "pagamento.recusado", "pagamento.rejeitado"];

/** Comparação em tempo constante (via hash, para não vazar o tamanho do token). */
async function tokensIguais(recebido: string, esperado: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(recebido)),
    crypto.subtle.digest("SHA-256", enc.encode(esperado)),
  ]);
  const x = new Uint8Array(a);
  const y = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

const texto = (v: unknown): string | null => {
  const s = typeof v === "string" || typeof v === "number" ? String(v).trim() : "";
  return s ? s.slice(0, 200) : null;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Método não permitido" }, 405);

  // 1. Autenticação
  const esperado = (Deno.env.get("CONNECTTEF_WEBHOOK_TOKEN") || "").trim();
  if (!esperado) {
    console.error("connecttef-webhook: CONNECTTEF_WEBHOOK_TOKEN não configurado");
    return json({ error: "Webhook não configurado" }, 503);
  }
  const auth = req.headers.get("authorization") || "";
  const recebido = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  if (!recebido || !(await tokensIguais(recebido, esperado))) {
    // Diagnóstico do 401 (o log da plataforma não guarda o Authorization): só booleanos, tamanhos, o nome
    // do esquema e os NOMES dos cabeçalhos. Nunca o token, o secret ou valor de cabeçalho. A decisão acima
    // não depende disto, e uma falha ao diagnosticar nunca muda a resposta.
    try {
      const diagnostico = await diagnosticarAutorizacao(auth, esperado, tokensIguais);
      console.warn("connecttef-webhook: 401", JSON.stringify({ ...diagnostico, cabecalhos: nomesDosCabecalhos(req.headers) }));
    } catch {
      // sem diagnóstico; segue para o 401
    }
    return json({ error: "Não autorizado" }, 401);
  }

  const admin = adminClient();

  // 2. Limite generoso por IP: reenvio em rajada do ConnectTEF passa; flood não.
  const limited = await rateLimited(admin, { key: `connecttef:webhook:${clientIp(req)}`, max: 300, windowSeconds: 60 });
  if (limited) return limited;

  // 3. Corpo
  const declarado = Number(req.headers.get("content-length") || 0);
  if (declarado > MAX_BYTES) return json({ error: "Corpo grande demais" }, 413);
  const bruto = await req.text();
  if (bruto.length > MAX_BYTES) return json({ error: "Corpo grande demais" }, 413);

  let corpo: Record<string, unknown>;
  try {
    const parsed = JSON.parse(bruto);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("não é objeto");
    corpo = parsed as Record<string, unknown>;
  } catch {
    return json({ error: "JSON inválido" }, 400);
  }

  const dados = (corpo.dados && typeof corpo.dados === "object" ? corpo.dados : {}) as Record<string, unknown>;
  const eventId = texto(req.headers.get("x-connecttef-event-id")) ?? texto(corpo.id);
  if (!eventId) return json({ error: "Evento sem identificador (X-ConnectTEF-Event-Id)" }, 400);

  const eventType =
    texto(req.headers.get("x-connecttef-event-type")) ??
    texto(corpo.evento) ?? texto(corpo.tipo) ?? texto(corpo.type) ?? texto(corpo.event);
  const referencia = texto(dados.referencia) ?? texto(corpo.referencia);

  // 4. Registro idempotente
  const { data: primeiraVez, error } = await admin.rpc("record_connecttef_event", {
    p_event_id: eventId,
    p_event_type: eventType,
    p_referencia: referencia,
    p_payload: corpo,
  });
  if (error) {
    // 500: o ConnectTEF mantém o evento disponível para reenvio pelo portal.
    console.error("connecttef-webhook: falha ao registrar evento", eventId, error.message);
    return json({ error: "Falha ao registrar o evento" }, 500);
  }

  // 5. Aplica o evento (vínculo do Smart POS ou resultado de pagamento). Também roda
  // no reenvio de um evento ainda não processado (processed_at nulo); a RPC é
  // idempotente e serializa entregas simultâneas. Falha aqui não derruba a resposta:
  // o evento já está guardado.
  let processamento: string | null = null;
  if (eventType && TIPOS_PROCESSADOS.includes(eventType)) {
    const { data: resultado, error: erroProc } = await admin.rpc("process_connecttef_event", { p_event_id: eventId });
    if (erroProc) {
      console.error("connecttef-webhook: falha ao processar evento", eventId, erroProc.message);
      processamento = "erro";
    } else {
      processamento = (resultado as { result?: string } | null)?.result ?? null;
    }
  }

  return json({ received: true, duplicate: primeiraVez === false, ...(processamento ? { processed: processamento } : {}) });
});
