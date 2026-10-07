import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/api/dataClient";
import { toast } from "sonner";
import {
  ArrowLeft,
  Search,
  Boxes,
  DollarSign,
  Tag,
  Warehouse,
  Package,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { formatBRL } from "@/lib/format";

export default function RelatorioCompostos() {
  const navigate = useNavigate();
  const [products, setProducts] = useState([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const list = await api.entities.Product.list("name", 500);
      setProducts(list);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  // Composite products: for now, all products are potential composites
  const composites = products.filter(
    (p) =>
      !search ||
      p.name?.toLowerCase().includes(search.toLowerCase()) ||
      p.code?.includes(search) ||
      p.category?.toLowerCase().includes(search.toLowerCase())
  );

  const avgCost =
    composites.length > 0
      ? composites.reduce((sum, p) => sum + (p.average_cost || p.cost || 0), 0) / composites.length
      : 0;
  const avgPrice =
    composites.length > 0
      ? composites.reduce((sum, p) => sum + (p.price || 0), 0) / composites.length
      : 0;
  const totalStockCost = composites.reduce(
    (sum, p) => sum + (p.average_cost || p.cost || 0) * (p.stock || 0),
    0
  );

  const cards = [
    {
      icon: Boxes,
      title: "COMPOSTOS",
      value: `${composites.length} produtos na lista`,
      label: "",
      color: "#1DE9B6",
    },
    {
      icon: DollarSign,
      title: "CUSTO MÉDIO - 1 UN.",
      value: formatBRL(avgCost),
      label: "média das fichas",
      color: "#F5A623",
    },
    {
      icon: Tag,
      title: "PREÇO MÉDIO - 1 UN.",
      value: formatBRL(avgPrice),
      label: "média de venda",
      color: "#F5A623",
    },
    {
      icon: Warehouse,
      title: "CUSTO - TODO ESTOQUE",
      value: formatBRL(totalStockCost),
      label: "soma ficha x estoque",
      color: "#1DE9B6",
    },
  ];

  return (
    <div className="min-h-screen bg-[#f4f6f8]">
      {/* Header */}
      <div className="bg-white border-b px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate(-1)}
            className="p-2 rounded-lg hover:bg-muted transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="text-lg font-heading font-bold text-stone-900">Relatório de Compostos</h1>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => toast.info("Guia em breve")}
          >
            Guia
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => toast.info("Exportação CSV em breve")}
          >
            CSV
          </Button>
        </div>
      </div>

      <div className="max-w-5xl mx-auto p-4 space-y-4">
        {/* Description */}
        <p className="text-sm text-stone-600 leading-relaxed">
          A ficha é a receita de 1 unidade. As colunas de estoque multiplicam essa receita
          pelas unidades prontas no estoque.
        </p>

        {/* Summary cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {cards.map((card) => {
            const Icon = card.icon;
            return (
              <div key={card.title} className="bg-white rounded-xl border p-4 space-y-2">
                <div className="flex items-center gap-2">
                  <div
                    className="w-8 h-8 rounded-lg flex items-center justify-center"
                    style={{ background: `${card.color}20` }}
                  >
                    <Icon className="w-4 h-4" style={{ color: card.color }} />
                  </div>
                  <span className="text-xs font-semibold text-stone-500 uppercase">
                    {card.title}
                  </span>
                </div>
                <div className="text-lg font-bold text-stone-900">{card.value}</div>
                {card.label && <div className="text-xs text-stone-400">{card.label}</div>}
              </div>
            );
          })}
        </div>

        {/* Search + filters */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
            <Input
              placeholder="Buscar por nome, código ou grupo..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10"
            />
          </div>
          <Button variant="outline" size="sm">Todos</Button>
          <Button variant="outline" size="sm">Na venda</Button>
        </div>

        {/* Content */}
        <div className="bg-white rounded-xl border min-h-[300px] flex items-center justify-center">
          {loading ? (
            <div className="w-6 h-6 border-2 border-stone-300 border-t-[#0F7D70] rounded-full animate-spin" />
          ) : composites.length === 0 ? (
            <div className="flex flex-col items-center text-center py-12">
              <div className="w-16 h-16 rounded-full bg-stone-100 flex items-center justify-center">
                <Package className="w-8 h-8 text-stone-400" strokeWidth={1} />
              </div>
              <p className="mt-4 text-sm font-semibold text-stone-700">
                Nenhum produto composto encontrado
              </p>
              <p className="text-xs text-stone-400 mt-1">
                Cadastre um produto com tipo Compósito e monte a ficha.
              </p>
            </div>
          ) : (
            <div className="w-full p-4 space-y-2">
              {composites.map((p) => (
                <div
                  key={p.id}
                  className="flex items-center justify-between p-3 rounded-lg border hover:bg-stone-50"
                >
                  <div>
                    <div className="text-sm font-medium">{p.name}</div>
                    <div className="text-xs text-stone-500">
                      {p.category || "Sem grupo"} · Est: {p.stock || 0} {p.unit || "UN"}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-semibold">{formatBRL(p.price || 0)}</div>
                    <div className="text-xs text-stone-500">Custo: {formatBRL(p.average_cost || p.cost || 0)}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}