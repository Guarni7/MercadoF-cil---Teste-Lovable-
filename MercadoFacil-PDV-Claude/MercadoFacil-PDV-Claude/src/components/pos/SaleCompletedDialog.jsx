import React, { useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Printer, MessageCircle } from "lucide-react";
import { formatBRL } from "@/lib/format";

export default function SaleCompletedDialog({ open, onClose, total, onPrint, onWhatsApp }) {
  useEffect(() => {
    if (!open) return;
    const handleKey = (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        onPrint?.();
      } else if (e.key === "Escape") {
        e.preventDefault();
        onClose?.();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open, onPrint, onClose]);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-sm p-0 gap-0 overflow-hidden text-center">
        <DialogHeader className="p-4 flex flex-row items-center justify-between space-y-0 border-b">
          <DialogTitle className="text-base font-bold mx-auto">Venda Finalizada!</DialogTitle>
        </DialogHeader>

        <div className="px-6 py-6 space-y-5">
          <div className="rounded-lg py-4 px-3" style={{ background: "#EBF9F7" }}>
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Total</p>
            <p className="text-3xl font-bold mt-1" style={{ color: "#006769" }}>{formatBRL(total)}</p>
          </div>

          <p className="text-sm text-muted-foreground">Deseja imprimir o comprovante?</p>

          <div className="flex items-end gap-2">
            <div className="flex-1">
              <Button variant="outline" onClick={onClose} className="w-full">
                Não
              </Button>
              <p className="text-[10px] text-muted-foreground text-center mt-1">ESC</p>
            </div>
            <div className="flex-1 flex flex-col">
              <Button
                variant="outline"
                onClick={onWhatsApp}
                className="w-full gap-1.5"
                style={{ borderColor: "#25D366", color: "#25D366" }}
              >
                <MessageCircle className="w-4 h-4" style={{ color: "#25D366" }} />
                WhatsApp
              </Button>
              <p className="text-[10px] text-transparent text-center mt-1">&nbsp;</p>
            </div>
            <div className="flex-1">
              <Button
                onClick={onPrint}
                className="w-full gap-1.5 text-white border-0"
                style={{ background: "#006769" }}
              >
                <Printer className="w-4 h-4" />
                Imprimir
              </Button>
              <p className="text-[10px] text-muted-foreground text-center mt-1">ENTER</p>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}