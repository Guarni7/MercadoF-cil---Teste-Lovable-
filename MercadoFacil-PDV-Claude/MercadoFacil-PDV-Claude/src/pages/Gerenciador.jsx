import React, { useState, useEffect } from "react";
import {
  Search,
  Calendar,
  Filter,
  BarChart3,
  Undo2,
  RefreshCw,
  Receipt,
  Database,
  Package,
  ChevronDown,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatBRL, formatDateTime } from "@/lib/format";
import { saleNumberLabel } from "@/lib/saleNumber";
import { loadSales, loadCustomers } from "@/lib/dataLayer";
import SalesSummaryDialog from "@/components/sales/SalesSummaryDialog";
import ReturnExchangeDialog from "@/components/sales/ReturnExchangeDialog";
import SaleDetailDialog from "@/components/sales/SaleDetailDialog";
import { ChevronRight } from "lucide-react";

const methodLabels = {
  dinheiro: "Dinheiro",
  pix: "PIX",
  credito: "Crédito",
  debito: "Débito",
  crediario: "Crediário",
};

export default function Gerenciador() {
  const [sales, setSales] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [returnOpen, setReturnOpen] = useState(false);
  const [selectedSale, setSelectedSale] = useState(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      // Offline-first: a consulta de vendas continua servindo durante a queda,
      // com o que já foi visto online mais o que ainda não sincronizou.
      const [data, custs] = await Promise.all([loadSales(200), loadCustomers()]);
      setSales(data);
      setCustomers(custs);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadData();
  };

  const filtered = sales.filter(
    (s) =>
      !search ||
      (s.customer_name && s.customer_name.toLowerCase().includes(search.toLowerCase())) ||
      (s.number && s.number.toString().includes(search))
  );

  const totalGeral = sales
    .filter((s) => s.status === "concluida")
    .reduce((sum, s) => sum + s.total, 0);

  const todayLabel = new Date().toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="w-8 h-8 border-4 border-muted border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-4 lg:p-6">
      {/* Header */}
      <div className="mb-5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-heading font-bold text-foreground">Gerenciador</h1>
          <Badge variant="secondary" className="text-sm font-medium px-3 py-1">
            {formatBRL(totalGeral)}
          </Badge>
        </div>
        <Button variant="ghost" size="icon" onClick={handleRefresh} disabled={refreshing}>
          <RefreshCw className={`w-5 h-5 text-muted-foreground ${refreshing ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {/* Search */}
      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder="Cliente, produto, chave, CPF/CNPJ..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-10 bg-muted/50 border-none"
        />
      </div>

      {/* Control bar */}
      <div className="flex items-center gap-2 mb-5 flex-wrap">
        <Button variant="outline" size="sm" className="gap-2 rounded-lg bg-muted/50 border-none">
          <Database className="w-4 h-4" /> Todos
          <ChevronDown className="w-3 h-3" />
        </Button>
        <Button variant="outline" size="sm" className="gap-2 rounded-lg bg-muted/50 border-none">
          <Filter className="w-4 h-4" /> Ativos
          <ChevronDown className="w-3 h-3" />
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="gap-2 rounded-lg border-orange-500 text-orange-600 hover:bg-orange-50 hover:text-orange-600"
        >
          <Receipt className="w-4 h-4" /> Recebimentos Fiscais
        </Button>
        <div className="flex items-center gap-2 ml-auto">
          <Button variant="outline" size="sm" className="gap-2 rounded-lg bg-muted/50 border-none">
            <Calendar className="w-4 h-4" /> {todayLabel}
          </Button>
          <span className="text-sm text-muted-foreground">a</span>
          <Button variant="outline" size="sm" className="gap-2 rounded-lg bg-muted/50 border-none">
            <Calendar className="w-4 h-4" /> {todayLabel}
          </Button>
        </div>
      </div>

      {/* Secondary actions */}
      <div className="flex items-center gap-2 mb-4">
        <Button variant="outline" size="sm" className="gap-2" onClick={() => setSummaryOpen(true)}>
          <BarChart3 className="w-4 h-4" /> Resumo de Vendas
        </Button>
        <Button variant="outline" size="sm" className="gap-2" onClick={() => setReturnOpen(true)}>
          <Undo2 className="w-4 h-4" /> Devolução / Troca
        </Button>
      </div>

      {/* Content */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <Package className="w-14 h-14 text-muted-foreground/30 mb-3" />
          <p className="text-muted-foreground/60 text-sm">Nenhuma venda encontrada</p>
        </div>
      ) : (
        <div className="rounded-lg border bg-card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2.5 text-left font-medium">N°</th>
                <th className="px-3 py-2.5 text-left font-medium">DATA</th>
                <th className="px-3 py-2.5 text-left font-medium">CLIENTE</th>
                <th className="px-3 py-2.5 text-left font-medium">VENDEDOR</th>
                <th className="px-3 py-2.5 text-left font-medium">PAGAMENTO</th>
                <th className="px-3 py-2.5 text-center font-medium">ITENS</th>
                <th className="px-3 py-2.5 text-center font-medium">FISCAL</th>
                <th className="px-3 py-2.5 text-left font-medium">CAIXA</th>
                <th className="px-3 py-2.5 text-right font-medium">VALOR</th>
                <th className="px-2 py-2.5 w-8"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((sale) => (
                <tr
                  key={sale.id}
                  onClick={() => setSelectedSale(sale)}
                  className="border-t hover:bg-muted/30 cursor-pointer transition-colors"
                >
                  <td className="px-3 py-3 font-semibold">{saleNumberLabel(sale)}</td>
                  <td className="px-3 py-3 text-muted-foreground">{formatDateTime(sale.created_date)}</td>
                  <td className="px-3 py-3">{sale.customer_name || "—"}</td>
                  <td className="px-3 py-3 text-muted-foreground">{sale.created_by_name || "—"}</td>
                  <td className="px-3 py-3">{methodLabels[sale.payment_method] || sale.payment_method}</td>
                  <td className="px-3 py-3 text-center">{(sale.items || []).length}</td>
                  <td className="px-3 py-3 text-center text-muted-foreground">—</td>
                  <td className="px-3 py-3 text-muted-foreground">{sale.terminal_name || "—"}</td>
                  <td className={`px-3 py-3 text-right font-bold ${sale.status === "cancelada" ? "line-through text-muted-foreground" : ""}`}>
                    {formatBRL(sale.total)}
                  </td>
                  <td className="px-2 py-3 text-muted-foreground">
                    <ChevronRight className="w-4 h-4" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <SalesSummaryDialog open={summaryOpen} onClose={() => setSummaryOpen(false)} />
      <ReturnExchangeDialog open={returnOpen} onClose={() => setReturnOpen(false)} />
      <SaleDetailDialog
        open={!!selectedSale}
        onClose={() => setSelectedSale(null)}
        sale={selectedSale}
        customers={customers}
        onCancelled={() => {
          setSelectedSale(null);
          loadData();
        }}
      />
    </div>
  );
}