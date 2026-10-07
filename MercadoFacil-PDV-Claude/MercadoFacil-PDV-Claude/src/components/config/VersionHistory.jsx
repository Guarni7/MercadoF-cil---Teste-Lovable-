import React from "react";
import { APP_VERSION } from "@/lib/appVersion";

export default function VersionHistory() {
  return (
    <div className="mt-4 p-5 rounded-lg bg-emerald-50 border border-emerald-100">
      <div className="flex items-center justify-between mb-3">
        <span className="text-emerald-700 font-semibold text-sm">v{APP_VERSION} (atual)</span>
      </div>
      <div className="space-y-1.5 text-sm">
        <div className="font-semibold">Lançamento</div>
        <div className="text-muted-foreground">- Versão inicial do MercadoFácil PDV;</div>
        <div className="text-muted-foreground">- PDV, caixa, produtos, clientes e configurações;</div>
        <div className="text-muted-foreground">- Impressão de cupom e fluxo de atualizações;</div>
      </div>
    </div>
  );
}
