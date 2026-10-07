/**
 * Contato comercial / suporte (landing, ajuda, termos, Configurações → Suporte).
 * Atualize o e-mail quando o domínio estiver configurado.
 */
export const SUPPORT_PHONE_DISPLAY = "(62) 9 9250-6433";
export const SUPPORT_PHONE_E164 = "5562992506433";
export const SUPPORT_WHATSAPP_URL = `https://wa.me/${SUPPORT_PHONE_E164}`;
export const SUPPORT_TEL_URL = `tel:+${SUPPORT_PHONE_E164}`;

/** null enquanto o e-mail profissional não estiver pronto */
export const SUPPORT_EMAIL = null;
export const SUPPORT_EMAIL_DISPLAY = "E-mail em configuração";

export const SUPPORT_CITY = "Anápolis, GO — Brasil";

export function supportWhatsAppUrl(prefillText) {
  if (!prefillText) return SUPPORT_WHATSAPP_URL;
  return `${SUPPORT_WHATSAPP_URL}?text=${encodeURIComponent(prefillText)}`;
}
