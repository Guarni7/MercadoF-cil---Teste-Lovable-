import React, { useState, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Scale, Loader2, RefreshCw, Plus } from "lucide-react";
import { formatBRL, roundMoney } from "@/lib/format";
import { readWeight, isScaleSupported, getScaleConfig } from "@/lib/scale";
import { toast } from "sonner";

export default function WeighDialog({ open, onClose, products, onAddWeighted }) {
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [weight, setWeight] = useState("");
  const [reading, setReading] = useState(false);

  const weightedProducts = useMemo(
    () => products.filter((p) => p.unit === "KG" || p.unit === "G"),
    [products]
  );

  const config = getScaleConfig();

  const handleRead = async () => {
    setReading(true);
    setWeight("");
    try {
      const w = await readWeight();
      setWeight(w.toFixed(3).replace(".", ","));
      toast.success(`Peso lido: ${w.toFixed(3).replace(".", ",")} kg`);
    } catch (e) {
      toast.error(e.message || "Erro ao ler balança.");
    } finally {
      setReading(false);
    }
  };

  const handleConfirm = () => {
    const w = parseFloat(weight.replace(",", "."));
    if (!w || w <= 0) {
      toast.error("Informe um peso válido.");
      return;
    }
    if (!selectedProduct) {
      toast.error("Selecione um produto.");
      return;
    }
    onAddWeighted(selectedProduct, w);
    setSelectedProduct(null);
    setWeight("");
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl p-8">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2.5 text-lg">
            <Scale className="w-6 h-6 text-primary" /> Pesagem
          </DialogTitle>
          <DialogDescription className="text-sm">
            Selecione um produto a granel, leia o peso da balança e adicione ao carrinho.
          </DialogDescription>
        </DialogHeader>

        {!isScaleSupported() ? (
          <div className="text-center py-10 text-base text-muted-foreground">
            Balança não suportada neste navegador ou não configurada.
            <br />
            Vá em Configurações → Balança para configurar.
          </div>
        ) : (
          <div className="space-y-5">
            <div>
              <Label className="mb-2.5 block text-sm">Produto a granel</Label>
              <ScrollArea className="h-56 rounded-lg border">
                {weightedProducts.length === 0 ? (
                  <div className="p-4 text-center text-sm text-muted-foreground">
                    Nenhum produto com unidade KG ou G cadastrado.
                  </div>
                ) : (
                  <div className="divide-y">
                    {weightedProducts.map((p) => (
                      <button
                        key={p.id}
                        onClick={() => setSelectedProduct(p)}
                        className={`w-full flex items-center justify-between p-3.5 text-left hover:bg-muted transition-colors ${
                          selectedProduct?.id === p.id ? "bg-primary/10" : ""
                        }`}
                      >
                        <div className="min-w-0">
                          <div className="text-sm font-medium truncate">{p.name}</div>
                          <div className="text-xs text-muted-foreground">
                            {p.unit} · Estq: {p.stock || 0}
                          </div>
                        </div>
                        <span className="font-bold text-primary text-base ml-2">
                          {formatBRL(p.price)}/{p.unit}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </ScrollArea>
            </div>

            <div>
              <Label className="mb-2.5 block text-sm">Peso (kg)</Label>
              <div className="flex gap-2">
                <Input
                  value={weight}
                  onChange={(e) => setWeight(e.target.value)}
                  placeholder="0,000"
                  className="text-xl font-semibold h-11"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleRead}
                  disabled={reading}
                  className="gap-2 shrink-0 h-11 px-5"
                >
                  {reading ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    <RefreshCw className="w-5 h-5" />
                  )}
                  Ler
                </Button>
              </div>
              <p className="text-xs text-muted-foreground mt-1.5">
                {config.brand
                  ? `Balança: ${config.brand.toUpperCase()} · ${config.connection}`
                  : "Configure a balança em Configurações."}
              </p>
            </div>

            {selectedProduct && weight && (
              <div className="rounded-lg bg-muted p-4 flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Total</span>
                <span className="text-xl font-bold text-primary">
                  {formatBRL(
                    roundMoney((parseFloat(weight.replace(",", ".")) || 0) * selectedProduct.price)
                  )}
                </span>
              </div>
            )}
          </div>
        )}

        <DialogFooter className="pt-2">
          <Button variant="outline" onClick={onClose} className="h-10 px-6">
            Cancelar
          </Button>
          <Button onClick={handleConfirm} disabled={!selectedProduct || !weight} className="gap-2 h-10 px-6">
            <Plus className="w-4 h-4" /> Adicionar ao Carrinho
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}