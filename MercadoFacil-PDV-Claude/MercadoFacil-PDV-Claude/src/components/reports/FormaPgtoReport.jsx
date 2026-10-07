import React, { useState, useEffect, useMemo } from "react";
import { api } from "@/api/dataClient";
import { CreditCard, DollarSign, BarChart3, TrendingUp, Download } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatBRL } from "@/lib/format";
import ReportShell from "./ReportShell";
import KpiCard from "./KpiCard";
import { reportLoadError } from "./reportError";
import { useReportFilters } from "./useReportFilters";
import { exportarCSV } from "@/lib/exportTable";

const methodLabels = {
  dinheiro: "Dinheiro",
  pix: "PIX",
  credito: "Crédito",
  debito: "Débito",
  crediario: "Crediário",
};

export default function FormaPgtoReport({ onBack }) {
  const [sales, setSales] = useState([]);
  const [loading, setLoading] = useState(true);
  const filtros = useReportFilters();

  useEffect(() => {
    api.entities.Sale
      .list("-created_date", 500)
      .then(setSales)
      .catch(reportLoadError("as formas de pagamento"))
      .finally(() => setLoading(false));
  }, []);

  const { noPeriodo, status } = filtros;
  const stats = useMemo(() => {
    const valid = sales.filter(
      (s) =>
        (status === "todas" || s.status === "concluida") && noPeriodo(s.created_date),
    );
    const map = {};
    valid.forEach((s) => {
      const m = s.payment_method || "outro";
      if (!map[m]) map[m] = { method: m, total: 0, count: 0 };
      map[m].total += s.total;
      map[m].count++;
    });
    const formas = Object.values(map).sort((a, b) => b.total - a.total);
    const totalGeral = valid.reduce((sum, s) => sum + s.total, 0);
    const totalTransacoes = valid.length;
    const maiorPct = formas.length
      ? (formas[0].total / (totalGeral || 1)) * 100
      : 0;
    return { formas, totalGeral, totalTransacoes, maiorPct };
  }, [sales, status, noPeriodo]);

  const exportar = () =>
    exportarCSV({
      nome: "formas_de_pagamento",
      colunas: ["Forma", "Transações", "Total", "% do total"],
      linhas: stats.formas.map((f) => [
        methodLabels[f.method] || f.method,
        f.count,
        formatBRL(f.total),
        `${(stats.totalGeral ? (f.total / stats.totalGeral) * 100 : 0).toFixed(1)}%`,
      ]),
    });

  if (loading)
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <div className="w-8 h-8 border-4 border-muted border-t-primary rounded-full animate-spin" />
      </div>
    );

  return (
    <ReportShell
      title="Forma Pgto"
      icon={CreditCard}
      onBack={onBack}
      filters={filtros}
      showSearch={false}
      statusLabels={{ ativas: "Concluídas", todas: "Todas" }}
    >
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <KpiCard label="Formas de Pgto" value={String(stats.formas.length)} icon={CreditCard} colorClass="text-indigo-600" bgClass="bg-indigo-50" />
        <KpiCard label="Total Geral" value={formatBRL(stats.totalGeral)} icon={DollarSign} colorClass="text-blue-700" bgClass="bg-blue-50" />
        <KpiCard label="Total Transações" value={String(stats.totalTransacoes)} icon={BarChart3} colorClass="text-emerald-700" bgClass="bg-emerald-50" />
        <KpiCard label="Maior %" value={`${stats.maiorPct.toFixed(1)}%`} icon={TrendingUp} colorClass="text-amber-700" valueClass="text-amber-700" bgClass="bg-amber-50" />
      </div>

      <Card className="p-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-heading font-semibold">Por Forma de Pagamento</h2>
          <Button variant="outline" size="sm" className="gap-2" onClick={exportar}>
            <Download className="w-4 h-4" /> Exportar
          </Button>
        </div>
        {stats.formas.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-12">
            Nenhuma venda encontrada no período
          </p>
        ) : (
          <div className="space-y-2">
            {stats.formas.map((f) => {
              const pct = stats.totalGeral ? (f.total / stats.totalGeral) * 100 : 0;
              return (
                <div key={f.method} className="p-3 border rounded-lg">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium">{methodLabels[f.method] || f.method}</span>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-muted-foreground">{f.count} transações</span>
                      <span className="text-sm font-semibold">{formatBRL(f.total)}</span>
                      <span className="text-xs font-medium text-primary">{pct.toFixed(1)}%</span>
                    </div>
                  </div>
                  <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                    <div className="h-full bg-primary rounded-full" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </ReportShell>
  );
}