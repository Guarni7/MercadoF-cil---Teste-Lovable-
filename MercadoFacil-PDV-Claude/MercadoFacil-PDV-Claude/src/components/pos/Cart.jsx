import React, { useState } from "react";
import { Minus, Plus, Trash2, ShoppingCart, X, CheckCircle2, Info, Receipt, User, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatBRL, roundMoney } from "@/lib/format";
import CurrencyInput from "@/components/ui/currency-input";
import SupportDialog from "@/components/SupportDialog";

/**
 * @param {{
 *   items: any[], onUpdateQuantity: (productId: any, delta: any) => void, onRemove: (productId: any) => void,
 *   onClear: () => void, subtotal: number, discount: number, setDiscount: React.Dispatch<React.SetStateAction<number>>,
 *   total: number, onCheckout: () => void, onClose?: () => void, selectedCustomer?: any,
 *   onClearCustomer?: () => void, onEditItem?: React.Dispatch<any>,
 * }} props
 */
export default function Cart({
  items,
  onUpdateQuantity,
  onRemove,
  onClear,
  subtotal,
  discount,
  setDiscount,
  total,
  onCheckout,
  onClose,
  selectedCustomer,
  onClearCustomer,
  onEditItem,
}) {
  const itemCount = items.reduce((sum, item) => sum + item.quantity, 0);
  const [supportOpen, setSupportOpen] = useState(false);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-300" style={{ background: "#F0F4EF" }}>
        <div className="flex items-center justify-between gap-2">
          {/* Left: Itens da Venda */}
          <div className="flex items-center gap-2 shrink-0">
            <ShoppingCart className="w-4 h-4" style={{ color: "#2D3E40" }} />
            <span className="text-sm font-medium" style={{ color: "#2D3E40" }}>Itens da Venda</span>
            <span className="text-gray-300">|</span>
          </div>
          {/* Center: Caixa Livre */}
          <div className="flex items-center gap-1.5 shrink-0">
            <CheckCircle2 className="w-4 h-4" style={{ color: "#2E8B57" }} />
            <span className="text-sm font-bold" style={{ color: "#2E8B57" }}>Caixa Livre</span>
          </div>
          {/* Right: Suporte / Info */}
          <div className="flex items-center gap-2 shrink-0">
            {selectedCustomer ? (
              <div className="flex items-center gap-2 px-2 py-1 rounded-lg bg-white/60 border border-primary/20 max-w-[160px]">
                <User className="w-4 h-4 text-primary shrink-0" />
                <span className="text-xs font-medium truncate" style={{ color: "#2D3E40" }}>{selectedCustomer.name}</span>
                <button
                  onClick={onClearCustomer}
                  className="p-0.5 rounded hover:bg-muted text-muted-foreground hover:text-destructive shrink-0"
                  title="Remover cliente"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ) : (
              <button
                onClick={() => setSupportOpen(true)}
                className="px-3 py-1 rounded-full text-xs font-medium text-white shrink-0"
                style={{ background: "#A8B333" }}
              >
                Solicitar suporte
              </button>
            )}
            <div className="relative shrink-0">
              <Info className="w-4 h-4" style={{ color: "#6B7E82" }} />
              <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-green-500 border border-white" />
            </div>
            {items.length > 0 && (
              <button
                onClick={onClear}
                className="px-3 py-1 rounded-full text-xs font-medium flex items-center gap-1 shrink-0 border bg-white"
                style={{ borderColor: "#E0E0E0", color: "#D67A42" }}
              >
                <Trash2 className="w-3 h-3" /> Limpar
              </button>
            )}
            {onClose && (
              <button onClick={onClose} className="p-1 rounded-md hover:bg-black/5">
                <X className="w-5 h-5" style={{ color: "#2D3E40" }} />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Items list */}
      <div className="flex-1 overflow-auto">
        {items.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center py-10 bg-white">
            <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4" style={{ background: "#E0E9EB" }}>
              <ShoppingCart className="w-8 h-8" style={{ color: "#5F7E86" }} />
            </div>
            <p className="text-base font-bold" style={{ color: "#2D3E40" }}>Adicione produtos à venda</p>
            <p className="text-sm mt-1" style={{ color: "#6B7E82" }}>Use o campo de busca ou bipe o código de barras</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10" style={{ background: "#F5B787" }}>
              <tr className="text-xs uppercase font-semibold" style={{ color: "#5E4334" }}>
                <th className="text-left px-3 py-2 w-8">#</th>
                <th className="text-left px-2 py-2 w-16">Cód.</th>
                <th className="text-left px-2 py-2">Produto</th>
                <th className="text-center px-2 py-2 w-12">Qtd</th>
                <th className="text-right px-2 py-2 w-24">Unit.</th>
                <th className="text-right px-2 py-2 w-24">Total</th>
                <th className="text-center px-2 py-2 w-28">Ações</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, idx) => {
                const unitPrice = item.customPrice || item.product.price;
                const lineTotal = roundMoney(Math.max(0, unitPrice * item.quantity - (item.itemDiscount || 0)));
                const isLast = idx === items.length - 1;
                return (
                  <tr key={item.product.id} className="border-b border-border/40 hover:bg-muted/30">
                    <td className="px-3 py-2 text-muted-foreground">{idx + 1}</td>
                    <td className="px-2 py-2 text-muted-foreground">{item.product.code || item.product.barcode || "–"}</td>
                    <td className="px-2 py-2">
                      {isLast && (
                        <div className="text-[10px] uppercase text-muted-foreground font-medium">Último item</div>
                      )}
                      <div
                        className="font-medium truncate cursor-pointer"
                        onClick={() => onEditItem?.(item)}
                      >
                        {item.product.name}
                      </div>
                      {item.notes && (
                        <div className="text-xs text-muted-foreground italic truncate">Obs: {item.notes}</div>
                      )}
                    </td>
                    <td className="px-2 py-2 text-center font-medium">{item.quantity}</td>
                    <td className="px-2 py-2 text-right">{formatBRL(unitPrice)}</td>
                    <td className="px-2 py-2 text-right font-semibold">{formatBRL(lineTotal)}</td>
                    <td className="px-2 py-2">
                      <div className="flex items-center justify-center gap-1">
                        <button
                          onClick={() => onUpdateQuantity(item.product.id, -1)}
                          className="w-7 h-7 rounded-full border flex items-center justify-center hover:bg-muted"
                        >
                          <Minus className="w-3 h-3" />
                        </button>
                        <button
                          onClick={() => onUpdateQuantity(item.product.id, 1)}
                          className="w-7 h-7 rounded-full border flex items-center justify-center hover:bg-muted"
                        >
                          <Plus className="w-3 h-3" />
                        </button>
                        <button
                          onClick={() => onEditItem?.(item)}
                          className="w-7 h-7 rounded-full border flex items-center justify-center hover:bg-muted hover:-translate-y-0.5 hover:shadow-md active:translate-y-0 transition-all"
                        >
                          <Pencil className="w-3 h-3" />
                        </button>
                        <button
                          onClick={() => onRemove(item.product.id)}
                          className="w-7 h-7 rounded-full border flex items-center justify-center hover:bg-destructive/10 text-destructive"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Footer */}
      <div className="border-t bg-card">
        <div className="px-4 py-3 flex items-center justify-between">
          <div>
            <div className="text-sm text-muted-foreground">
              Subtotal: <span className="font-medium text-foreground">{formatBRL(subtotal)}</span>
            </div>
            <div className="text-xs text-muted-foreground">{itemCount} {itemCount === 1 ? "item" : "itens"}</div>
          </div>
          <div className="text-right">
            <div className="text-xs uppercase text-muted-foreground font-semibold tracking-wide">Total da Venda</div>
            <div className="text-2xl font-bold text-primary">{formatBRL(total)}</div>
          </div>
        </div>
        <div className="px-4 pb-3">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-xs text-muted-foreground whitespace-nowrap">Desconto:</span>
            <CurrencyInput
              value={discount}
              onChange={setDiscount}
              className="h-8 text-sm"
            />
          </div>
          <Button
            onClick={onCheckout}
            disabled={items.length === 0}
            className="w-full h-12 text-base gap-2 hover:-translate-y-0.5 hover:shadow-lg active:translate-y-0 active:shadow-sm transition-all"
            size="lg"
          >
            <Receipt className="w-5 h-5" /> Finalizar Venda (F10)
          </Button>
        </div>
      </div>
      <SupportDialog open={supportOpen} onClose={() => setSupportOpen(false)} />
    </div>
  );
}