import React, { useState } from "react";
import { useSyncStatus } from "@/hooks/useSyncStatus";
import { SyncPanel } from "./SyncPanel";
import { cn } from "@/lib/utils";
import { WifiOff, RefreshCw, AlertTriangle, CheckCircle2 } from "lucide-react";

/**
 * Indicador global de status de sincronização.
 * 🟢 Online — Sincronizado
 * 🟡 Sincronizando...
 * 🟠 Offline — X operações pendentes
 * 🔴 Erro de sincronização
 */
export function SyncStatusIndicator() {
  const sync = useSyncStatus();
  const [panelOpen, setPanelOpen] = useState(false);

  const config = getIndicatorConfig(sync);

  return (
    <>
      <button
        onClick={() => setPanelOpen(true)}
        className={cn(
          "flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors",
          config.bg,
          config.text
        )}
        title={config.title}
      >
        {config.icon}
        <span className="hidden sm:inline">{config.label}</span>
        {sync.pendingCount > 0 && (
          <span className="ml-0.5 px-1.5 py-0.5 rounded-full bg-black/10 text-[10px] font-bold">
            {sync.pendingCount}
          </span>
        )}
      </button>

      <SyncPanel open={panelOpen} onClose={() => setPanelOpen(false)} />
    </>
  );
}

function getIndicatorConfig(sync) {
  if (!sync.isOnline) {
    return {
      label: `Offline — ${sync.pendingCount} pendente${sync.pendingCount !== 1 ? "s" : ""}`,
      icon: <WifiOff className="w-3.5 h-3.5" />,
      bg: "bg-amber-500/15",
      text: "text-amber-400",
      title: "Offline — operações na fila local",
    };
  }

  if (sync.status === "syncing") {
    return {
      label: "Sincronizando...",
      icon: <RefreshCw className="w-3.5 h-3.5 animate-spin" />,
      bg: "bg-blue-500/15",
      text: "text-blue-400",
      title: "Sincronizando com a nuvem...",
    };
  }

  if (sync.status === "error" || sync.errorCount > 0) {
    return {
      label: `Erro — ${sync.errorCount} falha${sync.errorCount !== 1 ? "s" : ""}`,
      icon: <AlertTriangle className="w-3.5 h-3.5" />,
      bg: "bg-red-500/15",
      text: "text-red-400",
      title: "Erro de sincronização — clique para ver detalhes",
    };
  }

  if (sync.pendingCount > 0) {
    return {
      label: `${sync.pendingCount} pendente${sync.pendingCount !== 1 ? "s" : ""}`,
      icon: <RefreshCw className="w-3.5 h-3.5" />,
      bg: "bg-amber-500/15",
      text: "text-amber-400",
      title: "Operações aguardando sincronização",
    };
  }

  return {
    label: "Online — Sincronizado",
    icon: <CheckCircle2 className="w-3.5 h-3.5" />,
    bg: "bg-emerald-500/15",
    text: "text-emerald-400",
    title: "Online e sincronizado com a nuvem",
  };
}