import React, { useState, useEffect, useMemo } from "react";
import { api } from "@/api/dataClient";
import { Package, DollarSign, TrendingUp, Search, RefreshCw } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatBRL } from "@/lib/format";
import ReportShell from "./ReportShell";
import KpiCard from "./KpiCard";
import { reportLoadError } from "./reportError";
import { useReportFilters } from "./useReportFilters";

export default function MargemEstoqueReport({ onBack }) {
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [group, setGroup] = useState("todos");
  const filtros = useReportFilters();

  useEffect(() => {
    Promise.all([
      api.entities.Product.list("name", 500),
      api.entities.Category.list("name", 100),
    ])
      .then(([p, c]) => {
        setProducts(p);
        setCategories(c);
      })
      .catch(reportLoadError("a margem de estoque"))
      .finally(() => setLoading(false));
  }, []);

  const { status } = filtros;
  const visiveis = useMemo(
    () => products.filter((p) => status === "todas" || p.active !== false),
    [products, status],
  );

  const filtered = useMemo(() => {
    const termo = search.trim().toLowerCase();
    return visiveis.filter(
      (p) =>
        (p.stock || 0) > 0 &&
        (!termo ||
          p.name?.toLowerCase().includes(termo) ||
          p.barcode?.toLowerCase().includes(termo)) &&
        (group === "todos" || p.category === group),
    );
  }, [visiveis, search, group]);

  const stats = useMemo(() => {
    // Os totais seguem o filtro da lista; antes ignoravam grupo e busca, então a
    // tela mostrava o lucro do estoque inteiro embaixo de uma lista de 3 itens.
    const custo = filtered.reduce((s, p) => s + (p.cost || 0) * (p.stock || 0), 0);
    const venda = filtered.reduce((s, p) => s + (p.price || 0) * (p.stock || 0), 0);
    const lucro = venda - custo;
    const margem = venda ? (lucro / venda) * 100 : 0;
    return {
      produtos: visiveis.length,
      comEstoque: filtered.length,
      custo,
      venda,
      lucro,
      margem,
    };
  }, [filtered, visiveis]);

  if (loading)
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <div className="w-8 h-8 border-4 border-muted border-t-primary rounded-full animate-spin" />
      </div>
    );

  return (
    <ReportShell
      title="Margem Estoque"
      icon={Package}
      onBack={onBack}
      filters={filtros}
      showDateRange={false}
      showSearch={false}
      statusLabels={{ ativas: "Ativos", todas: "Todos" }}
    >
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <KpiCard label="Produtos" value={String(stats.produtos)} subtitle={`${stats.comEstoque} no filtro, com estoque`} icon={Package} colorClass="text-muted-foreground" />
        <KpiCard label="Custo do Estoque" value={formatBRL(stats.custo)} icon={DollarSign} colorClass="text-red-600" valueClass="text-red-600" />
        <KpiCard label="Valor de Venda" value={formatBRL(stats.venda)} icon={TrendingUp} colorClass="text-muted-foreground" />
        <KpiCard label="Lucro Potencial" value={formatBRL(stats.lucro)} subtitle={`Margem: ${stats.margem.toFixed(1)}%`} icon={TrendingUp} colorClass="text-emerald-600" valueClass="text-emerald-600" />
      </div>

      <Card className="p-4">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <h2 className="font-heading font-semibold text-sm">Inventário — Custo × Venda × Lucro</h2>
          <Button variant="outline" size="sm" className="gap-2" onClick={() => window.location.reload()}>
            <RefreshCw className="w-3.5 h-3.5" /> Atualizar
          </Button>
        </div>
        <div className="flex items-center gap-2 mb-4 flex-wrap">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input placeholder="Buscar produto..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
          </div>
          <Select value={group} onValueChange={setGroup}>
            <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos os grupos</SelectItem>
              {categories.map((c) => (
                <SelectItem key={c.id} value={c.name}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-12">
            Nenhum produto com estoque positivo encontrado
          </p>
        ) : (
          <div className="space-y-2">
            {filtered.map((p) => {
              const lucro = ((p.price || 0) - (p.cost || 0)) * (p.stock || 0);
              return (
                <div key={p.id} className="flex items-center justify-between p-3 border rounded-lg">
                  <div className="text-sm font-medium">{p.name}</div>
                  <div className="flex items-center gap-4 text-sm">
                    <span className="text-red-600">{formatBRL((p.cost || 0) * (p.stock || 0))}</span>
                    <span>{formatBRL((p.price || 0) * (p.stock || 0))}</span>
                    <span className="font-semibold text-emerald-600">{formatBRL(lucro)}</span>
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