// Para onde mandar quem NÃO está autenticado (ProtectedRoute, em App.jsx).
//
//   Web      → /landing (página pública do produto): comportamento de sempre, inalterado.
//   Desktop  → /login: o app instalado não é uma vitrine, o usuário quer entrar. A landing continua
//              existindo e acessível por URL; só deixa de ser o destino automático.
//
// Só decide o destino. Quem decide se há sessão continua sendo o AuthContext (sessão do Supabase,
// login em cache offline): sem sessão, online ou offline, cai aqui do mesmo jeito.
// Função pura (sem React): testada em scripts/smoke-destino-nao-autenticado.mjs.

/** Está rodando dentro do app desktop (preload do Electron expõe window.electronAPI.isElectron)? */
export const ehElectron = () => typeof window !== "undefined" && /** @type {any} */ (window).electronAPI?.isElectron === true;

/**
 * @param {{ electron: boolean, pathname?: string, search?: string }} p
 * @returns {string} rota de destino
 */
export function destinoNaoAutenticado({ electron, pathname = "/", search = "" }) {
  if (!electron) return "/landing";
  // Deep link (ex.: /pdv sem sessão): o Login já lê ?returnTo= (safeReturnTo valida que é do mesmo
  // site) e volta para ele depois de entrar. A raiz não precisa de returnTo.
  const volta = `${pathname}${search}`;
  return volta && volta !== "/" ? `/login?returnTo=${encodeURIComponent(volta)}` : "/login";
}
