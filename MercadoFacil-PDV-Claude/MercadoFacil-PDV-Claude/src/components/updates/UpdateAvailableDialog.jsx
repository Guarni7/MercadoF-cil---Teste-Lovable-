import React from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { RefreshCw, Download, X } from "lucide-react";
import { APP_VERSION } from "@/lib/appVersion";
import { PENDING_RELEASE } from "@/lib/releaseNotes";

/**
 * Popup "Atualização disponível" — UI only (não baixa/instala de verdade).
 */
export default function UpdateAvailableDialog({
  open,
  onSkip,
  onUpdate,
  onClose,
  currentVersion = APP_VERSION,
  latestVersion = PENDING_RELEASE.version,
  notes = PENDING_RELEASE.notes,
}) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose?.()}>
      <DialogContent
        className="max-w-md p-0 gap-0 overflow-hidden border-0 bg-[#F3F4F4] sm:rounded-2xl [&>button]:hidden"
        aria-describedby={undefined}
      >
        <div className="relative px-5 pt-5 pb-4">
          <button
            type="button"
            onClick={onClose}
            className="absolute right-4 top-4 rounded-full p-1 text-muted-foreground hover:bg-black/5"
            aria-label="Fechar"
          >
            <X className="w-4 h-4" />
          </button>

          <div className="flex items-center gap-2 mb-4 pr-8">
            <RefreshCw className="w-5 h-5 text-[#2F5C56]" />
            <DialogTitle className="text-lg font-bold text-[#2D2D2D]">
              Atualização disponível
            </DialogTitle>
          </div>

          <div className="rounded-xl border border-[#2F5C56]/25 bg-[#E8F0EE] px-4 py-3 mb-4 flex items-center justify-between gap-3">
            <div>
              <p className="text-[11px] text-muted-foreground">Versão atual</p>
              <p className="text-sm font-semibold text-[#2D2D2D]">{currentVersion}</p>
            </div>
            <div className="text-right">
              <p className="text-[11px] text-muted-foreground">Nova versão</p>
              <p className="text-sm font-bold text-[#2F5C56]">{latestVersion}</p>
            </div>
          </div>

          <p className="text-sm font-medium text-[#2D2D2D] mb-2">O que mudou:</p>
          <div className="rounded-xl bg-white border border-black/5 px-4 py-3 max-h-56 overflow-y-auto">
            <p className="text-xs font-semibold text-[#2F5C56] mb-2">Versão {latestVersion}</p>
            <ul className="space-y-1.5 text-sm text-[#3A3A3A]">
              {notes.map((item) => (
                <li key={item} className="flex gap-2">
                  <span className="text-[#2F5C56] shrink-0">•</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="mt-5 flex gap-3">
            <button
              type="button"
              onClick={onSkip}
              className="flex-1 rounded-full border border-[#2D2D2D]/20 bg-white py-2.5 text-sm font-semibold text-[#2D2D2D] hover:bg-black/[0.03]"
            >
              Pular
            </button>
            <button
              type="button"
              onClick={onUpdate}
              className="flex-1 rounded-full bg-[#2F5C56] py-2.5 text-sm font-semibold text-white hover:bg-[#274e49] flex items-center justify-center gap-2"
            >
              <Download className="w-4 h-4" />
              Atualizar
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
