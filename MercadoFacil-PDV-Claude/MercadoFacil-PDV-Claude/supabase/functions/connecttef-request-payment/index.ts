// Solicitação de pagamento no Smart POS (ConnectTEF).
//
// Fluxo: valida o pedido no servidor -> grava a operação como 'pendente' ->
// POST /v1/payments no ConnectTEF -> o 202 significa só "em processamento"
// (status 'processando'; NÃO conclui venda) -> o resultado definitivo chega pelo
// webhook connecttef-webhook (pagamento.aprovado / pagamento.recusado), que
// atualiza a operação uma única vez (process_connecttef_event).
//
// A API Key (secret CONNECTTEF_API_KEY) só existe aqui, no servidor: não vem do
// navegador, não volta na resposta nem entra em log. O valor, a forma de
// pagamento e o Smart POS são conferidos aqui — o navegador só sugere. O
// documento do cliente no ConnectTEF vem do pareamento do Smart POS, nunca do
// corpo. Qualquer usuário da empresa pode solicitar (é o caixa quem cobra); o
// estorno e o pareamento ficam fora desta função.

import { corsHeaders, json, resolveCaller } from "../_shared/mercadoPago.ts";
import { rateLimited } from "../_shared/rateLimit.ts";
import { z } from "https://esm.sh/zod@3.23.8";

const BASE_PADRAO = "https://api.connecttef.com.br";
const CAMINHO_PAGAMENTO = "/v1/payments";
/**
 * Espera máxima pela resposta do ConnectTEF. Em homologação o POST /v1/payments
 * levou ~8–10 s (o webhook de aprovação chegou antes do 202), então 10 s era
 * curto demais. Se estourar, a operação fica 'indeterminado' e o webhook ainda resolve.
 */
const TIMEOUT_CONNECTTEF_MS = 25_000;
/** Teto por operação: R$ 100.000,00. Acima disso é erro de digitação, não venda. */
const VALOR_MAX_CENTAVOS = 10_000_000;

const bodySchema = z.object({
  valorCentavos: z.number().int().min(1).max(VALOR_MAX_CENTAVOS),
  formaPagamento: z.enum(["credito", "debito", "pix", "voucher"]),
  parcelas: z.number().int().min(1).max(24).optional(),
  parcelamento: z.enum(["estabelecimento", "administradora"]).optional(),
  smartposId: z.string().trim().regex(/^[A-Za-z0-9._-]{1,100}$/).optional(),
  // Opcional: o mesmo pedido repetido (duplo clique, retry de rede) não cobra de novo.
  chaveIdempotencia: z.string().trim().regex(/^[A-Za-z0-9._:-]{8,100}$/).optional(),
});

const CAMPOS_RESPOSTA = "id, referencia, status, valor_centavos, forma_pagamento, smartpos_id, http_status";
const resposta = (p: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  id: p.id,
  referencia: p.referencia,
  status: p.status,
  valorCentavos: p.valor_centavos,
  formaPagamento: p.forma_pagamento,
  smartposId: p.smartpos_id,
  ...extra,
});

function codigoDe(dados: Record<string, unknown>): string | undefined {
  const c = dados.codigo ?? dados.code;
  return typeof c === "string" && /^[A-Z0-9_]{3,60}$/.test(c) ? c : undefined;
}

type Falha = {
  http: number;
  estado: "falhou" | "indeterminado";
  tipo: "dados" | "cliente" | "credencial" | "smartpos" | "rota" | "duplicada" | "servidor" | "inesperado";
  mensagem: string;
};

/**
 * 4xx do ConnectTEF = o pedido NÃO foi aceito ('falhou'). 5xx/timeout = não dá
 * para saber se chegou ('indeterminado'); o webhook ainda pode resolver.
 * O gateway responde chave inválida com 403 {"message":"Forbidden"} (sem `codigo`)
 * e rota inexistente com 404 {"message":"Not Found"} (sem `codigo`).
 */
