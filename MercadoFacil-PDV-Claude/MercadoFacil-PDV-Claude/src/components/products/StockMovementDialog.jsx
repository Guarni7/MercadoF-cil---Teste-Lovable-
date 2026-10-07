import React, { useState, useEffect, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api } from "@/api/dataClient";
import { toast } from "sonner";
import { ArrowUpCircle, ArrowDownCircle, X, Loader2, Search } from "lucide-react";

export default function StockMovementDialog({ open, onClose, onSaved }) {
  const [products, setProducts] = useState([]);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [search, setSearch] = useState("");
  const [showResults, setShowResults] = useState(false);
  const [type, setType] = useState("entrada");
  const [quantity, setQuantity] = useState("");
  const [reason, setReason] = useState("compra");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const searchRef = useRef(null);

  useEffect(() => {
    if (open) {
      loadProducts();
      setSelectedProduct(null);
      setSearch("");
      setShowResults(false);
      setQuantity("");
      setNotes("");
      setReason("compra");
      setType("entrada");
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

  const filtered = products.filter((p) => {
    if (!search) return false;
    const q = search.toLowerCase();
    return (
      p.name?.toLowerCase().includes(q) ||
      p.code?.toLowerCase().includes(q) ||
      p.barcode?.toLowerCase().includes(q)
    );
  });

  const handleSelectProduct = (product) => {
    setSelectedProduct(product);
    setSearch("");
    setShowResults(false);
  };

  const handleClearSearch = () => {
    setSearch("");
    setSelectedProduct(null);
    setShowResults(false);
    searchRef.current?.focus();
  };

  const handleSubmit = async () => {
    if (!selectedProduct || !quantity) {
      toast.error("Selecione o produto e a quantidade.");
      return;
    }
    setSaving(true);
    try {
      const qty = parseFloat(quantity);
      const newStock =
        (selectedProduct.stock || 0) + (type === "entrada" ? qty : -qty);

      if (newStock < 0) {
        toast.error("Estoque insuficiente para saída.");
        setSaving(false);
        return;
      }

      await api.entities.Product.update(selectedProduct.id, { stock: newStock });

      await api.entities.StockMovement.create({
        product_id: selectedProduct.id,
        product_name: selectedProduct.name,
        type,
        quantity: qty,
        reason,
        notes,
      });

      toast.success(`${type === "entrada" ? "Entrada" : "Saída"} registrada!`);
      onSaved?.();
      onClose();
    } catch (e) {
      console.error(e);
      toast.error("Erro ao registrar movimentação.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md p-0 gap-0 overflow-hidden">
        <DialogHeader className="p-4 flex flex-row items-center justify-between space-y-0">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center">
              {type === "entrada" ? (
                <ArrowUpCircle className="w-4.5 h-4.5 text-primary" />
              ) : (
                <ArrowDownCircle className="w-4.5 h-4.5 text-destructive" />
              )}
            </div>
            <DialogTitle className="text-base font-bold">Movimento de Estoque</DialogTitle>
          </div>
          <button onClick={onClose} className="p-1 rounded-md hover:bg-muted">
            <X className="w-5 h-5" />
          </button>
        </DialogHeader>

        <div className="px-4 pb-4 space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold uppercase text-muted-foreground">Tipo</Label>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setType("entrada")}
                className={`flex items-center gap-2 p-2.5 rounded-lg border-2 text-sm font-medium transition-all ${
                  type === "entrada"
                    ? "border-primary bg-primary/5 text-primary"
                    : "border-border text-muted-foreground"
                }`}
              >
                <ArrowUpCircle className="w-4 h-4" /> Entrada
              </button>
              <button
                onClick={() => setType("saida")}
                className={`flex items-center gap-2 p-2.5 rounded-lg border-2 text-sm font-medium transition-all ${
                  type === "saida"
                    ? "border-destructive bg-destructive/5 text-destructive"
                    : "border-border text-muted-foreground"
                }`}
              >
                <ArrowDownCircle className="w-4 h-4" /> Saída
              </button>
            </div>
          </div>

          {/* Product search */}
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold uppercase text-muted-foreground">Produto</Label>

            {selectedProduct ? (
              <div className="flex items-center gap-2 p-2.5 rounded-lg border-2 border-[#004d40] bg-[#f8f9fa]">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{selectedProduct.name}</div>
                  <div className="text-xs text-muted-foreground">
                    Est: {selectedProduct.stock || 0} {selectedProduct.unit || "UN"}
                  </div>
                </div>
                <button
                  onClick={handleClearSearch}
                  className="p-1 rounded-md hover:bg-muted text-[#004d40]"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#004d40] pointer-events-none" />
                <input
                  ref={searchRef}
                  type="text"
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setShowResults(true);
                  }}
                  onFocus={() => setShowResults(true)}
                  placeholder="Código, EAN ou nome do produto..."
                  className="w-full h-10 pl-10 pr-10 rounded-lg border-2 border-[#004d40] bg-[#f8f9fa] text-sm text-stone-700 placeholder:text-stone-400 focus:outline-none focus:ring-0"
                />
                {search && (
                  <button
                    onClick={handleClearSearch}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[#004d40] hover:opacity-70"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}

                {showResults && search && (
                  <div className="absolute z-50 top-full mt-1 w-full max-h-56 overflow-y-auto rounded-lg border bg-popover shadow-lg">
                    {filtered.length === 0 ? (
                      <div className="p-3 text-sm text-muted-foreground text-center">
                        Nenhum produto encontrado
                      </div>
                    ) : (
                      filtered.slice(0, 20).map((p) => (
                        <button
                          key={p.id}
                          onClick={() => handleSelectProduct(p)}
                          className="w-full flex items-center justify-between gap-2 p-2.5 hover:bg-muted text-left transition-colors border-b last:border-0"
                        >
                          <div className="min-w-0">
                            <div className="text-sm font-medium truncate">{p.name}</div>
                            <div className="text-xs text-muted-foreground">
                              {p.code || "—"} · {p.barcode || ""}
                            </div>
                          </div>
                          <span className="text-xs text-muted-foreground shrink-0">
                            Est: {p.stock || 0}
                          </span>
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold uppercase text-muted-foreground">Quantidade</Label>
              <Input
                type="number"
                step="0.01"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                placeholder="0"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold uppercase text-muted-foreground">Motivo</Label>
              <Select value={reason} onValueChange={setReason}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="compra">Compra</SelectItem>
                  <SelectItem value="ajuste">Ajuste</SelectItem>
                  <SelectItem value="perda">Perda</SelectItem>
                  <SelectItem value="devolucao">Devolução</SelectItem>
                  <SelectItem value="transferencia">Transferência</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-semibold uppercase text-muted-foreground">Observações</Label>
            <Input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Opcional..."
            />
          </div>

          <Button onClick={handleSubmit} disabled={saving} className="w-full h-11 gap-2">
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            Registrar Movimento
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}