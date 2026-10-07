import React from "react";
import { Card } from "@/components/ui/card";

/**
 * @param {{
 *   label: string,
 *   value: React.ReactNode,
 *   subtitle?: React.ReactNode,
 *   icon?: React.ComponentType<{ className?: string }>,
 *   colorClass?: string,
 *   valueClass?: string,
 *   bgClass?: string,
 * }} props
 */
export default function KpiCard({
  label,
  value,
  subtitle,
  icon: Icon,
  colorClass,
  valueClass,
  bgClass,
}) {
  return (
    <Card
      className={`p-4 flex flex-col gap-1 ${bgClass || ""} hover:shadow-md transition-shadow`}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground font-medium uppercase tracking-wide">
          {label}
        </span>
        {Icon && (
          <Icon className={`w-4 h-4 ${colorClass || "text-muted-foreground"}`} />
        )}
      </div>
      <div className={`text-xl font-bold ${valueClass || ""}`}>{value}</div>
      {subtitle && <div className="text-xs text-muted-foreground">{subtitle}</div>}
    </Card>
  );
}