import React from "react";
import { useNavigate } from "react-router-dom";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { ClipboardList, X, Package, Boxes } from "lucide-react";

export default function MovimentacoesReportDialog({ open, onClose }) {
  const navigate = useNavigate();

  const items = [
    {
      icon: Package,
      iconBg: "#FFF0E6",
      iconColor: "#E8814A",
      label: "Mov. Produto",
      desc: "Vendas e movimentações de um produto",
      action: () => {
        onClose();
        toast.info("Relatório de movimentação por produto em breve");
      },
    },
    {
      icon: Boxes,
      iconBg: "#E6F0F0",
      iconColor: "#0F7D70",
      label: "Mov. Estoque",
      desc: "Entradas e saídas de estoque",
      action: () => {
        onClose();
        toast.info("Relatório de movimentação de estoque em breve");
      },
    },
  ];

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md p-0 gap-0 overflow-hidden">
        <DialogHeader className="p-4 flex flex-row items-center justify-between space-y-0">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center">
              <ClipboardList className="w-4.5 h-4.5 text-primary" />
            </div>
            <DialogTitle className="text-base font-bold">Relatório de Movimentações</DialogTitle>
          </div>
          <button onClick={onClose} className="p-1 rounded-md hover:bg-muted">
            <X className="w-5 h-5" />
          </button>
        </DialogHeader>

        <div className="px-4 pb-4 space-y-2">
          {items.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.label}
                onClick={item.action}
                className="w-full flex items-center gap-3 p-3 rounded-lg border bg-card hover:border-primary hover:shadow-sm transition-all text-left"
              >
                <div
                  className="w-11 h-11 rounded-lg flex items-center justify-center shrink-0"
                  style={{ background: item.iconBg }}
                >
                  <Icon className="w-5 h-5" style={{ color: item.iconColor }} />
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-semibold">{item.label}</div>
                  <div className="text-xs text-muted-foreground">{item.desc}</div>
                </div>
              </button>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}