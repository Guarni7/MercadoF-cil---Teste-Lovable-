import { api } from "@/api/dataClient";

/**
 * Configuração de pagamento da empresa.
 *
 * Tudo isso vivia só no localStorage: quem configurasse o PIX no computador do
 * caixa 1 não veria nada no caixa 2, e limpar o cache do navegador apagava a
 * chave PIX da loja. Agora a fonte é a tabela company_payment_settings; o
 * localStorage fica como espelho para o PDV continuar cobrando offline.
 *
 * O Access Token do Mercado Pago não passa por aqui: ele fica guardado no
 * servidor e a tela só recebe os últimos dígitos.
 */
const KEY = "payment_config";

const PADRAO = {
  pix_mode: "manual",
  pix_key: "",
  pix_key_type: "email",
  merchant_name: "",
  merchant_city: "",
  card_provider: "mercadopago",
  card_model: "Moderninha Pro 2",
  card_enabled: true,
  // Canal do cartão: maquininha | tef | smartpos. Nulo = ainda não gravado; quem consome deduz
  // (canalDaConfig em cardChannel.js), igual ao comportamento de antes do campo existir.
  card_channel: null,
  tef_enabled: false,
  tef_provider: "sitef",
  tef_agent_url: "http://localhost:8080",
  tef_terminal_id: "",
  mp_token_hint: null,
};

export function getCachedPaymentConfig() {
  try {
    return { ...PADRAO, ...JSON.parse(localStorage.getItem(KEY) || "{}") };
  } catch {
    return { ...PADRAO };
  }
}

function cache(config) {
  try {
    localStorage.setItem(KEY, JSON.stringify(config));
  } catch {}
}

/**
 * Lê do banco e atualiza o espelho local. LANÇA erro se não conseguir ler (sem rede, sessão, RLS):
 * a tela de configuração precisa saber que a leitura falhou, para não deixar salvar valores padrão
 * por cima da configuração real. Empresa sem linha ainda (nova) é legítima: devolve o espelho/padrão.
 */
export async function lerPaymentConfigDoServidor() {
  const me = await api.auth.me();
  if (!me?.company_id) throw new Error("Empresa não identificada.");
  const linhas = await api.entities.CompanyPaymentSettings.filter({
    company_id: me.company_id,
  });
  const linha = Array.isArray(linhas) ? linhas[0] : linhas;
  if (!linha) return getCachedPaymentConfig();
  const config = { ...PADRAO, ...linha };
  cache(config);
  return config;
}

/** Lê do banco e atualiza o espelho local. Offline devolve o espelho. */
export async function syncPaymentConfig() {
  try {
    return await lerPaymentConfigDoServidor();
  } catch (e) {
    console.error("Erro ao carregar configuração de pagamento:", e);
    return getCachedPaymentConfig();
  }
}

/** Grava pela Edge Function (só ela enxerga o token) e atualiza o espelho. */
export async function savePaymentConfig(campos) {
  const res = await api.functions.invoke("savePaymentSettings", campos);
  const data = res?.data || res;
  if (data?.error) throw new Error(data.error);
  const config = { ...PADRAO, ...(data?.settings || {}) };
  cache(config);
  return config;
}
