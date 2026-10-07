import { useState, useEffect } from "react";
import { subscribe, syncNow, initSync } from "@/lib/syncService";

/**
 * Hook que expõe o status de sincronização para a UI.
 * Inicializa o motor de sync na primeira utilização.
 */
let syncInitialized = false;

export function useSyncStatus() {
  const [state, setState] = useState(() => ({
    status: "idle",
    isOnline: navigator.onLine,
    pendingCount: 0,
    syncedCount: 0,
    errorCount: 0,
    lastSync: null,
    errors: [],
    terminal: "CAIXA-01",
  }));

  useEffect(() => {
    if (!syncInitialized) {
      syncInitialized = true;
      initSync();
    }

    const unsubscribe = subscribe(setState);
    return unsubscribe;
  }, []);

  const handleSyncNow = async () => {
    return await syncNow();
  };

  return { ...state, syncNow: handleSyncNow };
}