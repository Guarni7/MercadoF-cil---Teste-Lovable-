import React from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { ArrowUp, X } from "lucide-react";
import { PENDING_RELEASE } from "@/lib/releaseNotes";

/**
 * Popup "Sistema Atualizado!" — após confirmar atualização (UI only).
 */
export default function SystemUpdatedDialog({
  open,
  onClose,
  version = PENDING_RELEASE.version,
  notes = PENDING_RELEASE.notes,
}) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose?.()}>
      <DialogContent
        className="max-w-md p-0 gap-0 overflow-hidden border-0 bg-white sm:rounded-2xl [&>button]:hidden"
        aria-describedby={undefined}
      >
        <div className="relative px-5 pt-5 pb-5">
          <button
            type="button"
            onClick={onClose}
            className="absolute right-4 top-4 rounded-full p-1 text-muted-foreground hover:bg-black/5"
            aria-label="Fechar"
          >
            <X className="w-4 h-4" />
          </button>

          <div className="flex items-start gap-3 mb-4 pr-8">
            <div className="w-11 h-11 rounded-full bg-[#E8F0EE] flex items-center justify-center shrink-0">
              <ArrowUp className="w-5 h-5 text-[#2F5C56]" />
            </div>
            <div>
              <DialogTitle className="text-lg font-bold text-[#2D2D2D]">
                Sistema Atualizado!
              </DialogTitle>
              <p className="text-sm text-muted-foreground">Versão {version}</p>
            </div>
          </div>

          <div className="rounded-xl bg-[#F3F4F4] px-4 py-3 max-h-64 overflow-y-auto">
            <p className="text-[10px] font-semibold tracking-wide text-muted-foreground mb-1">
              O QUE MUDOU NESTA VERSÃO
            </p>
            <p className="text-xs font-semibold text-[#2D2D2D] mb-2">Versão {version}</p>
            <ul className="space-y-1.5 text-sm text-[#3A3A3A]">
              {notes.map((item) => (
                <li key={item} className="flex gap-2">
                  <span className="shrink-0">*</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="mt-5 w-full rounded-full bg-[#2F5C56] py-3 text-sm font-semibold text-white hover:bg-[#274e49]"
          >
            Fechar
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
