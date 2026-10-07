import React from "react";
import { ArrowLeft, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * `filters` vem do hook useReportFilters. Sem ele a barra some inteira — antes
 * ela era renderizada mesmo sem ninguém ouvir os campos, e o usuário escolhia um
 * período que o relatório ignorava.
 */
/**
 * @param {{
 *   title: string,
 *   icon?: React.ComponentType<{ className?: string }>,
 *   iconColor?: string,
 *   onBack: () => void,
 *   children?: React.ReactNode,
 *   filters?: { de: string, ate: string, busca: string, status: string, setDe: (v: string) => void, setAte: (v: string) => void, setBusca: (v: string) => void, setStatus: (v: string) => void },
 *   searchPlaceholder?: string,
 *   statusLabels?: { ativas: string, todas: string },
 *   showDateRange?: boolean,
 *   showSearch?: boolean,
 *   showStatus?: boolean,
 *   extraFilters?: React.ReactNode,
 *   rightActions?: React.ReactNode,
 * }} props
 */
export default function ReportShell({
  title,
  icon: Icon,
  iconColor,
  onBack,
  children,
  filters,
  searchPlaceholder = "Buscar...",
  statusLabels,
  showDateRange = true,
  showSearch = true,
  showStatus = true,
  extraFilters,
  rightActions,
}) {
  const temBarra = filters && (showDateRange || showSearch || showStatus);
  const rotulos = statusLabels || { ativas: "Ativas", todas: "Todas" };

  return (
    <div className="p-4 lg:p-6">
      <button
        onClick={onBack}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground font-medium hover:bg-primary/90 transition-colors mb-4"
      >
        <ArrowLeft className="w-4 h-4" /> Voltar
      </button>

      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div className="flex items-center gap-2">
          {Icon && <Icon className={`w-6 h-6 ${iconColor || "text-primary"}`} />}
          <h1 className="text-2xl font-heading font-bold">{title}</h1>
        </div>
        {rightActions}
      </div>

      {temBarra && (
        <div className="flex items-center gap-2 mb-4 flex-wrap">
          {showDateRange && (
            <>
              <Input
                type="date"
                className="w-auto"
                value={filters.de}
                onChange={(e) => filters.setDe(e.target.value)}
              />
              <span className="text-muted-foreground text-sm">a</span>
              <Input
                type="date"
                className="w-auto"
                value={filters.ate}
                onChange={(e) => filters.setAte(e.target.value)}
              />
            </>
          )}
          {showSearch && (
            <div className="relative flex-1 min-w-[200px]">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder={searchPlaceholder}
                className="pl-9"
                value={filters.busca}
                onChange={(e) => filters.setBusca(e.target.value)}
              />
            </div>
          )}
          {showStatus && (
            <Select value={filters.status} onValueChange={filters.setStatus}>
              <SelectTrigger className="w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ativas">{rotulos.ativas}</SelectItem>
                <SelectItem value="todas">{rotulos.todas}</SelectItem>
              </SelectContent>
            </Select>
          )}
        </div>
      )}

      {extraFilters}

      {children}
    </div>
  );
}
