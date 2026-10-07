import React, { useState, useEffect, useMemo } from "react";
import { api } from "@/api/dataClient";
import { Layers, DollarSign, Tag, Search, Info, Download } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatBRL } from "@/lib/format";
import { toast } from "sonner";
import ReportShell from "./ReportShell";
import KpiCard from "./KpiCard";
import { reportLoadError } from "./reportError";

export default function CompostosReport({ onBack }) {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState("todos");

  useEffect(() => {
    api.entities.Product
      .list("name", 500)
      .then(setProducts)
      .catch(reportLoadError("os produtos compostos"))
      .finally(() => setLoading(false));
  }, []);

  const compostos = useMemo(() => {
    return products.filter(
      (p) => p.category?.toLowerCase().includes("composto") || p.subcategory?.toLowerCase().includes("composto")
    );
  }, [products]);

  const filtered = useMemo(() => {
    return compostos.filter(
      (p) =>
        (!search || p.name?.toLowerCase().includes(search.toLowerCase())) &&
        (tab === "todos" ||
          (tab === "fabricacao" && (p.stock || 0) > 0) ||
          (tab === "venda" && p.active !== false))
    );
  }, [compostos, search, tab]);

  const stats = useMemo(() => {
    const custoMedio = compostos.length
      ? compostos.reduce((s, p) => s + (p.cost || 0), 0) / compostos.length
      : 0;
    const precoMedio = compostos.length
      ? compostos.reduce((s, p) => s + (p.price || 0), 0) / compostos.length
      : 0;
    const custoEstoque = compostos.reduce(
      (s, p) => s + (p.cost || 0) * (p.stock || 0),
      0
    );
    return { count: compostos.length, custoMedio, precoMedio, custoEstoque };
  }, [compostos]);

  if (loading)
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <div className="w-8 h-8 border-4 border-muted border-t-primary rounded-full animate-spin" />
      </div>
    );

  return (
    <ReportShell
      title="Relatório de Compostos"
      icon={Layers}
      onBack={onBack}
      showDateRange={false}
      showSearch={false}
      showStatus={false}
      rightActions={
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="gap-2" onClick={() => toast.info("Guia em breve")}>
            <Info className="w-4 h-4" /> Guia
          </Button>
          <Button variant="outline" size="sm" className="gap-2" onClick={() => toast.info("CSV em breve")}>
            <Download className="w-4 h-4" /> CSV
          </Button>
        </div>
      }
    >
      <p className="text-sm text-muted-foreground mb-4">
        A ficha é a receita de 1 unidade. As colunas de estoque multiplicam essa receita pelas unidades prontas no estoque.
      </p>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <KpiCard label="Compostos" value={String(stats.count)} subtitle="produtos na lista" icon={Layers} colorClass="text-muted-foreground" />
        <KpiCard label="Custo Médio · 1 Un." value={formatBRL(stats.custoMedio)} subtitle="média das fichas" icon={DollarSign} colorClass="text-muted-foreground" />
        <KpiCard label="Preço Médio · 1 Un." value={formatBRL(stats.precoMedio)} subtitle="média de venda" icon={Tag} colorClass="text-muted-foreground" />
        <KpiCard label="Custo · Todo Estoque" value={formatBRL(stats.custoEstoque)} subtitle="soma ficha x estoque" icon={DollarSign} colorClass="text-muted-foreground" />
      </div>

      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Buscar por nome, código ou grupo..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
        <div className="flex gap-1">
          {[
            { v: "todos", l: "Todos" },
            { v: "fabricacao", l: "Na fabricação" },
            { v: "venda", l: "Na venda" },
          ].map((t) => (
            <button
              key={t.v}
              onClick={() => setTab(t.v)}
              className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
                tab === t.v
                  ? "bg-primary text-primary-foreground"
                  : "border text-primary hover:bg-primary/10"
              }`}
            >
              {t.l}
            </button>
          ))}
        </div>
      </div>

      <Card className="p-6">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 border-2 border-dashed rounded-lg">
            <Layers className="w-12 h-12 text-muted-foreground/30 mb-3" />
            <p className="text-sm text-muted-foreground font-medium">Nenhum produto composto encontrado</p>
            <p className="text-xs text-muted-foreground/70 mt-1">Cadastre um produto com tipo Composto e monte a ficha.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map((p) => (
              <div key={p.id} className="flex items-center justify-between p-3 border rounded-lg">
                <div>
                  <div className="text-sm font-medium">{p.name}</div>
                  <div className="text-xs text-muted-foreground">{p.category || "—"}</div>
                </div>
                <div className="flex items-center gap-4 text-sm">
                  <span className="text-muted-foreground">Custo: {formatBRL(p.cost || 0)}</span>
                  <span className="text-muted-foreground">Preço: {formatBRL(p.price || 0)}</span>
                  <span className="font-semibold">Estoque: {p.stock || 0}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </ReportShell>
  );
}