// Fechar o app (ou "Reiniciar e instalar") com backup antes. Lógica pura, sem React: testada em
// scripts/smoke-fechamento-backup.mjs. Usa o backup local que já existe (runBackup, localBackup.js);
// aqui só ficam a ordem, o limite de tempo e as mensagens.
//
// Ordem segura: backup → confirmação → fechamento/instalação. Backup falhou? O operador escolhe:
// tentar de novo, fechar sem backup ou cancelar. Nada fecha sozinho depois de uma falha.

export const BACKUP_TIMEOUT_MS = 60_000;

export const MSG_BACKUP_NAO_SUBSTITUI_SYNC =
  "O backup é uma cópia local dos dados. Ele NÃO substitui a sincronização: o que ainda não subiu para a nuvem continua pendente até o sistema sincronizar.";
export const MSG_BACKUP_DEMOROU = "O backup demorou mais que o esperado e foi interrompido.";
export const MSG_BACKUP_FALHOU = "Não foi possível fazer o backup.";

/**
 * Roda o backup com limite de tempo. Nunca lança.
 * @param {{ runBackup: () => Promise<{ ok: boolean, error?: string }>, timeoutMs?: number }} p
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
export async function executarBackupComLimite({ runBackup, timeoutMs = BACKUP_TIMEOUT_MS }) {
  let timer;
  const limite = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ ok: false, error: MSG_BACKUP_DEMOROU }), timeoutMs);
  });
  try {
    const r = await Promise.race([Promise.resolve().then(runBackup), limite]);
    return r?.ok ? { ok: true } : { ok: false, error: r?.error || MSG_BACKUP_FALHOU };
  } catch (e) {
    return { ok: false, error: e?.message || MSG_BACKUP_FALHOU };
  } finally {
    clearTimeout(timer);
  }
}

/** Operações que ainda não subiram para a nuvem (pendentes + com erro). Nunca lança. */
export async function contarPendenciasDeSync(db) {
  try {
    const pendentes = await db.sync_queue.where("status").equals("pending").count();
    const comErro = await db.sync_queue.where("status").equals("error").count();
    return pendentes + comErro;
  } catch {
    return 0;
  }
}

/**
 * Máquina de estados do diálogo.
 *   pergunta → (fazer backup) → salvando → ok: concluir | falha: falhou
 *   falhou   → (tentar de novo) → salvando
 *   pergunta/falhou → (fechar sem backup) → concluir ; (cancelar) → cancelar
 * @param {"pergunta"|"salvando"|"falhou"} estado
 * @param {"fazerBackup"|"backupOk"|"backupFalhou"|"tentarNovamente"|"fecharSemBackup"|"cancelar"} evento
 * @returns {{ estado: "pergunta"|"salvando"|"falhou", acao: "concluir"|"cancelar"|null }}
 */
export function proximoEstado(estado, evento) {
  if (evento === "cancelar" && estado !== "salvando") return { estado, acao: "cancelar" };
  if (evento === "fecharSemBackup" && estado !== "salvando") return { estado, acao: "concluir" };
  if ((evento === "fazerBackup" && estado === "pergunta") || (evento === "tentarNovamente" && estado === "falhou")) return { estado: "salvando", acao: null };
  if (estado === "salvando" && evento === "backupOk") return { estado, acao: "concluir" };
  if (estado === "salvando" && evento === "backupFalhou") return { estado: "falhou", acao: null };
  return { estado, acao: null }; // evento que não vale neste estado (ex.: cancelar durante o backup)
}
