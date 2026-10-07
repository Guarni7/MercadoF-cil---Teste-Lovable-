import { useState, useEffect, useCallback } from "react";
import { hasElectronBackup, runBackup, getLastBackupAt } from "@/lib/localBackup";

// A cada 30min cobre um turno de loja sem gerar tráfego de disco constante;
// primeiro backup sai cedo (2min) pra não depender de o turno durar 30min.
const BACKUP_INTERVAL_MS = 30 * 60 * 1000;
const FIRST_BACKUP_DELAY_MS = 2 * 60 * 1000;

let backupInitialized = false;

/** Backup local automático (Electron) — roda sozinho, sem ação do usuário. */
export function useLocalBackup() {
  const [lastBackupAt, setLastBackupAt] = useState(null);
  const [backingUp, setBackingUp] = useState(false);

  const refreshLastBackupAt = useCallback(async () => {
    setLastBackupAt(await getLastBackupAt());
  }, []);

  const backupNow = useCallback(async () => {
    if (!hasElectronBackup()) return { ok: false, error: "Backup local só disponível no app desktop." };
    setBackingUp(true);
    try {
      const result = await runBackup();
      await refreshLastBackupAt();
      return result;
    } finally {
      setBackingUp(false);
    }
  }, [refreshLastBackupAt]);

  useEffect(() => {
    refreshLastBackupAt();
    if (!hasElectronBackup() || backupInitialized) return;
    backupInitialized = true;

    // ponytail: timers simples (setTimeout + setInterval), sem fila/retry —
    // runBackup() já não lança e o próximo tick tenta de novo sozinho.
    const first = setTimeout(() => {
      runBackup().finally(refreshLastBackupAt);
    }, FIRST_BACKUP_DELAY_MS);
    const interval = setInterval(() => {
      runBackup().finally(refreshLastBackupAt);
    }, BACKUP_INTERVAL_MS);

    return () => {
      clearTimeout(first);
      clearInterval(interval);
    };
  }, [refreshLastBackupAt]);

  return { lastBackupAt, backingUp, backupNow, hasElectronBackup: hasElectronBackup() };
}
