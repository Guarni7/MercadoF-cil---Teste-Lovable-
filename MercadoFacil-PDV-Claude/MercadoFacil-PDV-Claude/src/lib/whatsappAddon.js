/**
 * Addon Integração WhatsApp — cobrança avulsa/mensal via Pix.
 * Status local (por navegador/terminal); liberação operacional em até 8h após pagamento.
 */

export const WHATSAPP_ADDON = {
  id: "whatsapp",
  title: "Integração WhatsApp",
  price: 19.9,
  priceLabel: "R$ 19,90",
  periodLabel: "/mês",
  releaseHours: 8,
  pixTtlMs: 3 * 60 * 60 * 1000, // 3h — bate com “Expira em ~2h 59m”
};

const STORAGE_KEY = "mf_whatsapp_addon";

/** @typedef {'none'|'pending_payment'|'paid'|'active'} WhatsAppAddonStatus */

export function getWhatsAppAddonState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { status: "none" };
    return JSON.parse(raw);
  } catch {
    return { status: "none" };
  }
}

export function setWhatsAppAddonState(patch) {
  const prev = getWhatsAppAddonState();
  const next = { ...prev, ...patch, updatedAt: new Date().toISOString() };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  return next;
}

export function clearWhatsAppAddonCharge() {
  const prev = getWhatsAppAddonState();
  if (prev.status === "active" || prev.status === "paid") return prev;
  localStorage.removeItem(STORAGE_KEY);
  return { status: "none" };
}

/** Addon utilizável (pago e dentro da janela de liberação ou já ativo). */
export function isWhatsAppAddonUnlocked() {
  const s = getWhatsAppAddonState();
  if (s.status === "active") return true;
  if (s.status === "paid" && s.paidAt) {
    const elapsed = Date.now() - new Date(s.paidAt).getTime();
    if (elapsed >= WHATSAPP_ADDON.releaseHours * 60 * 60 * 1000) {
      setWhatsAppAddonState({ status: "active" });
      return true;
    }
    return true; // pago: UI pode mostrar “em liberação”, mas já conta como contratado
  }
  return false;
}

export function formatPixCountdown(expiresAt) {
  if (!expiresAt) return null;
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return "Expirado";
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `Expira em ${h}h ${m}m ${s}s`;
  if (m > 0) return `Expira em ${m}m ${s}s`;
  return `Expira em ${s}s`;
}
