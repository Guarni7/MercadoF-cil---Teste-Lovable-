import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/api/dataClient";
import { toast } from "sonner";
import {
  ArrowLeft,
  Search,
  Download,
  Settings,
  Eye,
  ChevronDown,
  Package,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatBRL } from "@/lib/format";

export default function RelatorioProdutos() {
  const navigate = useNavigate();
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [search, setSearch] = useState("");
  const [groupFilter, setGroupFilter] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [prods, cats] = await Promise.all([
        api.entities.Product.list("name", 500),
        api.entities.Category.list("name", 200),
      ]);
      setProducts(prods);
      setCategories(cats);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const filtered = products.filter((p) => {
    const matchSearch =
      !search || p.name?.toLowerCase().includes(search.toLowerCase());
    const matchGroup = !groupFilter || p.category === groupFilter;
    return matchSearch && matchGroup;
  });

  return (
    <div className="min-h-screen bg-[#f8f9fa]">
      {/* Teal header */}
      <div className="bg-[#0F7D70] text-white px-4 py-3 flex items-center gap-3">
        <button
          onClick={() => navigate(-1)}
          className="p-2 rounded-lg hover:bg-white/10 transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div>
          <h1 className="text-lg font-heading font-bold">Relatório de Produtos</h1>
          <p className="text-xs text-white/70">{filtered.length} produtos</p>
        </div>
      </div>

      {/* Toolbar */}
      <div className="bg-white border-b px-4 py-3 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
          <Input
            placeholder="Buscar por nome..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10"
          />
        </div>
        <select
          value={groupFilter}
          onChange={(e) => setGroupFilter(e.target.value)}
          className="h-9 px-3 rounded-md border border-stone-300 bg-white text-sm text-stone-700"
        >
          <option value="">Todos os grupos</option>
          {categories.map((c) => (
            <option key={c.id} value={c.name}>{c.name}</option>
          ))}
        </select>
        <Button variant="outline" size="sm" className="gap-1.5" onClick={() => toast.info("Filtro PIS/COFINS em breve")}>
          Todos PIS/COFINS <ChevronDown className="w-3 h-3" />
        </Button>
        <Button variant="outline" size="sm" className="gap-1.5" onClick={() => toast.info("Colunas em breve")}>
          <Eye className="w-4 h-4" /> Colunas
        </Button>
        <Button variant="outline" size="sm" className="gap-1.5" onClick={() => toast.info("Exportação em breve")}>
          <Download className="w-4 h-4" /> Exportar
        </Button>
        <Button variant="ghost" size="icon" onClick={() => toast.info("Configurações em breve")}>
          <Settings className="w-4 h-4" />
        </Button>
        <span className="text-sm text-stone-500 ml-auto">{filtered.length} produtos</span>
      </div>

      {/* Table */}
      <div className="bg-white mx-4 mt-4 rounded-lg border overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-6 h-6 border-2 border-stone-300 border-t-[#0F7D70] rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <Package className="w-12 h-12 text-stone-300" strokeWidth={1} />
            <p className="mt-3 text-sm text-stone-500">Nenhum produto encontrado</p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-stone-50 hover:bg-stone-50">
                <TableHead className="text-xs font-semibold text-stone-500">Código</TableHead>
                <TableHead className="text-xs font-semibold text-stone-500">Nome</TableHead>
                <TableHead className="text-xs font-semibold text-stone-500">Grupo</TableHead>
                <TableHead className="text-xs font-semibold text-stone-500">UN</TableHead>
                <TableHead className="text-xs font-semibold text-stone-500 text-right">Preço</TableHead>
                <TableHead className="text-xs font-semibold text-stone-500 text-right">Estoque</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((p) => (
                <TableRow key={p.id} className="hover:bg-stone-50">
                  <TableCell className="text-sm text-stone-600">{p.code || "—"}</TableCell>
                  <TableCell className="text-sm font-medium text-stone-900">{p.name}</TableCell>
                  <TableCell className="text-sm text-stone-600">{p.category || "—"}</TableCell>
                  <TableCell className="text-sm text-stone-600">{p.unit || "UN"}</TableCell>
                  <TableCell className="text-sm text-stone-900 text-right">{formatBRL(p.price || 0)}</TableCell>
                  <TableCell className="text-sm text-stone-600 text-right">{p.stock || 0}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}