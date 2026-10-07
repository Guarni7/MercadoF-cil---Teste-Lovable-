// Pareamento de Smart POS do ConnectTEF: gera o QR Code que identifica o aparelho.
//
// Fluxo: o lojista informa o documento do cliente no ConnectTEF -> esta função
// grava o pareamento (referencia UUID, "aguardando") e pede o QR Code ao
// ConnectTEF -> o Smart POS (no teste, o ConnectTEF simula a leitura) é
// identificado e o webhook connecttef-webhook recebe `smartpos.identificado`
// com o smartposId, que vincula o aparelho a esta referência.
//
// A API Key do ConnectTEF (secret CONNECTTEF_API_KEY) só existe aqui, no
// servidor: nunca vem do navegador, nunca é devolvida nem registrada em log. Só
// admin da empresa pareia aparelho. O frontend recebe apenas o que precisa para
// mostrar o QR Code.

import { corsHeaders, json, resolveCaller } from "../_shared/mercadoPago.ts";
import { rateLimited } from "../_shared/rateLimit.ts";
import { isValidCnpj, isValidCpf } from "../_shared/fiscal/validation.ts";
import { z } from "https://esm.sh/zod@3.23.8";

const ADMINS = ["owner", "admin", "platform_admin"];
const BASE_PADRAO = "https://api.connecttef.com.br";

const bodySchema = z.object({ documentoCliente: z.string().trim().min(1).max(30) });

const soDigitos = (v: string) => v.replace(/\D/g, "");

const CAMINHO_QRCODE = "/qrcode";

/** Código de erro do ConnectTEF (ex.: CLIENTE_NAO_AUTORIZADO), só se tiver o formato esperado. */
function codigoDe(dados: Record<string, unknown>): string | undefined {
  const c = dados.codigo ?? dados.code;
  return typeof c === "string" && /^[A-Z0-9_]{3,60}$/.test(c) ? c : undefined;
}

type Falha = { http: number; tipo: "dados" | "cliente" | "credencial" | "rota" | "servidor" | "inesperado"; mensagem: string };

/**
 * Separa o que o lojista pode corrigir (documento/cliente) do que é problema de
 * credencial, de rota ou do servidor do ConnectTEF. O gateway responde chave
 * inválida com 403 {"message":"Forbidden"} (sem `codigo`); só o 403 com
 * CLIENTE_NAO_AUTORIZADO é problema do cliente informado.
 */
function classificarErro(status: number, codigo?: string): Falha {
  if (status === 401 || (status === 403 && codigo !== "CLIENTE_NAO_AUTORIZADO")) {
    return {
      http: 502,
      tipo: "credencial",
      mensagem: `A credencial (API Key) do ConnectTEF foi recusada (HTTP ${status}). Fale com o suporte.`,
    };
  }
  if (status === 403) {
    return {
      http: 422,
      tipo: "cliente",
      mensagem: "Este documento não está autorizado no ConnectTEF. Confira o cliente no portal do parceiro.",
    };
  }
  if (status === 400) {
    return { http: 422, tipo: "dados", mensagem: "O ConnectTEF recusou os dados enviados. Confira o documento do cliente." };
  }
  if (status === 404 || status === 405) {
    return {
      http: 502,
      tipo: "rota",
      mensagem: `O endereço da API do ConnectTEF não foi encontrado (HTTP ${status}). Fale com o suporte.`,
    };
  }
  if (status >= 500) {
    return { http: 502, tipo: "servidor", mensagem: `O ConnectTEF está com problema (HTTP ${status}). Tente de novo em instantes.` };
  }
  return { http: 502, tipo: "inesperado", mensagem: `O ConnectTEF respondeu de forma inesperada (HTTP ${status}).` };
}

