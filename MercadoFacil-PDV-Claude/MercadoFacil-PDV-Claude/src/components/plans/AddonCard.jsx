import React from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Adicional (PDV POS, TEF, WhatsApp, NFS-e) como cartão selecionável: seletor redondo, nome, preço e
 * descrição. Só a apresentação: marcar/desmarcar continua sendo `onToggle` de quem usa (a mesma regra de antes).
 *
 * @param {{
 *   label: string,
 *   description?: string,
 *   price: React.ReactNode,
 *   priceBelow?: boolean,
 *   checked: boolean,
 *   disabled?: boolean,
 *   onToggle: () => void,
 *   badge?: React.ReactNode,
 *   accent?: string,
 * }} props
 */
export default function AddonCard({ label, description, price, priceBelow = false, checked, disabled = false, onToggle, badge, accent = "hsl(var(--primary))" }) {
  return (
    <label
      className={cn(
        "relative flex gap-3 rounded-xl border-2 bg-white p-4 shadow-sm transition-colors focus-within:ring-2 focus-within:ring-offset-1",
        disabled ? "cursor-default" : "cursor-pointer hover:border-slate-300",
        !checked && "border-slate-200",
      )}
      style={checked ? { borderColor: accent, boxShadow: "0 4px 20px rgba(45, 106, 79, 0.10)" } : undefined}
    >
      <input type="checkbox" className="sr-only" checked={checked} disabled={disabled} onChange={() => !disabled && onToggle()} />
      <span
        aria-hidden="true"
        className={cn("mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2", !checked && "border-slate-300")}
        style={checked ? { borderColor: accent, backgroundColor: accent } : undefined}
      >
        {checked && <Check className="h-3 w-3 text-white" strokeWidth={3} />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-start justify-between gap-3">
          <span className="flex flex-wrap items-center gap-2 text-sm font-semibold text-foreground">
            {label}
            {badge}
          </span>
          {!priceBelow && <span className="shrink-0 text-sm font-semibold text-muted-foreground">{price}</span>}
        </span>
        {priceBelow && (
          <span className="mt-0.5 block text-sm font-semibold" style={{ color: accent }}>
            {price}
          </span>
        )}
        {description && <p className="mt-1 text-xs text-muted-foreground">{description}</p>}
      </span>
    </label>
  );
}
