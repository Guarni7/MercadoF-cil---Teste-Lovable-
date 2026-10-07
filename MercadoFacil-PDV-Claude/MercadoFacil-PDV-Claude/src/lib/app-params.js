/**
 * Params de app (compat). Auth real: src/lib/supabase.js.
 */
const isNode = typeof window === "undefined";

/**
 * Faxina de tokens do sistema antigo que podem ter ficado no navegador de quem
 * já usava o PDV. Não são lidos por nada aqui — só ocupam espaço e confundem
 * quem inspeciona o storage.
 */
const clearLegacyTokens = () => {
  if (isNode) return;
  try {
    window.localStorage.removeItem("base44_access_token");
    window.localStorage.removeItem("token");
  } catch {}
};

clearLegacyTokens();

export const appParams = {
  appId: import.meta.env.VITE_SUPABASE_URL ? "supabase" : null,
  token: null,
  functionsVersion: null,
  appBaseUrl: typeof window !== "undefined" ? window.location.origin : "",
};
