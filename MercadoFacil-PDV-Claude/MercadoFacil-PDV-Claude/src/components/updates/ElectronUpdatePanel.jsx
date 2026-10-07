import React, { useEffect, useState } from "react";
import { CheckCircle2, Download, RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { APP_VERSION } from "@/lib/appVersion";
import { aplicarEvento, descreverPainel, estadoInicial, painelVisivel } from "@/lib/atualizacaoDesktop";
import { electronWindow } from "@/lib/electronWindow";
import { EVENTO_INSTALAR_AGORA } from "./FechamentoComBackupHost";

/**
 * Painel da atualização REAL do desktop (electron-updater): versão atual → nova, progresso do download
 * (percentual e MB), "Atualização pronta / será instalada ao fechar" e "Reiniciar e instalar agora".
 * O download é automático (autoDownload no main). O botão passa pelo backup antes de reiniciar
 * (FechamentoComBackupHost). Na web não existe: não renderiza nada.
 */
export default function ElectronUpdatePanel() {
  const [estado, setEstado] = useState(estadoInicial);
  const [dispensadoPara, setDispensadoPara] = useState(null); // versão cujo aviso "pronta" o operador dispensou

  useEffect(() => {
    const update = electronWindow().electronAPI?.update;
    if (!update) return undefined;
    let vivo = true;
    // estado atual (o app pode ter baixado antes de esta tela montar)
    update
      .status()
      .then((st) => vivo && setEstado((atual) => aplicarEvento(atual, st)))
      .catch(() => {});
    const sair = update.onChange((evento) => setEstado((atual) => aplicarEvento(atual, evento)));
    return () => {
      vivo = false;
      sair();
    };
  }, []);

  if (!painelVisivel(estado)) return null;
  const painel = descreverPainel(estado, APP_VERSION);
  if (painel.pronta && dispensadoPara === estado.info) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[60] w-[22rem] max-w-[calc(100vw-2rem)] rounded-xl border border-emerald-200 bg-white p-4 shadow-lg" role="status" aria-live="polite" data-testid="painel-atualizacao">
      <div className="flex items-start gap-2">
        {painel.pronta ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" /> : <Download className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700" />}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">{painel.titulo}</p>
          <p className="text-xs text-muted-foreground">
            Versão atual <span className="font-medium text-foreground">{painel.versaoAtual}</span>
            {painel.versaoNova && (
              <>
                {" "}→ nova versão <span className="font-medium text-foreground">{painel.versaoNova}</span>
              </>
            )}
          </p>
        </div>
        {painel.pronta && (
          <button type="button" className="rounded-full p-1 text-muted-foreground hover:bg-black/5" aria-label="Dispensar" onClick={() => setDispensadoPara(estado.info)}>
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {painel.mostrarBarra && (
        <div className="mt-3">
          <Progress value={painel.percentual ?? 0} className="h-2" aria-label="Progresso do download" />
          <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
            <span>{painel.detalhe}</span>
            <span>{painel.progresso}</span>
          </div>
        </div>
      )}

      {painel.pronta && (
        <Button size="sm" className="mt-3 w-full gap-2" onClick={() => window.dispatchEvent(new Event(EVENTO_INSTALAR_AGORA))}>
          <RefreshCw className="h-4 w-4" /> Reiniciar e instalar agora
        </Button>
      )}
    </div>
  );
}
