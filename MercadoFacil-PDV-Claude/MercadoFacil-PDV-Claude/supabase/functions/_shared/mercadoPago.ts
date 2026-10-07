// Resolução do Mercado Pago por empresa.
//
// O token é da conta do lojista: quem vende recebe. Ele fica em
// company_payment_secrets, tabela sem policy nenhuma — só o service role aqui
// dentro enxerga. O navegador nunca recebe o token de volta.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export function adminClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

/** Usuário autenticado + empresa e papel dele. */
export async function resolveCaller(req: Request) {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return { error: "Unauthorized" as const };

  const userClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data, error } = await userClient.auth.getUser();
  if (error || !data?.user) return { error: "Unauthorized" as const };

  const admin = adminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("company_id, role, company_role, full_name")
    .eq("id", data.user.id)
    .maybeSingle();

  return { user: data.user, profile: profile || null, admin };
}

export type TokenLookup =
  | { token: string; apiBase: string; sandbox: boolean }
  | { token: null };

/**
 * Token da empresa (nunca cai em token global: o dinheiro é do lojista).
 * mp_access_token vive criptografado no Vault (migration 039) — este RPC
 * SECURITY DEFINER, restrito a service_role, é o único jeito de ler o valor
 * decifrado; a tabela company_payment_secrets em si não guarda mais texto puro.
 */
export async function companyToken(
  admin: ReturnType<typeof adminClient>,
  companyId: string | null | undefined,
): Promise<TokenLookup> {
  if (!companyId) return { token: null };
  const { data } = await admin
    .rpc("get_payment_secrets", { p_company_id: companyId })
    .maybeSingle();

  const token = (data?.mp_access_token || "").trim();
  if (!token) return { token: null };
  return { token, sandbox: ehTeste(token), apiBase: API_BASE };
}

// Credencial de teste e de produção usam a mesma API; o antigo
// sandbox.api.mercadopago.com foi desativado e nem resolve mais em DNS, então
// todo token TEST- falhava aqui antes de chegar ao Mercado Pago.
export const API_BASE = "https://api.mercadopago.com";

const ehTeste = (token: string) => token.startsWith("TEST-");

export const NAO_CONFIGURADO =
  "Mercado Pago não configurado nesta loja. Cadastre o Access Token da sua conta em Configurações → Pagamento.";

export const PLATAFORMA_NAO_CONFIGURADA =
  "Pagamento de assinatura indisponível no momento. Fale com o suporte.";

/**
 * Cobrança de assinatura/add-on é da plataforma, não do lojista: usar o token
 * da loja aqui faria o cliente pagar para a própria conta dele.
 */
export function platformToken(): TokenLookup {
  const token = (Deno.env.get("MERCADO_PAGO_ACCESS_TOKEN") || "").trim();
  if (!token) return { token: null };
  return { token, sandbox: ehTeste(token), apiBase: API_BASE };
}

/** Mensagem que o lojista entende quando o Mercado Pago recusa a credencial. */
export function mensagemDoMercadoPago(status: number, data: unknown) {
  if (status === 401 || status === 403) {
    return "O Mercado Pago recusou o Access Token desta loja. Confira se copiou o token inteiro da sua conta.";
  }
  const msg = (data as { message?: string })?.message;
  return msg || "Erro ao gerar PIX no Mercado Pago";
}

/**
 * A referência externa carrega a empresa: é por ela que o webhook, que chega
 * sem nenhuma sessão, descobre de qual loja é o pagamento.
 */
export function buildExternalReference(companyId: string, sufixo: string) {
  return `mf:${companyId}:${sufixo}`.slice(0, 256);
}

export function parseExternalReference(ref: string) {
  const m = String(ref || "").match(
    /^mf:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):(.*)$/i,
  );
  return m ? { companyId: m[1], sufixo: m[2] } : { companyId: null, sufixo: ref };
}