function classificarErro(status: number, codigo?: string): Falha {
  if (status === 401 || (status === 403 && codigo !== "CLIENTE_NAO_AUTORIZADO")) {
    return { http: 502, estado: "falhou", tipo: "credencial", mensagem: `A credencial (API Key) do ConnectTEF foi recusada (HTTP ${status}). Fale com o suporte.` };
  }
  if (status === 403) {
    return { http: 422, estado: "falhou", tipo: "cliente", mensagem: "Este cliente não está autorizado no ConnectTEF. Confira o cadastro no portal do parceiro." };
  }
  if (status === 404 && codigo) {
    return { http: 422, estado: "falhou", tipo: "smartpos", mensagem: "O ConnectTEF não encontrou o Smart POS. Refaça o pareamento." };
  }
  if (status === 404 || status === 405) {
    return { http: 502, estado: "falhou", tipo: "rota", mensagem: `O endereço da API do ConnectTEF não foi encontrado (HTTP ${status}). Fale com o suporte.` };
  }
  if (status === 409) {
    return { http: 502, estado: "falhou", tipo: "duplicada", mensagem: "O ConnectTEF já tem uma operação com esta referência. Tente de novo." };
  }
  if (status === 400) {
    return { http: 422, estado: "falhou", tipo: "dados", mensagem: "O ConnectTEF recusou os dados do pagamento. Confira o valor e a forma de pagamento." };
  }
  if (status >= 500) {
    return { http: 502, estado: "indeterminado", tipo: "servidor", mensagem: `O ConnectTEF está com problema (HTTP ${status}). Não foi possível confirmar se a cobrança foi enviada: consulte o estado da operação antes de tentar de novo.` };
  }
  return { http: 502, estado: "falhou", tipo: "inesperado", mensagem: `O ConnectTEF respondeu de forma inesperada (HTTP ${status}).` };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Método não permitido" }, 405);

  const caller = await resolveCaller(req);
  if ("error" in caller) return json({ error: "Não autenticado" }, 401);

  const { user, profile, admin } = caller;
  const companyId = profile?.company_id;
  if (!companyId) return json({ error: "Usuário sem empresa vinculada" }, 403);

  const limited = await rateLimited(admin, { key: `connecttef:payment:${companyId}`, max: 30, windowSeconds: 60 });
  if (limited) return limited;

  const apiKey = (Deno.env.get("CONNECTTEF_API_KEY") || "").trim();
  if (!apiKey) {
    console.error("connecttef-request-payment: CONNECTTEF_API_KEY não configurada");
    return json({ error: "Integração com o ConnectTEF não configurada. Fale com o suporte." }, 503);
  }
  const base = (Deno.env.get("CONNECTTEF_API_BASE") || BASE_PADRAO).replace(/\/$/, "");

  // ---- Validação do pedido (valor, forma, parcelas) ----
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return json({
      error: "Pedido inválido: informe valorCentavos (inteiro, de 1 a 10.000.000) e formaPagamento (credito, debito, pix ou voucher)",
    }, 400);
  }
  const pedido = parsed.data;
  const parcelas = pedido.parcelas ?? 1;
  if (parcelas > 1 && pedido.formaPagamento !== "credito") {
    return json({ error: "Parcelamento só existe no crédito" }, 400);
  }
  if (parcelas > 1 && !pedido.parcelamento) {
    return json({ error: "Informe o tipo de parcelamento (estabelecimento ou administradora)" }, 400);
  }
  const parcelamento = parcelas > 1 ? pedido.parcelamento! : null;

  // ---- Retry do mesmo pedido: devolve a operação existente, sem cobrar de novo ----
  if (pedido.chaveIdempotencia) {
    const { data: existente } = await admin
      .from("connecttef_payments")
      .select(CAMPOS_RESPOSTA)
      .eq("company_id", companyId)
      .eq("idempotency_key", pedido.chaveIdempotencia)
      .maybeSingle();
    if (existente) return json(resposta(existente, { reaproveitada: true }), 200);
  }

  // ---- Smart POS: tem que estar vinculado a ESTA empresa ----
  let consulta = admin
    .from("connecttef_smartpos")
    .select("smartpos_id, documento_cliente")
    .eq("company_id", companyId)
    .eq("status", "vinculado");
  if (pedido.smartposId) consulta = consulta.eq("smartpos_id", pedido.smartposId);
  const { data: smartpos } = await consulta.order("linked_at", { ascending: false }).limit(1).maybeSingle();
  if (!smartpos) {
    return pedido.smartposId
      ? json({ error: "Smart POS não encontrado nesta empresa" }, 404)
      : json({ error: "Nenhum Smart POS vinculado. Faça o pareamento em Configurações > Pagamento." }, 409);
  }

  // ---- Registro ANTES da chamada externa ----
  const referencia = crypto.randomUUID();
  const { data: operacao, error: erroInsert } = await admin
    .from("connecttef_payments")
    .insert({
      company_id: companyId,
      referencia,
      smartpos_id: smartpos.smartpos_id,
      documento_cliente: smartpos.documento_cliente,
      valor_centavos: pedido.valorCentavos,
      forma_pagamento: pedido.formaPagamento,
      parcelas,
      parcelamento,
      idempotency_key: pedido.chaveIdempotencia ?? null,
      created_by: user.id,
    })
    .select("id")
    .single();
  if (erroInsert || !operacao) {
    // Duas chamadas simultâneas com a mesma chave: a segunda devolve a primeira.
    if (erroInsert?.code === "23505" && pedido.chaveIdempotencia) {
      const { data: existente } = await admin
        .from("connecttef_payments")
        .select(CAMPOS_RESPOSTA)
        .eq("company_id", companyId)
        .eq("idempotency_key", pedido.chaveIdempotencia)
        .maybeSingle();
      if (existente) return json(resposta(existente, { reaproveitada: true }), 200);
    }
    console.error("connecttef-request-payment: falha ao registrar a operação", erroInsert?.message);
    return json({ error: "Não foi possível registrar a cobrança" }, 500);
  }

  // Só sai de 'pendente' se o webhook ainda não decidiu: o resultado pode chegar
  // antes de esta função gravar o 202, e um resultado definitivo nunca é rebaixado.
  const registrar = async (campos: Record<string, unknown>) => {
    await admin
      .from("connecttef_payments")
      .update({ ...campos, updated_at: new Date().toISOString() })
      .eq("id", operacao.id)
      .eq("status", "pendente");
    const { data } = await admin.from("connecttef_payments").select(CAMPOS_RESPOSTA).eq("id", operacao.id).single();
    return data as Record<string, unknown>;
  };

  // ---- Chamada ao ConnectTEF ----
  const corpo: Record<string, unknown> = {
    referencia,
    documentoCliente: smartpos.documento_cliente,
    smartposId: smartpos.smartpos_id,
    valorCentavos: pedido.valorCentavos,
    formaPagamento: pedido.formaPagamento,
    modoExecucao: "imediato",
  };
  if (parcelas > 1) {
    corpo.parcelas = parcelas;
    corpo.parcelamento = parcelamento;
  }

  let resp: Response;
  try {
    resp = await fetch(`${base}${CAMINHO_PAGAMENTO}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey },
      body: JSON.stringify(corpo),
      signal: AbortSignal.timeout(TIMEOUT_CONNECTTEF_MS),
    });
  } catch (e) {
    console.error("connecttef-request-payment: ConnectTEF sem resposta", (e as Error).name);
    const op = await registrar({ status: "indeterminado", erro: "sem resposta do ConnectTEF" });
    return json(
      resposta(op, { error: "O ConnectTEF não respondeu. Não foi possível confirmar se a cobrança foi enviada: consulte o estado da operação antes de tentar de novo." }),
      502,
    );
  }

  const dados = await resp.json().catch(() => ({})) as Record<string, unknown>;

  // 202 = aceito para processamento. NÃO é aprovação.
  if (resp.status === 202 || resp.status === 200 || resp.status === 201) {
    const op = await registrar({ status: "processando", http_status: resp.status, requested_at: new Date().toISOString() });
    return json(resposta(op), 202);
  }

  const codigo = codigoDe(dados);
  const falha = classificarErro(resp.status, codigo);
  // Log: status, tipo e código do ConnectTEF. Nunca chave, corpo, documento ou cabeçalhos.
  console.error("connecttef-request-payment: ConnectTEF não aceitou o pedido", JSON.stringify({
    status: resp.status, tipo: falha.tipo, codigo, caminho: CAMINHO_PAGAMENTO,
  }));
  const op = await registrar({ status: falha.estado, http_status: resp.status, erro: (codigo ?? falha.tipo).slice(0, 100) });
  return json(
    resposta(op, { error: falha.mensagem, connecttefStatus: resp.status, ...(codigo ? { connecttefCodigo: codigo } : {}) }),
    falha.http,
  );
});
