import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Boxes,
  ClipboardList,
  ArrowUpCircle,
  ArrowLeftRight,
  FileText,
  Layers,
  X,
} from "lucide-react";
import StockMovementDialog from "./StockMovementDialog";
import ConvertStockDialog from "./ConvertStockDialog";
import MovimentacoesReportDialog from "./MovimentacoesReportDialog";

export default function StockMenuDialog({ open, onClose, onSaved }) {
  const navigate = useNavigate();
  const [movementOpen, setMovementOpen] = useState(false);
  const [convertOpen, setConvertOpen] = useState(false);
  const [movReportOpen, setMovReportOpen] = useState(false);

  const operations = [
    {
      icon: ClipboardList,
      label: "Inventário",
      desc: "Substituir estoque dos produtos",
      action: () => {
        onClose();
        navigate("/inventario");
      },
    },
    {
      icon: ArrowUpCircle,
      label: "Movimento",
      desc: "Entrada e saída de estoque",
      action: () => setMovementOpen(true),
    },
    {
      icon: ArrowLeftRight,
      label: "Converter",
      desc: "Converter unidade entre produtos",
      action: () => setConvertOpen(true),
    },
  ];

  const reports = [
    {
      icon: Boxes,
      label: "Mov. Estoque",
      desc: "Relatório de movimentações",
      action: () => setMovReportOpen(true),
    },
    {
      icon: FileText,
      label: "Relatório de Produtos",
      desc: "Visualizar e exportar dados",
      action: () => {
        onClose();
        navigate("/relatorio-produtos");
      },
    },
    {
      icon: Layers,
      label: "Relatório de Compostos",
      desc: "Ficha, custo e lucro por produto",
      action: () => {
        onClose();
        navigate("/relatorio-compostos");
      },
    },
  ];

  const ItemCard = ({ item }) => {
    const Icon = item.icon;
    return (
      <button
        onClick={item.action}
        className="w-full flex items-center gap-3 p-3 rounded-lg border bg-card hover:border-primary hover:shadow-sm transition-all text-left"
      >
        <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
          <Icon className="w-5 h-5 text-primary" />
        </div>
        <div className="min-w-0">
          <div className="text-sm font-semibold">{item.label}</div>
          <div className="text-xs text-muted-foreground">{item.desc}</div>
        </div>
      </button>
    );
  };

  return (
    <>
      <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
        <DialogContent className="max-w-md p-0 gap-0 overflow-hidden">
          <DialogHeader className="p-4 flex flex-row items-center justify-between space-y-0">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center">
                <Boxes className="w-4.5 h-4.5 text-primary" />
              </div>
              <DialogTitle className="text-base font-bold">Estoque</DialogTitle>
            </div>
            <button onClick={onClose} className="p-1 rounded-md hover:bg-muted">
              <X className="w-5 h-5" />
            </button>
          </DialogHeader>

          <div className="px-4 pb-4 space-y-4">
            <div>
              <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase mb-2">
                Operações
              </h3>
              <div className="space-y-1.5">
                {operations.map((item) => (
                  <ItemCard key={item.label} item={item} />
                ))}
              </div>
            </div>

            <div>
              <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase mb-2">
                Relatórios
              </h3>
              <div className="space-y-1.5">
                {reports.map((item) => (
                  <ItemCard key={item.label} item={item} />
                ))}
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <StockMovementDialog
        open={movementOpen}
        onClose={() => setMovementOpen(false)}
        onSaved={onSaved}
      />
      <ConvertStockDialog
        open={convertOpen}
        onClose={() => setConvertOpen(false)}
        onSaved={onSaved}
      />
      <MovimentacoesReportDialog
        open={movReportOpen}
        onClose={() => setMovReportOpen(false)}
      />
    </>
  );
}