import React, { useMemo, useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { ChevronDown, ChevronUp, Settings } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Painel flutuante (sheet à direita) para ligar/desligar colunas da lista.
 * Usado em Clientes, Produtos e demais telas de listagem.
 */
export default function ListColumnsSheet({
  open,
  onOpenChange,
  columns,
  onChange,
  columnDefs,
  lockedIds = ["name"],
  title = "Configurações",
  sectionLabel = "Colunas lista",
}) {
  const [expanded, setExpanded] = useState(true);
  const activeCount = useMemo(
    () => columnDefs.filter((c) => columns[c.id]).length,
    [columnDefs, columns]
  );

  const toggle = (id) => {
    if (lockedIds.includes(id)) return;
    const next = { ...columns, [id]: !columns[id] };
    for (const locked of lockedIds) next[locked] = true;
    onChange(next);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-md p-0 flex flex-col data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right duration-300"
      >
        <SheetHeader className="px-5 pt-5 pb-3 border-b text-left space-y-0">
          <div className="flex items-center gap-2 pr-8">
            <Settings className="w-4 h-4 text-primary" />
            <SheetTitle className="text-base">{title}</SheetTitle>
          </div>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-2 py-2">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="w-full flex items-center justify-between px-3 py-2.5 rounded-lg hover:bg-muted/60"
          >
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                {sectionLabel}
              </span>
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-primary/15 text-primary">
                {activeCount}
              </span>
            </div>
            {expanded ? (
              <ChevronUp className="w-4 h-4 text-muted-foreground" />
            ) : (
              <ChevronDown className="w-4 h-4 text-muted-foreground" />
            )}
          </button>

          {expanded && (
            <div className="px-1 pb-4">
              {columnDefs.map((col) => {
                const locked = lockedIds.includes(col.id);
                return (
                  <div
                    key={col.id}
                    className={cn(
                      "flex items-center justify-between gap-3 px-3 py-2.5 rounded-md",
                      locked && "opacity-90"
                    )}
                  >
                    <span className="text-sm text-foreground">{col.label}</span>
                    <Switch
                      checked={!!columns[col.id]}
                      disabled={locked}
                      onCheckedChange={() => toggle(col.id)}
                    />
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

/** Hook genérico de colunas + persistência. */
export function useListColumns(store) {
  const [columns, setColumns] = useState(() => store.load());
  const setAndSave = (next) => {
    const value = typeof next === "function" ? next(columns) : next;
    setColumns(value);
    store.save(value);
  };
  return [columns, setAndSave];
}
