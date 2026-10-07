import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/api/dataClient";
import { toast } from "sonner";
import {
  ArrowLeft,
  Search,
  Printer,
  Download,
  RefreshCw,
  ChevronDown,
  Package,
  Save,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { mensagemDeErro } from "@/lib/mensagemErro";

export default function Inventario() {
  const navigate = useNavigate();
  const [products, setProducts] = useState([]);
  const [search, setSearch] = useState("");
  const [changes, setChanges] = useState(/** @type {Record<string, any>} */ ({}));
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadProducts();
  }, []);

  const loadProducts = async () => {
    setLoading(true);
    try {
      const list = await api.entities.Product.list("name", 500);
      setProducts(list);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const filtered = products.filter(
    (p) =>
      !search ||
      p.name?.toLowerCase().includes(search.toLowerCase()) ||
      p.code?.includes(search) ||
      p.barcode?.includes(search)
  );

  const handleStockChange = (productId, value) => {
    setChanges((prev) => ({ ...prev, [productId]: value }));
  };

  const handleSave = async () => {
    // A contagem é absoluta; o histórico precisa da diferença para ficar
    // auditável (antes o inventário trocava o estoque sem deixar rastro).
    const ajustes = Object.entries(changes)
      .filter(([, val]) => val !== "" && val !== undefined)
      .map(([id, val]) => {
        const produto = products.find((p) => p.id === id);
        const contado = parseFloat(val) || 0;
        const atual = produto?.stock || 0;
        return { produto, contado, delta: contado - atual };
      })
      .filter((a) => a.produto && a.delta !== 0);

    if (ajustes.length === 0) {
      toast.info("Nenhum estoque alterado.");
      return;
    }
    setSaving(true);
    const falhas = [];
    try {
      for (const { produto, contado, delta } of ajustes) {
        try {
          await api.stock.applyMovement({
            clientId: `inv_${produto.id}_${Date.now()}`,
            productId: produto.id,
            productName: produto.name,
            quantity: Math.abs(delta),
            type: delta > 0 ? "entrada" : "saida",
            reason: "ajuste",
            notes: `Inventário: contado ${contado} (anterior ${produto.stock || 0})`,
          });
        } catch (err) {
          console.error(`Erro ao ajustar ${produto.name}:`, err);
          falhas.push(`${produto.name}: ${err?.message || "falha"}`);
        }
      }

      const ok = ajustes.length - falhas.length;
      if (falhas.length) {
        toast.error(`${ok} ajustado(s), ${falhas.length} com erro — ${falhas.join(" | ")}`, {
          duration: 12000,
        });
      } else {
        toast.success(`${ok} produto(s) atualizado(s)!`);
      }
      setChanges({});
      loadProducts();
    } catch (e) {
      console.error("Erro ao salvar inventário:", e);
      toast.error(mensagemDeErro(e, "salvar o inventário"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#f8f9fa]">
      {/* Top teal bar */}
      <div className="h-2 bg-[#0F7D70]" />

      {/* Header */}
      <div className="bg-white border-b px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate(-1)}
            className="p-2 rounded-lg hover:bg-muted transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-lg font-heading font-bold text-stone-900">
              Inventário / Estoque
            </h1>
            <p className="text-xs text-stone-500">{filtered.length} na lista</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => toast.info("Impressão em breve")}>
            <Printer className="w-4 h-4" /> Imprimir
          </Button>
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => toast.info("Exportação em breve")}>
            <Download className="w-4 h-4" /> Exportar <ChevronDown className="w-3 h-3" />
          </Button>
          <Button variant="ghost" size="icon" onClick={loadProducts} title="Atualizar">
            <RefreshCw className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Search + Filter */}
      <div className="bg-white border-b px-4 py-3 flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
          <Input
            placeholder="Buscar código ou nome..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10 bg-[#f9fafa] border-[#1A635B]/30"
          />
        </div>
        <Button variant="outline" size="sm" className="gap-1.5">
          <ChevronDown className="w-4 h-4" /> Todos
        </Button>
      </div>

      {/* Content */}
      <div className="max-w-4xl mx-auto p-4">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <RefreshCw className="w-6 h-6 text-stone-400 animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <Package className="w-16 h-16 text-stone-300" strokeWidth={1} />
            <p className="mt-4 text-base font-semibold text-stone-700">Nenhum produto</p>
            <p className="text-sm text-stone-400">Ajuste os filtros ou a busca.</p>
          </div>
        ) : (
          <div className="space-y-1.5">
            {filtered.map((p) => (
              <div
                key={p.id}
                className="flex items-center gap-3 p-3 rounded-lg bg-white border border-stone-200"
              >
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-stone-900 truncate">{p.name}</div>
                  <div className="text-xs text-stone-500">
                    Código: {p.code || "—"} · Atual: {p.stock || 0} {p.unit || "UN"}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-stone-400">Novo:</span>
                  <Input
                    type="number"
                    step="0.01"
                    value={changes[p.id] ?? ""}
                    onChange={(e) => handleStockChange(p.id, e.target.value)}
                    placeholder={String(p.stock || 0)}
                    className="w-24 h-8 text-sm text-center"
                  />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Save button */}
        {filtered.length > 0 && (
          <div className="flex justify-center mt-6">
            <Button
              onClick={handleSave}
              disabled={saving}
              className="gap-2 px-12 h-11 bg-[#74a0a2] hover:bg-[#74a0a2]/90"
            >
              <Save className="w-4 h-4" />
              {saving ? "Salvando..." : "Salvar"}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}