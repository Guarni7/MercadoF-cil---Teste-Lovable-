/**
 * Versão do app exibida no PDV (rodapé, Suporte, Histórico). Vem do package.json,
 * injetada pelo Vite em tempo de build (vite.config.js → __APP_VERSION__): web e
 * Electron mostram a mesma versão do instalador, sem número escrito à mão.
 * Fora do Vite (scripts de teste em Node) cai em "0.0.0".
 */
/* global __APP_VERSION__ */
export const APP_VERSION = typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "0.0.0";
// Mesmo esquema de PENDING_VERSION_CODE: 3.79.2 → 37902, 1.4.0 → 10400.
export const APP_VERSION_CODE = APP_VERSION.split(".").reduce((acc, n, i) => acc + (parseInt(n, 10) || 0) * [10000, 100, 1][i], 0);

/** Próxima versão planejada — notes salvas; features ainda NÃO implementadas. */
export const PENDING_VERSION = "3.79.2";
export const PENDING_VERSION_CODE = 37902;

const STORAGE_INSTALLED = "mf_app_version";
const STORAGE_SKIPPED = "mf_update_skipped";
const STORAGE_SEEN_UPDATED = "mf_seen_updated";
const STORAGE_COMMERCIAL = "mf_commercial_modules_trial";

export function getInstalledVersion() {
  try {
    return localStorage.getItem(STORAGE_INSTALLED) || APP_VERSION;
  } catch {
    return APP_VERSION;
  }
}

export function setInstalledVersion(version) {
  try {
    localStorage.setItem(STORAGE_INSTALLED, version);
  } catch {}
}

export function wasUpdateSkipped(version) {
  try {
    return localStorage.getItem(STORAGE_SKIPPED) === version;
  } catch {
    return false;
  }
}

export function skipUpdate(version) {
  try {
    localStorage.setItem(STORAGE_SKIPPED, version);
  } catch {}
}

export function clearSkippedUpdate() {
  try {
    localStorage.removeItem(STORAGE_SKIPPED);
  } catch {}
}

export function hasSeenUpdatedModal(version) {
  try {
    return localStorage.getItem(STORAGE_SEEN_UPDATED) === version;
  } catch {
    return false;
  }
}

export function markUpdatedModalSeen(version) {
  try {
    localStorage.setItem(STORAGE_SEEN_UPDATED, version);
  } catch {}
}

export function saveCommercialTrialSelection(ids) {
  try {
    localStorage.setItem(STORAGE_COMMERCIAL, JSON.stringify({ ids, at: new Date().toISOString() }));
  } catch {}
}

export function compareVersions(a, b) {
  const pa = String(a).split(".").map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split(".").map((n) => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d > 0 ? 1 : -1;
  }
  return 0;
}

export function isUpdateAvailable(latest = PENDING_VERSION) {
  return compareVersions(latest, getInstalledVersion()) > 0;
}
