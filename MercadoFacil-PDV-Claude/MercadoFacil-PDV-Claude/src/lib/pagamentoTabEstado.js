// Estado da aba Configurações > Pagamento a partir da configuração de pagamento da empresa.
//
// Antes, a aba nascia com valores padrão e só ~1 s depois (rede) mostrava o que estava salvo, e
// nesse intervalo os botões de salvar já funcionavam: clicar neles gravava os padrões por cima da
// configuração real. Agora a primeira pintura já vem do espelho local (getCachedPaymentConfig) e a
// aba só libera o salvamento depois de ler o servidor.
//
// Função pura, sem React nem imports `@/` além de cardChannel (também puro), para testar em Node.
import { canalDaConfig } from "./cardChannel.js";

/**
 * @param {Record<string, any> | null | undefined} cfg configuração (espelho local ou do servidor)
 * @param {{ temSmartPos?: boolean }} [opcoes] `temSmartPos` vem do servidor (há Smart POS vinculado?).
 *   Sem ele (primeira pintura, só com o espelho), um canal `smartpos` já gravado implica Smart POS
 *   vinculado: serve só para a tela não piscar, e o salvamento continua bloqueado até o servidor confirmar.
 */
export function estadoDaConfig(cfg, { temSmartPos } = {}) {
  const c = cfg || {};
  const tsp = typeof temSmartPos === "boolean" ? temSmartPos : c.card_channel === "smartpos";
  const canal = canalDaConfig(c, { temSmartPos: tsp });
  return {
    temSmartPos: tsp,
    cardChannel: canal,
    canalSalvo: canal,
    pixMode: c.pix_mode || "manual",
    pixKey: c.pix_key || "",
    pixKeyType: c.pix_key_type || "email",
    merchantName: c.merchant_name || "",
    merchantCity: c.merchant_city || "",
    tokenHint: c.mp_token_hint || null,
    pixConfigured: !!c.mp_token_hint,
    webhookSecretSalvo: !!c.mp_webhook_configured,
    cardProvider: c.card_provider || "mercadopago",
    cardModel: c.card_model || "Moderninha Pro 2",
    cardEnabled: c.card_enabled !== false,
    tefEnabled: !!c.tef_enabled,
    tefProvider: c.tef_provider || "sitef",
    tefAgentUrl: c.tef_agent_url || "http://localhost:8080",
    tefTerminalId: c.tef_terminal_id || "",
  };
}

/** Pode salvar? Só depois de ler a configuração real e sem erro de carga. */
export const podeSalvarPagamento = ({ carregando, erroCarga }) => !carregando && !erroCarga;
