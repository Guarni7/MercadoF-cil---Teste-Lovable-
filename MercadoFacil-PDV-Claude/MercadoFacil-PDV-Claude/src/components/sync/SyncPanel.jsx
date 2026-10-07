import React, { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useSyncStatus } from "@/hooks/useSyncStatus";
import { getSyncStats, retryErrors, clearSynced } from "@/lib/syncService";
import { format } from "date-fns";
import { RefreshCw, CheckCircle2, AlertTriangle, Clock, Monitor, Trash2, RotateCw } from "lucide-react";

export function SyncPanel({ open, onClose }) {
  const sync = useSyncStatus();
  const [stats, setStats] = useState(null);

  useEffect(() => {
    if (open) {
      loadStats();
    }
  }, [open, sync.lastSync, sync.pendingCount]);

  const loadStats = async () => {
    const s = await getSyncStats();
    setStats(s);
  };

  const handleSync = async () => {
    await sync.syncNow();
    await loadStats();
  };

  const handleRetry = async () => {
    await retryErrors();
    await loadStats();
  };

  const handleClear = async () => {
    await clearSynced();
    await loadStats();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Sincronização</DialogTitle>
          <DialogDescription>Status da conexão e fila de operações</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Status grid */}
          <div className="grid grid-cols-2 gap-3">
            <StatusCard
              label="Status"
              value={sync.isOnline ? "Online" : "Offline"}
              icon={sync.isOnline ? <CheckCircle2 className="w-4 h-4 text-emerald-500" /> : <AlertTriangle className="w-4 h-4 text-amber-500" />}
            />
            <StatusCard
              label="Terminal"
              value={stats?.terminal?.name || "CAIXA-01"}
              icon={<Monitor className="w-4 h-4 text-muted-foreground" />}
            />
            <StatusCard
              label="Pendentes"
              value={String(stats?.pending ?? sync.pendingCount)}
              icon={<Clock className="w-4 h-4 text-amber-500" />}
            />
            <StatusCard
              label="Sincronizados"
              value={String(stats?.synced ?? sync.syncedCount)}
              icon={<CheckCircle2 className="w-4 h-4 text-emerald-500" />}
            />
            <StatusCard
              label="Erros"
              value={String(stats?.errors ?? sync.errorCount)}
              icon={<AlertTriangle className="w-4 h-4 text-red-500" />}
            />
            <StatusCard
              label="Última sync"
              value={sync.lastSync ? format(new Date(sync.lastSync), "dd/MM HH:mm") : "—"}
              icon={<RefreshCw className="w-4 h-4 text-muted-foreground" />}
            />
          </div>

          {/* Terminal ID */}
          {stats?.terminal && (
            <div className="text-xs text-muted-foreground bg-muted rounded-lg p-3">
              Terminal: <span className="font-mono font-medium">{stats.terminal.id}</span>
            </div>
          )}

          {/* Erros */}
          {stats?.errorItems && stats.errorItems.length > 0 && (
            <div className="max-h-32 overflow-y-auto space-y-1">
              <p className="text-xs font-medium text-red-500 mb-1">Erros recentes:</p>
              {stats.errorItems.slice(0, 5).map((err) => (
                <div key={err.id} className="text-xs text-muted-foreground bg-red-500/5 rounded p-2">
                  <span className="font-medium">{err.operation}</span> em {err.entity}: {err.last_error}
                </div>
              ))}
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-2">
            <Button onClick={handleSync} disabled={!sync.isOnline || sync.status === "syncing"} className="flex-1 gap-2">
              <RefreshCw className={`w-4 h-4 ${sync.status === "syncing" ? "animate-spin" : ""}`} />
              Sincronizar agora
            </Button>
            {stats?.errors > 0 && (
              <Button variant="outline" onClick={handleRetry} className="gap-2">
                <RotateCw className="w-4 h-4" />
                Reprocessar erros
              </Button>
            )}
            {stats?.synced > 0 && (
              <Button variant="ghost" onClick={handleClear} className="gap-2" title="Limpar histórico sincronizado">
                <Trash2 className="w-4 h-4" />
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function StatusCard({ label, value, icon }) {
  return (
    <div className="bg-muted/50 rounded-lg p-3">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
        {icon}
        {label}
      </div>
      <div className="text-sm font-semibold">{value}</div>
    </div>
  );
}