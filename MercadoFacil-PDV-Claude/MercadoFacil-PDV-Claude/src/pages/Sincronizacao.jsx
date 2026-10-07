import React, { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useSyncStatus } from "@/hooks/useSyncStatus";
import { useLocalBackup } from "@/hooks/useLocalBackup";
import { getSyncStats, retryErrors, clearSynced, resolveStockPending } from "@/lib/syncService";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";
import { RefreshCw, CheckCircle2, AlertTriangle, Clock, Monitor, Trash2, RotateCw, Wifi, WifiOff, History, HardDriveDownload, PackageX } from "lucide-react";

export default function Sincronizacao() {
  const sync = useSyncStatus();
  const backup = useLocalBackup();
  const [stats, setStats] = useState(null);

  const loadStats = useCallback(async () => {
    const s = await getSyncStats();
    setStats(s);
  }, []);

  useEffect(() => {
    loadStats();
  }, [loadStats, sync.lastSync, sync.pendingCount, sync.status]);

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

  const handleResolveStock = async (id) => {
    const notes = prompt("Conferido — o que foi feito? (opcional, fica registrado)") || "";
    try {
      await resolveStockPending(id, notes);
      toast.success("Pendência marcada como resolvida.");
      await loadStats();
    } catch (e) {
      console.error(e);
      toast.error("Não foi possível marcar como resolvida.");
    }
  };

  return (
    <div className="p-6 space-y-6 max-w-4xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold mb-1">Sincronização</h1>
        <p className="text-muted-foreground text-sm">Gerencie a sincronização entre o terminal local e a nuvem</p>
      </div>

      {/* Status principal */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          label="Status"
          value={sync.isOnline ? "Online" : "Offline"}
          icon={sync.isOnline ? <Wifi className="w-5 h-5 text-emerald-500" /> : <WifiOff className="w-5 h-5 text-amber-500" />}
          color={sync.isOnline ? "emerald" : "amber"}
        />
        <StatCard
          label="Pendentes"
          value={String(stats?.pending ?? 0)}
          icon={<Clock className="w-5 h-5 text-amber-500" />}
          color="amber"
        />
        <StatCard
          label="Sincronizados"
          value={String(stats?.synced ?? 0)}
          icon={<CheckCircle2 className="w-5 h-5 text-emerald-500" />}
          color="emerald"
        />
        <StatCard
          label="Erros"
          value={String(stats?.errors ?? 0)}
          icon={<AlertTriangle className="w-5 h-5 text-red-500" />}
          color="red"
        />
      </div>

      {/* Info do terminal */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Monitor className="w-4 h-4" /> Terminal
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <InfoRow label="Nome" value={stats?.terminal?.name || "—"} />
          <InfoRow label="ID" value={stats?.terminal?.id || "—"} mono />
          <InfoRow
            label="Última sincronização"
            value={sync.lastSync ? format(new Date(sync.lastSync), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR }) : "Nunca"}
          />
        </CardContent>
      </Card>

      {/* Ações */}
      <div className="flex flex-wrap gap-3">
        <Button onClick={handleSync} disabled={!sync.isOnline || sync.status === "syncing"} className="gap-2">
          <RefreshCw className={`w-4 h-4 ${sync.status === "syncing" ? "animate-spin" : ""}`} />
          Sincronizar agora
        </Button>
        {(stats?.errors ?? 0) > 0 && (
          <Button variant="outline" onClick={handleRetry} className="gap-2">
            <RotateCw className="w-4 h-4" />
            Reprocessar erros
          </Button>
        )}
        {(stats?.synced ?? 0) > 0 && (
          <Button variant="ghost" onClick={handleClear} className="gap-2">
            <Trash2 className="w-4 h-4" />
            Limpar histórico
          </Button>
        )}
      </div>

      {/* Erros detalhados */}
      {stats?.errorItems && stats.errorItems.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base text-red-500">
              <AlertTriangle className="w-4 h-4" /> Erros de Sincronização
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 max-h-64 overflow-y-auto">
            {stats.errorItems.map((err) => (
              <div key={err.id} className="text-sm bg-red-500/5 border border-red-500/10 rounded-lg p-3">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-medium">{err.operation}</span>
                  <span className="text-xs text-muted-foreground">{err.entity}</span>
                </div>
                <p className="text-xs text-red-500">{err.last_error}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Tentativas: {err.attempts || 0}
                </p>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Pendências de estoque — venda offline sincronizou, mas a baixa de
          estoque foi recusada (saldo insuficiente no servidor quando a fila
          rodou). Não é erro de sincronização comum: a venda e a fila
          sincronizaram normalmente, só a baixa que ficou pendente. */}
      {stats?.stockPending && stats.stockPending.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base text-amber-600">
              <PackageX className="w-4 h-4" /> Pendências de Estoque ({stats.stockPending.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 max-h-80 overflow-y-auto">
            <p className="text-xs text-muted-foreground mb-2">
              Venda offline sincronizada normalmente, mas sem estoque suficiente no servidor no
              momento — a baixa não foi feita (estoque nunca fica negativo). Confira manualmente e
              marque como resolvida.
            </p>
            {stats.stockPending.map((p) => (
              <div key={p.id} className="text-sm bg-amber-500/5 border border-amber-500/20 rounded-lg p-3">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-medium">{p.product_name || p.product_id}</span>
                  <span className="text-xs text-muted-foreground">Qtd: {p.quantity}</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Venda: {p.sale_id ? p.sale_id.slice(0, 8) : (p.sale_client_id || "—").slice(0, 8)}
                  {" · "}
                  {p.created_at ? format(new Date(p.created_at), "dd/MM/yyyy HH:mm", { locale: ptBR }) : "—"}
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-2 h-7 text-xs"
                  onClick={() => handleResolveStock(p.id)}
                >
                  Marcar como resolvida
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Histórico */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <History className="w-4 h-4" /> Histórico de Sincronizações
          </CardTitle>
        </CardHeader>
        <CardContent>
          {stats?.history && stats.history.length > 0 ? (
            <div className="space-y-2">
              {stats.history.map((h) => (
                <div key={h.id} className="flex items-center justify-between text-sm border-b last:border-0 pb-2 last:pb-0">
                  <span className="text-muted-foreground">
                    {format(new Date(h.synced_at), "dd/MM/yyyy 'às' HH:mm:ss", { locale: ptBR })}
                  </span>
                  <div className="flex items-center gap-3">
                    <span className="text-emerald-600 font-medium">{h.synced_count} sync</span>
                    {h.error_count > 0 && (
                      <span className="text-red-500 font-medium">{h.error_count} erros</span>
                    )}
                    <span
                      className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                        h.status === "success" ? "bg-emerald-500/10 text-emerald-600" : "bg-amber-500/10 text-amber-600"
                      }`}
                    >
                      {h.status === "success" ? "Sucesso" : "Parcial"}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-4">Nenhuma sincronização realizada ainda</p>
          )}
        </CardContent>
      </Card>

      {/* Backup local — não é sincronização: é uma cópia local dos dados
          operacionais, pra recuperação sem depender de internet. */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <HardDriveDownload className="w-4 h-4" /> Backup local
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Cópia automática dos dados do terminal, salva no próprio computador. Roda sozinha em
            segundo plano — não precisa de internet nem de ação sua.
          </p>
          <InfoRow
            label="Último backup"
            value={
              backup.lastBackupAt
                ? format(new Date(backup.lastBackupAt), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })
                : "Ainda não realizado"
            }
          />
          <Button
            variant="outline"
            onClick={backup.backupNow}
            disabled={!backup.hasElectronBackup || backup.backingUp}
            className="gap-2"
          >
            <HardDriveDownload className={`w-4 h-4 ${backup.backingUp ? "animate-pulse" : ""}`} />
            {backup.backingUp ? "Fazendo backup..." : "Fazer backup agora"}
          </Button>
          {!backup.hasElectronBackup && (
            <p className="text-xs text-muted-foreground">Disponível apenas no app desktop instalado.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({ label, value, icon, color }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
          {icon}
          {label}
        </div>
        <div className="text-2xl font-bold">{value}</div>
      </CardContent>
    </Card>
  );
}

/** @param {{ label: string, value: React.ReactNode, mono?: boolean }} props */
function InfoRow({ label, value, mono }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className={mono ? "font-mono text-xs" : "font-medium"}>{value}</span>
    </div>
  );
}