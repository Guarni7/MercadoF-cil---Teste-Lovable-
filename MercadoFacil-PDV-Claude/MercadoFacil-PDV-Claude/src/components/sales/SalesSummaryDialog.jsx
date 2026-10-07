import React, { useState, useMemo, useEffect } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BarChart3, Search, Printer } from "lucide-react";
import { api } from "@/api/dataClient";
import { formatBRL } from "@/lib/format";

const methodLabels = {
  dinheiro: "Dinheiro",
  pix: "PIX",
  credito: "Crédito",
  debito: "Débito",
  crediario: "Crediário",
};

export default function SalesSummaryDialog({ open, onClose }) {
  const [startDate, setStartDate] = useState(new Date().toISOString().split("T")[0]);
  const [endDate, setEndDate] = useState(new Date().toISOString().split("T")[0]);
  const [sales, setSales] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  const handleSearch = async () => {
    setLoading(true);
    try {
      const data = await api.entities.Sale.list("-created_date", 500);
      const start = new Date(startDate + "T00:00:00").getTime();
      const end = new Date(endDate + "T23:59:59").getTime();
      const filtered = data.filter((s) => {
        const t = new Date(s.created_date).getTime();
        return t >= start && t <= end && s.status === "concluida";
      });
      setSales(filtered);
      setSearched(true);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const summary = useMemo(() => {
    const byMethod = {};
    sales.forEach((s) => {
      const m = s.payment_method;
      if (!byMethod[m]) byMethod[m] = { method: m, count: 0, total: 0 };
      byMethod[m].count++;
      byMethod[m].total += s.total;
    });
    return {
      byMethod: Object.values(byMethod),
      total: sales.reduce((sum, s) => sum + s.total, 0),
    };
  }, [sales]);

  useEffect(() => {
    if (open) {
      setSearched(false);
      setSales([]);
    }
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl p-8">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2.5 text-lg">
            <BarChart3 className="w-6 h-6 text-primary" /> Resumo de Vendas
            <span className="ml-auto text-xs bg-muted px-2 py-0.5 rounded font-mono">F7</span>
          </DialogTitle>
        </DialogHeader>

        <div className="flex items-end gap-3">
          <div className="flex-1">
            <label className="text-xs text-muted-foreground mb-1.5 block">Data Inicial</label>
            <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="h-10" />
          </div>
          <div className="flex-1">
            <label className="text-xs text-muted-foreground mb-1.5 block">Data Final</label>
            <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="h-10" />
          </div>
          <Button onClick={handleSearch} disabled={loading} className="gap-2 h-10 px-5">
            <Search className="w-4 h-4" /> Buscar
          </Button>
        </div>

        <div className="rounded-lg bg-muted p-5 text-center">
          <div className="text-xs uppercase text-primary font-semibold tracking-wide mb-1">Total Geral</div>
          <div className="text-3xl font-bold text-primary">{formatBRL(summary.total)}</div>
        </div>

        <div className="border rounded-lg overflow-hidden">
          <div className="grid grid-cols-3 gap-2 px-4 py-2 bg-muted text-xs font-semibold uppercase text-muted-foreground">
            <div>Forma de Pagamento</div>
            <div className="text-center">Qtd</div>
            <div className="text-right">Total</div>
          </div>
          {searched && summary.byMethod.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              Nenhuma venda encontrada
            </div>
          ) : (
            <div className="divide-y">
              {summary.byMethod.map((item) => (
                <div key={item.method} className="grid grid-cols-3 gap-2 px-4 py-2.5 text-sm">
                  <div className="font-medium">{methodLabels[item.method] || item.method}</div>
                  <div className="text-center">{item.count}</div>
                  <div className="text-right font-semibold">{formatBRL(item.total)}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Fechar</Button>
          <Button onClick={() => window.print()} disabled={summary.byMethod.length === 0} className="gap-2">
            <Printer className="w-4 h-4" /> Imprimir
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}