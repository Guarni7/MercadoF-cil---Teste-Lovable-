import React, { useState, useEffect } from "react";
import { Search, Plus, Pencil, Trash2, Package, Settings, Tag, Boxes, FileUp } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatBRL } from "@/lib/format";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import ProductDialog from "@/components/products/ProductDialog";
import GroupsDialog from "@/components/products/GroupsDialog";
import BrandsDialog from "@/components/products/BrandsDialog";
import StockMenuDialog from "@/components/products/StockMenuDialog";
import ProductSettingsDialog from "@/components/products/ProductSettingsDialog";
import { useNavigate } from "react-router-dom";

export default function Products() {
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState(null);
  const [statusFilter, setStatusFilter] = useState("ativos");
  const [groupsOpen, setGroupsOpen] = useState(false);
  const [brandsOpen, setBrandsOpen] = useState(false);
  const [stockOpen, setStockOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const { listProducts, listCategories } = await import("@/lib/productStore");
      const [prods, cats] = await Promise.all([listProducts(), listCategories()]);
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
      !search ||
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      (p.barcode && p.barcode.includes(search));
    const matchStatus =
      statusFilter === "ativos" ? p.active !== false : p.active === false;
    return matchSearch && matchStatus;
  });

  const handleDelete = async (product) => {
    if (!confirm(`Excluir "${product.name}"?`)) return;
    try {
      const { deleteProduct } = await import("@/lib/productStore");
      await deleteProduct(product.id);
      toast.success("Produto excluído.");
      loadData();
    } catch {
      toast.error("Erro ao excluir.");
    }
  };

  const openNew = () => {
    setEditingProduct(null);
    setDialogOpen(true);
  };

  const openEdit = (product) => {
    setEditingProduct(product);
    setDialogOpen(true);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="w-8 h-8 border-4 border-muted border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-4 lg:p-6">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-4">
        <h1 className="text-2xl font-heading font-bold">Produtos</h1>
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant="ghost"
            size="icon"
            title="Configurações"
            onClick={() => setSettingsOpen(true)}
          >
            <Settings className="w-4 h-4" />
          </Button>
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setGroupsOpen(true)}>
            <Tag className="w-4 h-4" /> Grupos
          </Button>
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setBrandsOpen(true)}>
            <Tag className="w-4 h-4" /> Marcas
          </Button>
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setStockOpen(true)}>
            <Boxes className="w-4 h-4" /> Estoque
          </Button>
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => navigate("/importar-xml")}>
            <FileUp className="w-4 h-4" /> Imp. XML
          </Button>
          <Button onClick={openNew} className="gap-2">
            <Plus className="w-4 h-4" /> Novo Produto
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ativos">Ativos</SelectItem>
            <SelectItem value="inativos">Inativos</SelectItem>
          </SelectContent>
        </Select>
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por nome ou código..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10"
          />
        </div>
      </div>

      <Card className="overflow-hidden">
        {filtered.length === 0 ? (
          <div className="p-12 text-center text-muted-foreground">
            <Package className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p>Nenhum produto encontrado.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead className="w-32">CÓDIGO</TableHead>
                  <TableHead>PRODUTO</TableHead>
                  <TableHead className="w-32">GRUPO</TableHead>
                  <TableHead className="w-32">PREÇO</TableHead>
                  <TableHead className="w-28">ESTOQUE</TableHead>
                  <TableHead className="w-20 text-right">AÇÕES</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((product) => (
                  <TableRow key={product.id} className="hover:bg-muted/30">
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {product.barcode || "—"}
                    </TableCell>
                    <TableCell className="font-medium">{product.name}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {product.category || "—"}
                    </TableCell>
                    <TableCell className="font-semibold text-primary">
                      {formatBRL(product.price)}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          (product.stock || 0) <= (product.min_stock || 5)
                            ? "destructive"
                            : "secondary"
                        }
                        className="text-xs"
                      >
                        {product.stock || 0} {product.unit || "UN"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1 justify-end">
                        <button
                          onClick={() => openEdit(product)}
                          className="p-1.5 rounded-md hover:bg-muted"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDelete(product)}
                          className="p-1.5 rounded-md hover:bg-destructive/10 hover:text-destructive"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>

      <ProductDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        product={editingProduct}
        categories={categories}
        onSaved={loadData}
      />

      <GroupsDialog
        open={groupsOpen}
        onClose={() => setGroupsOpen(false)}
        onSaved={loadData}
      />

      <BrandsDialog
        open={brandsOpen}
        onClose={() => setBrandsOpen(false)}
        onSaved={loadData}
      />

      <StockMenuDialog
        open={stockOpen}
        onClose={() => setStockOpen(false)}
        onSaved={loadData}
      />

      <ProductSettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
      />
    </div>
  );
}
