import React from "react";
import NumberFlow from "@number-flow/react";

/**
 * Preço em reais com animação de "roleta": ao mudar o valor (ex.: mensal → anual) os dígitos rolam até o
 * novo preço. Mesma formatação do resto do sistema (R$ 169,90). Sem JavaScript de animação extra: usa o
 * @number-flow/react e respeita prefers-reduced-motion.
 *
 * @param {{ value: number, suffix?: string, className?: string }} props
 */
export default function PrecoAnimado({ value, suffix = "", className }) {
  return (
    <NumberFlow
      value={value}
      locales="pt-BR"
      format={{ style: "currency", currency: "BRL", minimumFractionDigits: 2, maximumFractionDigits: 2 }}
      suffix={suffix}
      transformTiming={{ duration: 600, easing: "ease-out" }}
      spinTiming={{ duration: 600, easing: "ease-out" }}
      willChange
      className={className}
    />
  );
}
