// Backup local automático dos dados operacionais (Electron). Diferente de
// syncService.js: sync manda operações pendentes pra nuvem via sync_queue;
// backup é uma foto local pra recuperação, sem depender de internet — nunca
// toca na fila de sincronização.
import { db } from "@/lib/localdb";
import { electronWindow } from "@/lib/electronWindow";

const LAST_BACKUP_KEY = "last_backup_at";

// Só as tabelas operacionais — sync_queue/sync_history/auth_cache são
// estado de máquina, não dado de negócio que precise sobreviver num backup.
const BACKUP_TABLES = ["products", "categories", "customers", "sales", "stock_movements", "cash_registers"];

export const hasElectronBackup = () => !!electronWindow().electronAPI?.backup;

export async function getLastBackupAt() {
  const record = await db.settings.get(LAST_BACKUP_KEY);
  return record?.value || null;
}

/** Roda o backup agora. Não lança — erro vira `{ ok: false }`, nunca interrompe quem chamou. */
export async function runBackup() {
  const backup = electronWindow().electronAPI?.backup;
  if (!backup) return { ok: false, error: "Backup local só disponível no app desktop." };

  try {
    const payload = { version: 1, created_at: new Date().toISOString(), tables: {} };
    for (const table of BACKUP_TABLES) {
      payload.tables[table] = await db[table].toArray();
    }
    const result = await backup.write(payload);
    if (result?.ok) {
      await db.settings.put({ key: LAST_BACKUP_KEY, value: result.at });
    }
    return result;
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
}
