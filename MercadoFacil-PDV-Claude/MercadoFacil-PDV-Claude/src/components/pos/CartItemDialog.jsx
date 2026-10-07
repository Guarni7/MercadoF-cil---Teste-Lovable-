import React, { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Package, Trash2, Minus, Plus } from "lucide-react";
import CurrencyInput from "@/components/ui/currency-input";
import { formatBRL } from "@/lib/format";
import { cn } from "@/lib/utils";

export default function CartItemDialog({ open, onClose, item, onUpdate, onRemove }) {
  const [quantity, setQuantity] = useState(1);
  const [customPrice, setCustomPrice] = useState(0);
  const [discountType, setDiscountType] = useState("R$");
  const [discountValue, setDiscountValue] = useState(0);
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (open && item) {
      setQuantity(item.quantity || 1);
      setCustomPrice(item.customPrice || item.product?.price || 0);
      setDiscountType(item.discountType || "R$");
      setDiscountValue(item.discountValue || 0);
      setNotes(item.notes || "");
    }
  }, [open, item]);

  if (!item) return null;

  const unitPrice = customPrice || item.product.price;
  const lineTotal = unitPrice * quantity;
  const discountAmount =
    discountType === "R$" ? discountValue : (lineTotal * discountValue) / 100;
  const finalTotal = Math.max(0, lineTotal - discountAmount);

  const handleConfirm = () => {
    onUpdate(item.product.id, {
      quantity,
      customPrice: customPrice !== item.product.price ? customPrice : undefined,
      itemDiscount: discountAmount,
      discountType,
      discountValue,
      notes: notes || undefined,
    });
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md p-0 gap-0 overflow-hidden">
        {/* Header */}
        <DialogHeader className="p-4 flex flex-row items-center justify-between space-y-0 border-b">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg border flex items-center justify-center">
              <Package className="w-4.5 h-4.5 text-muted-foreground" />
            </div>
            <div>
              <DialogTitle className="text-base font-bold">{item.product.name}</DialogTitle>
              <p className="text-xs text-muted-foreground">
                {formatBRL(item.product.price)} /{item.product.unit || "UN"}
              </p>
            </div>
          </div>
          <button
            onClick={() => {
              onRemove(item.product.id);
              onClose();
            }}
            className="p-1.5 rounded-lg hover:bg-destructive/10 text-destructive"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </DialogHeader>

        <div className="p-4 space-y-4">
          {/* Quantity */}
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Qtd</span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setQuantity(Math.max(1, quantity - 1))}
                className="w-8 h-8 rounded-lg border flex items-center justify-center hover:bg-muted"
              >
                <Minus className="w-4 h-4" />
              </button>
              <div className="w-12 h-8 rounded-lg border flex items-center justify-center text-sm font-semibold">
                {quantity}
              </div>
              <button
                onClick={() => setQuantity(quantity + 1)}
                className="w-8 h-8 rounded-lg border flex items-center justify-center hover:bg-muted"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Price */}
          <div className="border-t border-dashed border-border pt-3 flex items-center justify-between">
            <span className="text-sm font-medium">Preço unit.</span>
            <CurrencyInput
              value={customPrice}
              onChange={setCustomPrice}
              className="h-8 w-32 text-sm font-semibold"
            />
          </div>

          {/* Discount */}
          <div className="border-t border-dashed border-border pt-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Desconto</span>
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setDiscountType("R$")}
                    className={cn(
                      "px-2.5 py-1 rounded-md text-xs font-medium",
                      discountType === "R$" ? "bg-primary text-primary-foreground" : "border"
                    )}
                  >
                    R$
                  </button>
                  <button
                    onClick={() => setDiscountType("%")}
                    className={cn(
                      "px-2.5 py-1 rounded-md text-xs font-medium",
                      discountType === "%" ? "bg-primary text-primary-foreground" : "border"
                    )}
                  >
                    %
                  </button>
                </div>
                {discountType === "R$" ? (
                  <CurrencyInput value={discountValue} onChange={setDiscountValue} className="h-8 w-28 text-sm font-semibold" />
                ) : (
                  <div className="relative w-28">
                    <Input
                      type="number"
                      value={discountValue || ""}
                      onChange={(e) => setDiscountValue(parseFloat(e.target.value) || 0)}
                      placeholder="0"
                      className="h-8 text-sm font-semibold pr-7"
                    />
                    <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">%</span>
                  </div>
                )}
              </div>
            </div>
            {discountAmount > 0 && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-destructive font-medium">Desconto</span>
                <span className="text-destructive font-semibold">-{formatBRL(discountAmount)}</span>
              </div>
            )}
          </div>

          {/* Notes */}
          <div className="border-t border-dashed border-border pt-3">
            <Input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Obs: Ex: Sem cebola..."
              className="h-9"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t">
          <Button onClick={handleConfirm} className="w-full h-11 font-medium">
            Confirmar — {formatBRL(finalTotal)}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}