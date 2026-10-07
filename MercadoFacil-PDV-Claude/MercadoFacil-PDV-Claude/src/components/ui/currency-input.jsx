import React, { useState, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

function formatCents(cents) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format((cents || 0) / 100);
}

/**
 * Input de moeda com máscara BRL.
 * - Armazena o valor em centavos internamente.
 * - Exibe "R$ 0,00" e formata conforme o usuário digita (acumula centavos).
 * - onChange retorna o valor numérico em reais (number).
 */
/**
 * @param {{ value: number, onChange?: (v: number) => void, className?: string, placeholder?: string } & Omit<React.ComponentPropsWithoutRef<'input'>, 'value' | 'onChange' | 'className' | 'placeholder'>} props
 */
export default function CurrencyInput({ value, onChange, className, placeholder, ...props }) {
  const [cents, setCents] = useState(() => Math.round((Number(value) || 0) * 100));
  const isUserTyping = useRef(false);

  useEffect(() => {
    if (!isUserTyping.current) {
      setCents(Math.round((Number(value) || 0) * 100));
    }
    isUserTyping.current = false;
  }, [value]);

  const handleChange = (e) => {
    isUserTyping.current = true;
    const digits = (e.target.value || "").replace(/\D/g, "");
    const newCents = parseInt(digits) || 0;
    setCents(newCents);
    if (onChange) onChange(newCents / 100);
  };

  return (
    <input
      type="text"
      inputMode="numeric"
      value={formatCents(cents)}
      onChange={handleChange}
      placeholder={placeholder || "R$ 0,00"}
      className={cn(
        "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        className
      )}
      {...props}
    />
  );
}