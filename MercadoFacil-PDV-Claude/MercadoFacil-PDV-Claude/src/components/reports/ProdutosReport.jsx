import React, { useState, useEffect, useMemo } from "react";
import { api } from "@/api/dataClient";
import { Package, DollarSign, TrendingUp, Search } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { formatBRL } from "@/lib/format";
import ReportShell from "./ReportShell";
import KpiCard from "./KpiCard";
import { reportLoadError } from "./reportError";
import { useReportFilters } from "./useReportFilters";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export default function ProdutosReport({ onBack }) {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const filtros = useReportFilters();

  useEffect(() => {
    api.entities.Product
      .list("name", 500)
      .then(setProducts)
      .catch(reportLoadError("o relatório de produtos"))
      .finally(() => setLoading(false));
  }, []);

  const { status } = filtros;
  const noStatus = useMemo(
    () => products.filter((p) => status === "todas" || p.active !== false),
    [products, status],
  );

  const filtered = useMemo(() => {
    const termo = search.trim().toLowerCase();
    return noStatus.filter(
      (p) =>
        !termo ||
        p.name?.toLowerCase().includes(termo) ||
        p.barcode?.toLowerCase().includes(termo),
    );
  }, [noStatus, search]);

  const stats = useMemo(() => {
    const custoTotal = noStatus.reduce((sum, p) => sum + (p.cost || 0) * (p.stock || 0), 0);
    const lucroTotal = noStatus.reduce(
      (sum, p) => sum + ((p.price || 0) - (p.cost || 0)) * (p.stock || 0),
      0
    );
    return { count: noStatus.length, custoTotal, lucroTotal };
  }, [noStatus]);

  if (loading)
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <div className="w-8 h-8 border-4 border-muted border-t-primary rounded-full animate-spin" />
      </div>
    );

  return (
    <ReportShell
      title="Produtos"
      icon={Package}
      onBack={onBack}
      filters={filtros}
      showDateRange={false}
      showSearch={false}
      statusLabels={{ ativas: "Ativos", todas: "Todos" }}
    >
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-6">
        <KpiCard label="Produtos" value={String(stats.count)} icon={Package} colorClass="text-muted-foreground" />
        <KpiCard label="Custo Total" value={formatBRL(stats.custoTotal)} icon={DollarSign} colorClass="text-red-600" valueClass="text-red-600" />
        <KpiCard label="Lucro Total" value={formatBRL(stats.lucroTotal)} icon={TrendingUp} colorClass="text-emerald-600" valueClass="text-emerald-600" />
      </div>

      <Card className="overflow-hidden">
        <div className="p-4 border-b">
          <h2 className="font-heading font-semibold mb-3">Lucratividade por Produto</h2>
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input placeholder="Buscar produto..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
          </div>
        </div>
        {filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-12">
            Nenhum produto encontrado
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead className="text-xs uppercase">Produto</TableHead>
                <TableHead className="text-xs uppercase text-right">Custo</TableHead>
                <TableHead className="text-xs uppercase text-right">Preço</TableHead>
                <TableHead className="text-xs uppercase text-right">Lucro/Un</TableHead>
                <TableHead className="text-xs uppercase text-right">Estoque</TableHead>
                <TableHead className="text-xs uppercase text-right">Lucro Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((p) => {
                const lucroUn = (p.price || 0) - (p.cost || 0);
                return (
                  <TableRow key={p.id}>
                    <TableCell className="font-medium text-sm">{p.name}</TableCell>
                    <TableCell className="text-sm text-right text-red-600">{formatBRL(p.cost || 0)}</TableCell>
                    <TableCell className="text-sm text-right">{formatBRL(p.price || 0)}</TableCell>
                    <TableCell className="text-sm text-right text-emerald-600">{formatBRL(lucroUn)}</TableCell>
                    <TableCell className="text-sm text-right">{p.stock || 0}</TableCell>
                    <TableCell className="text-sm font-semibold text-right text-emerald-600">{formatBRL(lucroUn * (p.stock || 0))}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Card>
    </ReportShell>
  );
}