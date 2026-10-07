import React, { useState, useMemo } from "react";
import {
  Dialog, DialogContent, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search, UserPlus, User } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatBRL } from "@/lib/format";

export default function SelectCustomerDialog({ open, onClose, customers = [], onSelect, onNewCustomer }) {
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState("todos");

  const filtered = useMemo(() => {
    let list = customers;
    if (query) {
      const q = query.toLowerCase();
      list = list.filter(
        (c) =>
          c.name?.toLowerCase().includes(q) ||
          (c.document && c.document.includes(query)) ||
          (c.phone && c.phone.includes(query))
      );
    }
    if (tab === "pessoas") {
      list = list.filter((c) => (c.document || "").length <= 14);
    } else if (tab === "empresas") {
      list = list.filter((c) => (c.document || "").length > 14);
    }
    return list;
  }, [customers, query, tab]);

  const handleSelect = (customer) => {
    onSelect?.(customer);
    onClose();
  };

  const tabs = [
    { id: "todos", label: "Todos" },
    { id: "pessoas", label: "Pessoas" },
    { id: "empresas", label: "Empresas" },
  ];

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl p-0 gap-0 overflow-hidden">
        {/* Header */}
        <div className="flex items-start gap-3 p-5 pb-4 border-b">
          <div
            className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0"
            style={{ background: "#e6efed" }}
          >
            <UserPlus className="w-5 h-5" style={{ color: "#004d40" }} />
          </div>
          <div className="flex-1 pt-0.5">
            <DialogTitle className="text-lg font-bold leading-tight" style={{ color: "#212121" }}>
              Selecionar Cliente
            </DialogTitle>
            <p className="text-sm mt-0.5" style={{ color: "#757575" }}>
              Busque por nome, CPF, CNPJ ou telefone
            </p>
          </div>
        </div>

        {/* Search + filters */}
        <div className="flex items-center gap-2 p-4 flex-wrap">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: "#757575" }} />
            <Input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar cliente..."
              className="pl-10 h-10 rounded-lg"
              style={{ borderColor: "#004d40", color: "#212121" }}
            />
          </div>
          <div className="flex gap-1.5">
            {tabs.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={cn(
                  "px-4 py-2 rounded-full text-xs font-semibold whitespace-nowrap transition-colors border",
                  tab === t.id
                    ? "bg-[#004d40]/5 text-[#004d40] border-[#004d40]"
                    : "bg-white text-[#757575] border-gray-200 hover:border-gray-300"
                )}
                style={tab === t.id ? { borderColor: "#004d40", color: "#004d40" } : {}}
              >
                {t.label}
              </button>
            ))}
          </div>
          <button
            onClick={() => handleSelect(null)}
            className="px-4 py-2 rounded-full text-xs font-semibold whitespace-nowrap transition-colors border border-gray-200 bg-white text-[#757575] hover:border-gray-300"
          >
            Sem cliente
          </button>
        </div>

        <div className="min-h-[200px] max-h-[300px] overflow-y-auto space-y-1">
          <button
            onClick={() => { onNewCustomer?.(); onClose(); }}
            className="w-full flex items-center gap-3 p-3 rounded-lg bg-amber-50 hover:bg-amber-100 transition-colors text-left"
          >
            <div className="w-9 h-9 rounded-full bg-amber-100 flex items-center justify-center shrink-0">
              <UserPlus className="w-4 h-4 text-amber-600" />
            </div>
            <div className="flex-1">
              <div className="text-sm font-medium">Cadastrar</div>
              <div className="text-xs text-muted-foreground">Novo cliente — Enter abre o formulário</div>
            </div>
            <span className="text-xs bg-muted px-2 py-0.5 rounded">ENTER</span>
          </button>

          {filtered.length === 0 ? (
            <div className="text-center py-8">
              <User className="w-10 h-10 mx-auto mb-2 text-muted-foreground/30" />
              <p className="text-sm text-muted-foreground">
                Nenhum cliente encontrado. Use Cadastrar acima ou outro termo de busca.
              </p>
            </div>
          ) : (
            filtered.map((c) => (
              <button
                key={c.id}
                onClick={() => handleSelect(c)}
                className="w-full flex items-center gap-3 p-3 rounded-lg border hover:bg-muted/50 transition-colors text-left"
              >
                <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                  <span className="text-sm font-semibold text-primary">
                    {(c.name || "U").charAt(0).toUpperCase()}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{c.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {c.document || c.phone || "—"}
                  </div>
                </div>
                {(c.credit_balance || 0) > 0 && (
                  <span className="text-xs text-amber-600 font-medium">
                    Devendo: {formatBRL(c.credit_balance)}
                  </span>
                )}
              </button>
            ))
          )}
        </div>

        <div className="flex items-center justify-between pt-3 border-t">
          <p className="text-xs text-muted-foreground hidden sm:block">
            ↑↓ navega | Enter seleciona | ESC fecha
          </p>
          <div className="flex gap-2 ml-auto">
            <Button variant="outline" onClick={onClose}>Cancelar</Button>
            <Button onClick={() => filtered[0] && handleSelect(filtered[0])} disabled={filtered.length === 0}>
              SELECIONAR (ENTER)
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}