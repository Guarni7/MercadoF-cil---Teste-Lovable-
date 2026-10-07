import React, { useState, useEffect, useMemo } from "react";
import { ArrowLeft, Search, Repeat } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api } from "@/api/dataClient";
import { formatBRL, formatDate } from "@/lib/format";

export default function RecurringAccounts({ onBack }) {
  const [bills, setBills] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("todas");
  const [statusFilter, setStatusFilter] = useState("ativas");

  useEffect(() => {
    loadBills();
  }, []);

  const loadBills = async () => {
    try {
      const data = await api.entities.Bill.list("-due_date", 500);
      setBills(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const filteredBills = useMemo(() => {
    return bills.filter((b) => {
      if (!b.recurring) return false;
      if (search) {
        const q = search.toLowerCase();
        if (
          !b.supplier?.toLowerCase().includes(q) &&
          !b.description?.toLowerCase().includes(q) &&
          !b.category?.toLowerCase().includes(q)
        )
          return false;
      }
      if (typeFilter !== "todas" && b.type !== typeFilter) return false;
      if (statusFilter === "ativas" && b.paid) return false;
      if (statusFilter === "inativas" && !b.paid) return false;
      return true;
    });
  }, [bills, search, typeFilter, statusFilter]);

  return (
    <div className="w-full">
      {/* Header */}
      <div className="mb-4">
        <h1 className="text-xl font-heading font-bold mb-2">Financeiro</h1>
        <div className="flex items-center gap-2 text-sm">
          <button onClick={onBack} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary/10 text-primary font-medium hover:bg-primary/20 transition-colors">
            <ArrowLeft className="w-4 h-4" /> Voltar
          </button>
          <span className="text-muted-foreground">|</span>
          <span className="font-semibold">Recorrentes / Parceladas</span>
        </div>
      </div>

      <div className="bg-card rounded-xl border shadow-sm p-5 space-y-4">
        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nome, CPF/CNPJ ou telefone..."
            className="pl-10 h-10"
          />
        </div>

        {/* Filters */}
        <div className="grid grid-cols-3 gap-2">
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todas">Todos os tipos</SelectItem>
              <SelectItem value="pagar">A Pagar</SelectItem>
              <SelectItem value="receber">A Receber</SelectItem>
            </SelectContent>
          </Select>
          <Select value={typeFilter === "todas" ? "todas" : typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todas">Pagar e Receber</SelectItem>
              <SelectItem value="pagar">Pagar</SelectItem>
              <SelectItem value="receber">Receber</SelectItem>
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ativas">Ativas</SelectItem>
              <SelectItem value="inativas">Inativas</SelectItem>
              <SelectItem value="todas">Todas</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* List / Empty state */}
        {loading ? (
          <div className="flex justify-center py-12">
            <div className="w-6 h-6 border-4 border-muted border-t-primary rounded-full animate-spin" />
          </div>
        ) : filteredBills.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Repeat className="w-12 h-12 text-muted-foreground/30 mb-3" />
            <p className="text-sm text-muted-foreground">Nenhuma assinatura ou parcelamento</p>
          </div>
        ) : (
          <div className="space-y-2">
            {filteredBills.map((bill) => (
              <div key={bill.id} className="flex items-center gap-3 p-3 rounded-lg border">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">
                    {bill.description || bill.category || "Sem descrição"}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {bill.type === "pagar" ? "A Pagar" : "A Receber"} • {bill.supplier || "—"} • Venc: {formatDate(bill.due_date)}
                  </div>
                </div>
                <span className="text-sm font-semibold shrink-0">{formatBRL(bill.amount)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}