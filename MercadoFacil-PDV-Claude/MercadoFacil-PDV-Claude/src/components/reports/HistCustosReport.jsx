import React, { useState, useEffect, useMemo } from "react";
import { api } from "@/api/dataClient";
import { ArrowUpDown, DollarSign, TrendingDown, TrendingUp, Search } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatBRL, formatDateTime } from "@/lib/format";
import ReportShell from "./ReportShell";
import KpiCard from "./KpiCard";
import { reportLoadError } from "./reportError";
import { useReportFilters } from "./useReportFilters";

const tipos = {
  compra: "Compra",
  ajuste: "Ajuste de inventário",
  venda: "Venda",
  devolucao: "Devolução",
};

export default function HistCustosReport({ onBack }) {
  const [movimentos, setMovimentos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [tipo, setTipo] = useState("todos");
  const filtros = useReportFilters("todas");

  useEffect(() => {
    // Custo real da entrada, não o custo atual do cadastro: o relatório antigo
    // listava produtos e chamava de "movimentações", sem histórico nenhum.
    api.entities.StockMovement
      .list("-created_date", 500)
      .then(setMovimentos)
      .catch(reportLoadError("o histórico de custos"))
      .finally(() => setLoading(false));
  }, []);

  const { noPeriodo } = filtros;
  const comCusto = useMemo(
    () => movimentos.filter((m) => (m.unit_cost || 0) > 0 && noPeriodo(m.created_date)),
    [movimentos, noPeriodo],
  );

  const filtered = useMemo(() => {
    const termo = search.trim().toLowerCase();
    return comCusto.filter((m) => {
      if (tipo !== "todos" && (m.reason || "") !== tipo) return false;
      return !termo || String(m.product_name || "").toLowerCase().includes(termo);
    });
  }, [comCusto, search, tipo]);

  const stats = useMemo(() => {
    const custos = filtered.map((m) => m.unit_cost || 0);
    const custoMedio = custos.length ? custos.reduce((a, b) => a + b, 0) / custos.length : 0;
    const produtos = new Set(filtered.map((m) => m.product_id)).size;
    return {
      movimentacoes: filtered.length,
      produtos,
      custoMedio,
      menor: custos.length ? Math.min(...custos) : 0,
      maior: custos.length ? Math.max(...custos) : 0,
    };
  }, [filtered]);

  if (loading)
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <div className="w-8 h-8 border-4 border-muted border-t-primary rounded-full animate-spin" />
      </div>
    );

  return (
    <ReportShell
      title="Hist. Custos"
      icon={ArrowUpDown}
      onBack={onBack}
      filters={filtros}
      showSearch={false}
      showStatus={false}
    >
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <KpiCard label="Movimentações" value={String(stats.movimentacoes)} subtitle={`${stats.produtos} produto(s)`} icon={ArrowUpDown} colorClass="text-emerald-600" valueClass="text-emerald-600" />
        <KpiCard label="Custo Médio" value={formatBRL(stats.custoMedio)} icon={DollarSign} colorClass="text-muted-foreground" />
        <KpiCard label="Menor Custo" value={formatBRL(stats.menor)} icon={TrendingDown} colorClass="text-emerald-600" valueClass="text-emerald-600" />
        <KpiCard label="Maior Custo" value={formatBRL(stats.maior)} icon={TrendingUp} colorClass="text-red-600" valueClass="text-red-600" />
      </div>

      <Card className="p-4">
        <div className="flex items-center gap-2 mb-4 flex-wrap">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Buscar produto por nome..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select value={tipo} onValueChange={setTipo}>
            <SelectTrigger className="w-[200px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos os tipos</SelectItem>
              {Object.entries(tipos).map(([v, l]) => (
                <SelectItem key={v} value={v}>{l}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-12">
            Nenhuma movimentação com custo registrado no período. O custo é gravado nas
            entradas por importação de XML.
          </p>
        ) : (
          <div className="space-y-2">
            {filtered.map((m) => (
              <div key={m.id} className="flex items-center justify-between p-3 border rounded-lg">
                <div>
                  <div className="text-sm font-medium">{m.product_name || "—"}</div>
                  <div className="text-xs text-muted-foreground">
                    {formatDateTime(m.created_date)} · {tipos[m.reason] || m.reason || "—"} ·{" "}
                    {m.quantity} un.
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-semibold">{formatBRL(m.unit_cost || 0)}</div>
                  <div className="text-xs text-muted-foreground">
                    total {formatBRL((m.unit_cost || 0) * (m.quantity || 0))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </ReportShell>
  );
}
