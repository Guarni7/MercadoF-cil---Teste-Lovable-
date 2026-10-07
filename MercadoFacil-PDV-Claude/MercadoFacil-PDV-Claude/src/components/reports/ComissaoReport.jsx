import React, { useState, useEffect, useMemo } from "react";
import { api } from "@/api/dataClient";
import { Users, ShoppingCart, Percent } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { formatBRL } from "@/lib/format";
import ReportShell from "./ReportShell";
import KpiCard from "./KpiCard";
import { reportLoadError } from "./reportError";
import { useReportFilters } from "./useReportFilters";

const CHAVE_TAXA = "comissao_percentual";

export default function ComissaoReport({ onBack }) {
  const [sales, setSales] = useState([]);
  const [loading, setLoading] = useState(true);
  // 5% era fixo no código, sem nenhum lugar para configurar: quem paga 2% ou 8%
  // via um valor errado e não tinha como corrigir.
  const [taxa, setTaxa] = useState(() => {
    const salvo = parseFloat(localStorage.getItem(CHAVE_TAXA));
    return Number.isFinite(salvo) ? salvo : 5;
  });
  const filtros = useReportFilters();

  useEffect(() => {
    api.entities.Sale
      .list("-created_date", 500)
      .then(setSales)
      .catch(reportLoadError("as comissões"))
      .finally(() => setLoading(false));
  }, []);

  const mudarTaxa = (valor) => {
    const num = Math.max(0, Math.min(100, parseFloat(valor) || 0));
    setTaxa(num);
    localStorage.setItem(CHAVE_TAXA, String(num));
  };

  const { noPeriodo, combina, status } = filtros;
  const vendas = useMemo(
    () =>
      sales.filter(
        (s) =>
          (status === "todas" || s.status === "concluida") &&
          noPeriodo(s.created_date) &&
          combina(s.created_by_name, s.customer_name, s.number),
      ),
    [sales, status, noPeriodo, combina],
  );

  const fator = taxa / 100;

  const stats = useMemo(() => {
    const vendedores = new Set(
      vendas.map((s) => s.created_by_id || s.created_by_name).filter(Boolean),
    );
    const totalVendas = vendas.reduce((sum, s) => sum + s.total, 0);
    return { pessoas: vendedores.size, totalVendas, comissao: totalVendas * fator };
  }, [vendas, fator]);

  const porVendedor = useMemo(() => {
    const map = {};
    vendas.forEach((s) => {
      const key = s.created_by_id || s.created_by_name || "sem-vendedor";
      if (!map[key]) {
        map[key] = { id: key, name: s.created_by_name || "", total: 0, count: 0 };
      }
      if (!map[key].name && s.created_by_name) map[key].name = s.created_by_name;
      map[key].total += s.total;
      map[key].count++;
    });
    return Object.values(map).sort((a, b) => b.total - a.total);
  }, [vendas]);

  if (loading)
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <div className="w-8 h-8 border-4 border-muted border-t-primary rounded-full animate-spin" />
      </div>
    );

  return (
    <ReportShell
      title="Comissão"
      icon={Percent}
      onBack={onBack}
      filters={filtros}
      searchPlaceholder="Buscar por vendedor ou cliente..."
      statusLabels={{ ativas: "Concluídas", todas: "Todas" }}
      extraFilters={
        <div className="flex items-center gap-2 mb-4">
          <label htmlFor="taxa" className="text-sm text-muted-foreground">
            Percentual de comissão
          </label>
          <Input
            id="taxa"
            type="number"
            min="0"
            max="100"
            step="0.5"
            className="w-24"
            value={taxa}
            onChange={(e) => mudarTaxa(e.target.value)}
          />
          <span className="text-sm text-muted-foreground">%</span>
        </div>
      }
    >
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-6">
        <KpiCard label="Pessoas" value={String(stats.pessoas)} icon={Users} colorClass="text-muted-foreground" />
        <KpiCard label="Vendas (PDV)" value={formatBRL(stats.totalVendas)} subtitle={`${vendas.length} venda(s) no filtro`} icon={ShoppingCart} colorClass="text-blue-600" valueClass="text-blue-600" />
        <KpiCard label="Total Comissão" value={formatBRL(stats.comissao)} subtitle={`${taxa}%`} icon={Percent} colorClass="text-muted-foreground" />
      </div>

      <Card className="p-4">
        <div className="mb-4">
          <h2 className="font-heading font-semibold">Comissão por Vendedor (PDV)</h2>
          <p className="text-xs text-muted-foreground">Vendas do caixa · PDV no período</p>
        </div>
        {porVendedor.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12">
            <Percent className="w-12 h-12 text-muted-foreground/20 mb-2" />
            <p className="text-sm text-muted-foreground">Nenhuma venda no período</p>
          </div>
        ) : (
          <div className="space-y-2">
            {porVendedor.map((v) => (
              <div key={v.id} className="flex items-center justify-between p-3 border rounded-lg">
                <div className="text-sm font-medium">{v.name || "Sem vendedor"}</div>
                <div className="flex items-center gap-4">
                  <span className="text-sm text-muted-foreground">{v.count} vendas</span>
                  <span className="text-sm font-semibold">{formatBRL(v.total)}</span>
                  <span className="text-sm font-semibold text-emerald-600">
                    {formatBRL(v.total * fator)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </ReportShell>
  );
}
