import React, { useState, useMemo } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Search, Package } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatBRL } from "@/lib/format";

export default function ProductBrowserDialog({ open, onClose, products = [], categories = [], onAddToCart }) {
  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("");

  const filtered = useMemo(() => {
    return products.filter((p) => {
      const matchSearch =
        !search ||
        p.name?.toLowerCase().includes(search.toLowerCase()) ||
        (p.barcode && p.barcode.includes(search));
      const matchCategory = !selectedCategory || p.category === selectedCategory;
      return matchSearch && matchCategory;
    });
  }, [products, search, selectedCategory]);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Package className="w-5 h-5 text-primary" /> Todos os Produtos
          </DialogTitle>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            autoFocus
            placeholder="Buscar produto ou código..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10"
          />
        </div>

        <div className="flex gap-2 overflow-x-auto pb-1">
          <button
            onClick={() => setSelectedCategory("")}
            className={cn(
              "px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors",
              !selectedCategory ? "bg-primary text-primary-foreground" : "bg-muted hover:bg-muted/70"
            )}
          >
            Todos
          </button>
          {categories.map((cat) => (
            <button
              key={cat.id}
              onClick={() => setSelectedCategory(cat.name)}
              className={cn(
                "px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors",
                selectedCategory === cat.name ? "bg-primary text-primary-foreground" : "bg-muted hover:bg-muted/70"
              )}
            >
              {cat.name}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto -mx-1 px-1">
          {filtered.length === 0 ? (
            <div className="text-center text-muted-foreground py-12">
              <Package className="w-10 h-10 mx-auto mb-2 opacity-30" />
              <p className="text-sm">Nenhum produto encontrado.</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {filtered.map((product) => (
                <button
                  key={product.id}
                  onClick={() => {
                    onAddToCart(product);
                    onClose();
                  }}
                  className={cn(
                    "text-left p-3 rounded-xl border bg-card hover:shadow-md hover:border-primary/40 transition-all",
                    (product.stock || 0) <= 0 && "opacity-50"
                  )}
                >
                  <div className="aspect-square rounded-lg bg-muted mb-2 flex items-center justify-center overflow-hidden">
                    {product.image_url ? (
                      <img src={product.image_url} alt={product.name} className="w-full h-full object-cover" />
                    ) : (
                      <Package className="w-8 h-8 text-muted-foreground/40" />
                    )}
                  </div>
                  <div className="text-sm font-medium leading-tight line-clamp-2 mb-1">{product.name}</div>
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-primary text-sm">{formatBRL(product.price)}</span>
                    <span className="text-xs text-muted-foreground">{product.stock || 0} {product.unit || "UN"}</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}