/** `expiresAt` do ConnectTEF é Unix timestamp; aceita segundos ou milissegundos. */
function expiracao(v: unknown): string | null {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  return new Date(n < 1e11 ? n * 1000 : n).toISOString();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Método não permitido" }, 405);

  const caller = await resolveCaller(req);
  if ("error" in caller) return json({ error: "Não autenticado" }, 401);

  const { user, profile, admin } = caller;
  const companyId = profile?.company_id;
  if (!companyId) return json({ error: "Usuário sem empresa vinculada" }, 403);

  const papel = profile?.company_role || profile?.role;
  if (!ADMINS.includes(String(papel))) {
    return json({ error: "Apenas administradores podem parear um Smart POS" }, 403);
  }

  // Chama API externa: limite baixo por empresa.
  const limited = await rateLimited(admin, { key: `connecttef:pair:${companyId}`, max: 10, windowSeconds: 60 });
  if (limited) return limited;

  const apiKey = (Deno.env.get("CONNECTTEF_API_KEY") || "").trim();
  if (!apiKey) {
    console.error("connecttef-pair-smartpos: CONNECTTEF_API_KEY não configurada");
    return json({ error: "Integração com o ConnectTEF não configurada. Fale com o suporte." }, 503);
  }
  const base = (Deno.env.get("CONNECTTEF_API_BASE") || BASE_PADRAO).replace(/\/$/, "");

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ error: "Informe o documento do cliente (CPF ou CNPJ)" }, 400);
  const documento = soDigitos(parsed.data.documentoCliente);
  const documentoValido =
    (documento.length === 11 && isValidCpf(documento)) || (documento.length === 14 && isValidCnpj(documento));
  if (!documentoValido) {
    return json({ error: "Documento do cliente inválido: informe um CPF ou CNPJ válido" }, 400);
  }

  // Pareamentos esquecidos (QR nunca lido) não ficam acumulando.
  await admin
    .from("connecttef_smartpos")
    .delete()
    .eq("company_id", companyId)
    .eq("status", "aguardando")
    .lt("created_at", new Date(Date.now() - 24 * 3600 * 1000).toISOString());

  // A linha existe ANTES do pedido: o evento de identificação pode chegar logo
  // depois do QR e precisa encontrar a referência.
  const referencia = crypto.randomUUID();
  const { data: pareamento, error: erroInsert } = await admin
    .from("connecttef_smartpos")
    .insert({ company_id: companyId, documento_cliente: documento, referencia, created_by: user.id })
    .select("id")
    .single();
  if (erroInsert || !pareamento) {
    console.error("connecttef-pair-smartpos: falha ao gravar o pareamento", erroInsert?.message);
    return json({ error: "Não foi possível iniciar o pareamento" }, 500);
  }

  const desfazer = () => admin.from("connecttef_smartpos").delete().eq("id", pareamento.id);

  let resposta: Response;
  try {
    // Rota oficial: POST /qrcode (sem /v1 — só pagamentos, estorno e health usam /v1).
    resposta = await fetch(`${base}${CAMINHO_QRCODE}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey },
      body: JSON.stringify({ documentoCliente: documento, referencia }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (e) {
    await desfazer();
    console.error("connecttef-pair-smartpos: ConnectTEF indisponível", (e as Error).name);
    return json({ error: "O ConnectTEF não respondeu. Tente de novo em instantes." }, 502);
  }

  const dados = await resposta.json().catch(() => ({})) as Record<string, unknown>;
  if (resposta.status !== 201 && resposta.status !== 200) {
    await desfazer();
    const codigo = codigoDe(dados);
    const { http, tipo, mensagem } = classificarErro(resposta.status, codigo);
    // Log: status, tipo do erro, código do ConnectTEF e, se curto, o `message` do
    // gateway. Nunca a chave, o corpo do pedido nem cabeçalhos.
    const msgGateway = typeof dados.message === "string" && dados.message.length <= 120 && !dados.message.includes(apiKey)
      ? dados.message
      : undefined;
    console.error("connecttef-pair-smartpos: ConnectTEF recusou o pedido", JSON.stringify({
      status: resposta.status, tipo, codigo, message: msgGateway, caminho: CAMINHO_QRCODE,
    }));
    return json({ error: mensagem, connecttefStatus: resposta.status, ...(codigo ? { connecttefCodigo: codigo } : {}) }, http);
  }

  const qrCode = typeof dados.qrCode === "string" ? dados.qrCode : "";
  if (!qrCode) {
    await desfazer();
    return json({ error: "O ConnectTEF respondeu sem o QR Code" }, 502);
  }

  const expiraEm = expiracao(dados.expiresAt);
  if (expiraEm) {
    await admin.from("connecttef_smartpos").update({ qr_expires_at: expiraEm, updated_at: new Date().toISOString() }).eq("id", pareamento.id);
  }

  return json({ id: pareamento.id, referencia, qrCode, expiresAt: expiraEm });
});
