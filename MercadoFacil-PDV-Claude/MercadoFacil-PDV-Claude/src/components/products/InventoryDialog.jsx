import React, { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/api/dataClient";
import { toast } from "sonner";
import { ClipboardList, X, Loader2, Search, Check } from "lucide-react";

export default function InventoryDialog({ open, onClose, onSaved }) {
  const [products, setProducts] = useState([]);
  const [search, setSearch] = useState("");
  const [changes, setChanges] = useState(/** @type {Record<string, any>} */ ({}));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      loadProducts();
      setChanges({});
      setSearch("");
    }
  }, [open]);

  const loadProducts = async () => {
    try {
      const list = await api.entities.Product.list("name", 500);
      setProducts(list);
    } catch (e) {
      console.error(e);
    }
  };

  const filtered = products.filter((p) =>
    !search || p.name.toLowerCase().includes(search.toLowerCase())
  );

  const handleStockChange = (productId, value) => {
    setChanges((prev) => ({ ...prev, [productId]: value }));
  };

  const handleSave = async () => {
    const toUpdate = Object.entries(changes)
      .filter(([_, val]) => val !== "" && val !== undefined)
      .map(([id, val]) => ({ id, stock: parseFloat(val) || 0 }));

    if (toUpdate.length === 0) {
      toast.info("Nenhum estoque alterado.");
      return;
    }
    setSaving(true);
    try {
      await api.entities.Product.bulkUpdate(toUpdate);
      toast.success(`${toUpdate.length} produto(s) atualizado(s)!`);
      onSaved?.();
      onClose();
    } catch (e) {
      toast.error("Erro ao atualizar estoque.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg p-0 gap-0 overflow-hidden">
        <DialogHeader className="p-4 flex flex-row items-center justify-between space-y-0">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center">
              <ClipboardList className="w-4.5 h-4.5 text-primary" />
            </div>
            <DialogTitle className="text-base font-bold">Inventário</DialogTitle>
          </div>
          <button onClick={onClose} className="p-1 rounded-md hover:bg-muted">
            <X className="w-5 h-5" />
          </button>
        </DialogHeader>

        <div className="px-4 pb-4 space-y-3">
          <p className="text-xs text-muted-foreground">
            Substitua o estoque dos produtos informando a quantidade contada.
          </p>

          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Buscar produto..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10"
            />
          </div>

          <div className="max-h-72 overflow-y-auto space-y-1.5">
            {filtered.map((p) => (
              <div
                key={p.id}
                className="flex items-center gap-2 p-2.5 rounded-lg border bg-card"
              >
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{p.name}</div>
                  <div className="text-xs text-muted-foreground">
                    Atual: {p.stock || 0} {p.unit || "UN"}
                  </div>
                </div>
                <Input
                  type="number"
                  step="0.01"
                  value={changes[p.id] ?? ""}
                  onChange={(e) => handleStockChange(p.id, e.target.value)}
                  placeholder={String(p.stock || 0)}
                  className="w-24 h-8 text-sm"
                />
                {changes[p.id] !== undefined && changes[p.id] !== "" && (
                  <Check className="w-4 h-4 text-primary shrink-0" />
                )}
              </div>
            ))}
          </div>

          <Button onClick={handleSave} disabled={saving} className="w-full h-11 gap-2">
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            Salvar Inventário
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}