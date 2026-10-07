// Salva a configuração de pagamento da empresa.
//
// O Access Token do Mercado Pago entra por aqui e vai para
// company_payment_secrets; a resposta devolve só o final dele ("•••• 4821").
// Antes o token ficava no localStorage do navegador e era reenviado no corpo de
// cada cobrança.
import {
  corsHeaders,
  json,
  resolveCaller,
} from "../_shared/mercadoPago.ts";
import { rateLimited } from "../_shared/rateLimit.ts";

const CAMPOS = [
  "pix_mode",
  "pix_key",
  "pix_key_type",
  "merchant_name",
  "merchant_city",
  "card_provider",
  "card_model",
  "card_enabled",
  "card_channel",
  "tef_enabled",
  "tef_provider",
  "tef_agent_url",
  "tef_terminal_id",
] as const;

// Canal do cartão (mesma lista do check da migration 077 e de src/lib/cardChannel.js).
const CANAIS_CARTAO = ["maquininha", "tef", "smartpos"];

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
    if (profile?.role !== "admin") {
      return json({ error: "Somente o administrador altera pagamentos" }, 403);
    }

    const limited = await rateLimited(admin, {
      key: `payment:save-settings:${companyId}`,
      max: 10,
      windowSeconds: 300,
    });
    if (limited) return limited;

    const body = await req.json().catch(() => ({}));

    // Canal do cartão: valor conhecido e canal utilizável. Smart POS só com um vinculado à
    // empresa; TEF só com o endereço do agente (do corpo ou do que já está gravado).
    if (body.card_channel !== undefined) {
      if (!CANAIS_CARTAO.includes(body.card_channel)) {
        return json({ error: "Canal de cartão inválido" }, 400);
      }
      if (body.card_channel === "smartpos") {
        const { data: vinculado } = await admin
          .from("connecttef_smartpos")
          .select("id")
          .eq("company_id", companyId)
          .eq("status", "vinculado")
          .limit(1)
          .maybeSingle();
        if (!vinculado) {
          return json({ error: "Vincule um Smart POS antes de escolher este canal" }, 409);
        }
      }
      if (body.card_channel === "tef") {
        const { data: atual } = await admin
          .from("company_payment_settings")
          .select("tef_agent_url")
          .eq("company_id", companyId)
          .maybeSingle();
        const agente = String(body.tef_agent_url ?? atual?.tef_agent_url ?? "").trim();
        if (!agente) {
          return json({ error: "Informe o endereço do agente TEF antes de escolher este canal" }, 409);
        }
      }
    }

    const settings: Record<string, unknown> = { company_id: companyId };
    for (const campo of CAMPOS) {
      if (body[campo] !== undefined) settings[campo] = body[campo];
    }
    settings.updated_at = new Date().toISOString();

    // Token/webhook secret: criptografados no Vault via RPC (migration 039) —
    // string vazia apaga (passa null pro RPC), ausente mantém o que já está
    // gravado (passa null também, já que o RPC só sobrescreve valor não-nulo).
    const token = body.mp_access_token;
    let tokenLimpo: string | null = null;
    if (typeof token === "string") {
      tokenLimpo = token.trim();
      if (tokenLimpo && !/^(APP_USR|TEST)-/.test(tokenLimpo)) {
        return json(
          { error: "Access Token inválido: deve começar com APP_USR- ou TEST-" },
          400,
        );
      }
      settings.mp_token_hint = tokenLimpo ? `••••${tokenLimpo.slice(-4)}` : null;
      settings.mp_token_updated_at = tokenLimpo ? new Date().toISOString() : null;
    }

    let webhookLimpo: string | null = null;
    if (typeof body.mp_webhook_secret === "string") {
      webhookLimpo = body.mp_webhook_secret.trim();
      settings.mp_webhook_configured = !!webhookLimpo;
    }

    if (tokenLimpo !== null || webhookLimpo !== null) {
      // Convenção do RPC: null = não mexe, "" = apaga, valor = grava/atualiza.
      const { error: segErr } = await admin.rpc("set_payment_secrets", {
        p_company_id: companyId,
        p_mp_access_token: tokenLimpo,
        p_mp_webhook_secret: webhookLimpo,
      });
      if (segErr) throw segErr;
    }

    const { data, error } = await admin
      .from("company_payment_settings")
      .upsert(settings, { onConflict: "company_id" })
      .select()
      .single();
    if (error) throw error;

    return json({ ok: true, settings: data });
  } catch (error) {
    // Detalhe fica só no log do servidor — nunca no corpo devolvido ao
    // cliente (podia vazar nome de tabela/coluna/detalhe do driver).
    console.error("save-payment-settings", error);
    return json({ error: "Erro interno ao salvar configuração de pagamento" }, 500);
  }
});
