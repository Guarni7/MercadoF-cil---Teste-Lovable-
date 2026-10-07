// Rate limiting compartilhado por Edge Function — Priority 5 do Security Gate.
// Backend é a tabela public.rate_limit_hits + RPC check_rate_limit (migration
// 044): janela fixa em Postgres, sem serviço externo. Limites são generosos de
// propósito — o objetivo é barrar automação/abuso, não atrapalhar o caixa numa
// loja de movimento real.
import { adminClient, json } from "./mercadoPago.ts";

export type RateLimitRule = { key: string; max: number; windowSeconds: number };

/**
 * Retorna uma Response 429 se o limite foi excedido, ou null se pode seguir.
 * `key` já deve incluir o prefixo por rota (ex. "pix:gen:<company_id>") para
 * não colidir com o limite de outra função.
 */
export async function rateLimited(
  admin: ReturnType<typeof adminClient>,
  rule: RateLimitRule,
): Promise<Response | null> {
  const { data: ok, error } = await admin.rpc("check_rate_limit", {
    p_key: rule.key,
    p_max: rule.max,
    p_window_seconds: rule.windowSeconds,
  });
  // Falha ao checar o limite não deve derrubar a função inteira — segue e loga.
  if (error) {
    console.error("rateLimited: check_rate_limit falhou", error);
    return null;
  }
  if (ok) return null;
  return json(
    { error: "Muitas requisições em pouco tempo. Aguarde um instante e tente de novo." },
    429,
  );
}

/** IP do chamador, na cadeia de proxies do Supabase Edge Runtime. */
export function clientIp(req: Request): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
    req.headers.get("cf-connecting-ip") ||
    "unknown"
  );
}
