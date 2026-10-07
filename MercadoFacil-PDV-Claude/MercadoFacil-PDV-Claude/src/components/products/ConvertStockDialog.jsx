import React, { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { api } from "@/api/dataClient";
import { toast } from "sonner";
import { ArrowLeftRight, X, ArrowDown, Loader2 } from "lucide-react";

export default function ConvertStockDialog({ open, onClose, onSaved }) {
  const [products, setProducts] = useState([]);
  const [saidaId, setSaidaId] = useState("");
  const [saidaQty, setSaidaQty] = useState("");
  const [entradaId, setEntradaId] = useState("");
  const [entradaQty, setEntradaQty] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      loadProducts();
      setSaidaId("");
      setSaidaQty("");
      setEntradaId("");
      setEntradaQty("");
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

  const handleConvert = async () => {
    if (!saidaId || !entradaId || !saidaQty || !entradaQty) {
      toast.error("Preencha todos os campos.");
      return;
    }
    if (saidaId === entradaId) {
      toast.error("Selecione produtos diferentes.");
      return;
    }
    setSaving(true);
    try {
      const saidaProduct = products.find((p) => p.id === saidaId);
      const entradaProduct = products.find((p) => p.id === entradaId);
      const sQty = parseFloat(saidaQty);
      const eQty = parseFloat(entradaQty);

      if ((saidaProduct.stock || 0) < sQty) {
        toast.error("Estoque insuficiente para saída.");
        setSaving(false);
        return;
      }

      await api.entities.Product.update(saidaId, {
        stock: (saidaProduct.stock || 0) - sQty,
      });
      await api.entities.Product.update(entradaId, {
        stock: (entradaProduct.stock || 0) + eQty,
      });

      await api.entities.StockMovement.create({
        product_id: saidaId,
        product_name: saidaProduct.name,
        type: "saida",
        quantity: sQty,
        reason: "transferencia",
        notes: `Convertido para ${entradaProduct.name}`,
      });
      await api.entities.StockMovement.create({
        product_id: entradaId,
        product_name: entradaProduct.name,
        type: "entrada",
        quantity: eQty,
        reason: "transferencia",
        notes: `Convertido de ${saidaProduct.name}`,
      });

      toast.success("Conversão realizada!");
      onSaved?.();
      onClose();
    } catch (e) {
      toast.error("Erro ao realizar conversão.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md p-0 gap-0 overflow-hidden">
        <DialogHeader className="p-4 flex flex-row items-center justify-between space-y-0">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-full bg-[#065f46]/10 flex items-center justify-center">
              <ArrowLeftRight className="w-4.5 h-4.5 text-[#065f46]" />
            </div>
            <DialogTitle className="text-base font-bold">Conversão de Estoque</DialogTitle>
          </div>
          <button onClick={onClose} className="p-1 rounded-md hover:bg-muted">
            <X className="w-5 h-5" />
          </button>
        </DialogHeader>

        <div className="px-4 pb-4 space-y-3">
          {/* Saída section */}
          <div className="p-3 rounded-lg border border-red-100 bg-red-50 space-y-2.5">
            <Label className="text-xs font-semibold uppercase text-red-700">
              Saída (Produto que sairá)
            </Label>
            <Select value={saidaId} onValueChange={setSaidaId}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione o produto..." />
              </SelectTrigger>
              <SelectContent>
                {products.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name} (Est: {p.stock || 0})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              type="number"
              step="0.01"
              value={saidaQty}
              onChange={(e) => setSaidaQty(e.target.value)}
              placeholder="Quantidade de saída"
            />
          </div>

          {/* Connector */}
          <div className="flex justify-center">
            <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center">
              <ArrowDown className="w-4 h-4 text-muted-foreground" />
            </div>
          </div>

          {/* Entrada section */}
          <div className="p-3 rounded-lg border border-green-100 bg-green-50 space-y-2.5">
            <Label className="text-xs font-semibold uppercase text-green-700">
              Entrada (Produto que entrará)
            </Label>
            <Select value={entradaId} onValueChange={setEntradaId}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione o produto..." />
              </SelectTrigger>
              <SelectContent>
                {products.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name} (Est: {p.stock || 0})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              type="number"
              step="0.01"
              value={entradaQty}
              onChange={(e) => setEntradaQty(e.target.value)}
              placeholder="Quantidade de entrada"
            />
          </div>

          <Button
            onClick={handleConvert}
            disabled={saving}
            className="w-full h-11 gap-2 bg-[#065f46] hover:bg-[#065f46]/90"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowLeftRight className="w-4 h-4" />}
            Realizar Conversão
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}