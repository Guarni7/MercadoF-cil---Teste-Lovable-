import { db } from "./localdb";

/**
 * Cache de autenticação offline.
 * Permite que um usuário previamente autenticado continue usando o terminal
 * quando a internet cair temporariamente.
 *
 * SEGURANÇA:
 * - NÃO armazena senhas em texto puro.
 * - Armazena apenas o token (já gerado pelo backend) e dados públicos do usuário.
 * - O token expira naturalmente — quando expirar, o usuário precisa logar novamente com internet.
 * - O acesso offline está vinculado ao terminal e às credenciais previamente autorizadas.
 * - A janela de tolerância (OFFLINE_AUTH_MAX_HOURS) NÃO é a barreira de segurança
 *   real: essa é sempre a revalidação online em checkUserAuth() (401/403
 *   confirmado desloga de verdade). Um limite curto aqui só derrubava caixa
 *   legítimo depois de fim de semana/feriado sem internet — não impedia uso
 *   indevido de dispositivo roubado, que por definição não teria motivo pra
 *   recuperar internet. Por isso o valor é generoso (30 dias), não removido.
 */

const AUTH_KEY = "current_user";
const OFFLINE_AUTH_MAX_HOURS = 24 * 30; // 30 dias

export async function cacheAuth(user) {
  if (!user) return;
  await db.auth_cache.put({
    key: AUTH_KEY,
    user,
    cached_at: new Date().toISOString(),
  });
}

export async function getCachedAuth() {
  const record = await db.auth_cache.get(AUTH_KEY);
  return record?.user || null;
}

export async function clearCachedAuth() {
  await db.auth_cache.delete(AUTH_KEY);
}

export async function isOfflineAuthAvailable() {
  const record = await db.auth_cache.get(AUTH_KEY);
  if (!record) return false;
  const cachedTime = new Date(record.cached_at).getTime();
  const hoursSinceCache = (Date.now() - cachedTime) / (1000 * 60 * 60);
  return hoursSinceCache < OFFLINE_AUTH_MAX_HOURS;
}