import React, { useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  X,
  Sparkles,
  UtensilsCrossed,
  ClipboardList,
  FileText,
  PackageOpen,
  Car,
  Wrench,
  Smartphone,
  Check,
} from "lucide-react";
import { COMMERCIAL_MODULES } from "@/lib/releaseNotes";
import { cn } from "@/lib/utils";

const ICONS = {
  mesas: UtensilsCrossed,
  comandas: ClipboardList,
  orcamentos: FileText,
  condicionais: PackageOpen,
  os_veiculo: Car,
  os_geral: Wrench,
  at_cel: Smartphone,
};

/**
 * Popup pós-atualização: trial de módulos comerciais (só UI / seleção local).
 */
export default function CommercialModulesDialog({ open, onClose, onConfirm }) {
  const [selected, setSelected] = useState(() => new Set());

  const toggle = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleConfirm = () => {
    onConfirm?.(Array.from(selected));
    onClose?.();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose?.()}>
      <DialogContent
        className="max-w-md p-0 gap-0 overflow-hidden border-0 bg-[#F5F6F6] sm:rounded-2xl [&>button]:hidden max-h-[90vh] flex flex-col"
        aria-describedby={undefined}
      >
        <div className="relative px-5 pt-5 pb-2 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="absolute right-4 top-4 rounded-full p-1 text-muted-foreground hover:bg-black/5"
            aria-label="Fechar"
          >
            <X className="w-4 h-4" />
          </button>
          <div className="flex items-start gap-2 pr-8 mb-2">
            <Sparkles className="w-5 h-5 text-[#2F5C56] mt-0.5 shrink-0" />
            <DialogTitle className="text-lg font-bold text-[#2D2D2D] leading-snug">
              Quer testar os módulos comerciais?
            </DialogTitle>
          </div>
          <p className="text-sm text-muted-foreground pl-7">
            Além do PDV, o sistema tem fluxos prontos para salão, serviços e entrega. Marque o que
            quiser experimentar — no teste você usa sem pagar.
          </p>
        </div>

        <div className="px-5 py-2 overflow-y-auto flex-1 space-y-2">
          {COMMERCIAL_MODULES.map((mod) => {
            const Icon = ICONS[mod.id] || Sparkles;
            const on = selected.has(mod.id);
            return (
              <button
                key={mod.id}
                type="button"
                onClick={() => toggle(mod.id)}
                className={cn(
                  "w-full text-left rounded-xl border bg-white px-3 py-3 flex items-start gap-3 transition-colors",
                  on ? "border-[#2F5C56] ring-1 ring-[#2F5C56]/30" : "border-black/10 hover:border-black/20"
                )}
              >
                <div className="w-9 h-9 rounded-lg bg-[#E8F0EE] flex items-center justify-center shrink-0">
                  <Icon className="w-4 h-4 text-[#2F5C56]" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-sm text-[#2D2D2D]">{mod.title}</span>
                    {mod.priceLabel && (
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[#E8F0EE] text-[#2F5C56]">
                        {mod.priceLabel}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">{mod.description}</p>
                </div>
                <span
                  className={cn(
                    "mt-1 w-5 h-5 rounded-full border flex items-center justify-center shrink-0",
                    on ? "bg-[#2F5C56] border-[#2F5C56] text-white" : "border-black/25"
                  )}
                >
                  {on && <Check className="w-3 h-3" />}
                </span>
              </button>
            );
          })}
        </div>

        <div className="px-5 pt-2 pb-5 shrink-0">
          <button
            type="button"
            onClick={handleConfirm}
            className="w-full rounded-full bg-[#2F5C56] py-3 text-sm font-semibold text-white hover:bg-[#274e49] flex items-center justify-center gap-2"
          >
            <Sparkles className="w-4 h-4" />
            Marque o que quer testar
          </button>
          <button
            type="button"
            onClick={onClose}
            className="mt-3 w-full text-center text-sm font-semibold text-[#2D2D2D] hover:underline"
          >
            Agora não
          </button>
          <p className="mt-2 text-center text-[11px] text-muted-foreground">
            Dá para ativar depois em Sistema → Configurações → Comercial.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
