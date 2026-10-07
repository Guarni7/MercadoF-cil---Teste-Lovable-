import React, { useState, useEffect, useMemo } from "react";
import { ArrowLeft, Search, FileText, Check } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api } from "@/api/dataClient";
import { formatBRL, formatDate } from "@/lib/format";
import { toast } from "sonner";

function getStatus(bill) {
  if (bill.paid) return "baixado";
  const due = new Date(bill.due_date + "T00:00:00");
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return due < today ? "vencido" : "pendente";
}

const statusLabels = {
  pendente: "Pendente",
  vencido: "Vencido",
  baixado: "Baixado",
};

const statusColors = {
  pendente: "bg-amber-100 text-amber-700",
  vencido: "bg-red-100 text-red-700",
  baixado: "bg-green-100 text-green-700",
};

export default function AccountList({ onBack }) {
  const [bills, setBills] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [statusFilter, setStatusFilter] = useState("todas");
  const [typeFilter, setTypeFilter] = useState("todas");
  const [methodFilter, setMethodFilter] = useState("todas");
  const [catFilter, setCatFilter] = useState("todas");

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

  const markAsPaid = async (bill) => {
    try {
      await api.entities.Bill.update(bill.id, {
        paid: true,
        paid_date: new Date().toISOString().split("T")[0],
      });
      toast.success("Conta baixada!");
      loadBills();
    } catch (e) {
      toast.error("Erro ao baixar conta.");
    }
  };

  const filteredBills = useMemo(() => {
    return bills.filter((b) => {
      if (search) {
        const q = search.toLowerCase();
        if (
          !b.description?.toLowerCase().includes(q) &&
          !b.supplier?.toLowerCase().includes(q) &&
          !b.category?.toLowerCase().includes(q)
        )
          return false;
      }
      if (dateFrom && b.due_date < dateFrom) return false;
      if (dateTo && b.due_date > dateTo) return false;
      if (typeFilter !== "todas" && b.type !== typeFilter) return false;
      if (catFilter !== "todas" && b.category !== catFilter) return false;
      if (methodFilter !== "todas" && b.payment_method !== methodFilter) return false;
      const status = getStatus(b);
      if (statusFilter !== "todas" && status !== statusFilter) return false;
      return true;
    });
  }, [bills, search, dateFrom, dateTo, statusFilter, typeFilter, methodFilter, catFilter]);

  const stats = useMemo(() => {
    const inRange = (b) => {
      if (dateFrom && b.due_date < dateFrom) return false;
      if (dateTo && b.due_date > dateTo) return false;
      return true;
    };

    const totalReceber = bills
      .filter((b) => b.type === "receber" && !b.paid)
      .reduce((s, b) => s + (b.amount || 0), 0);

    const periodBills = bills.filter(inRange);

    const pendente = periodBills
      .filter((b) => getStatus(b) === "pendente")
      .reduce((s, b) => s + (b.amount || 0), 0);

    const vencido = periodBills
      .filter((b) => getStatus(b) === "vencido")
      .reduce((s, b) => s + (b.amount || 0), 0);

    const baixado = periodBills
      .filter((b) => getStatus(b) === "baixado")
      .reduce((s, b) => s + (b.amount || 0), 0);

    return { totalReceber, pendente, vencido, baixado };
  }, [bills, dateFrom, dateTo]);

  const categories = [...new Set(bills.map((b) => b.category).filter(Boolean))];

  const statCards = [
    { label: "Total a Receber (Geral)", value: stats.totalReceber, color: "text-foreground" },
    { label: "Pendente (no período)", value: stats.pendente, color: "text-foreground" },
    { label: "Vencido (no período)", value: stats.vencido, color: "text-red-600" },
    { label: "Baixado (no período)", value: stats.baixado, color: "text-green-600" },
  ];

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
          <span className="font-semibold">Receber / Pagar Contas</span>
        </div>
      </div>

      <div className="bg-card rounded-xl border shadow-sm p-5 space-y-4">
        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar ou ler código de barras (Enter)..."
            className="pl-10 h-10"
          />
        </div>

        {/* Date filters */}
        <div className="flex items-center gap-2">
          <Input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="h-10 flex-1"
          />
          <span className="text-sm text-muted-foreground">a</span>
          <Input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="h-10 flex-1"
          />
        </div>

        {/* Dropdown filters */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todas">Todas</SelectItem>
              <SelectItem value="pendente">Pendentes</SelectItem>
              <SelectItem value="vencido">Vencidas</SelectItem>
              <SelectItem value="baixado">Baixadas</SelectItem>
            </SelectContent>
          </Select>
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todas">Todas</SelectItem>
              <SelectItem value="pagar">A Pagar</SelectItem>
              <SelectItem value="receber">A Receber</SelectItem>
            </SelectContent>
          </Select>
          <Select value={methodFilter} onValueChange={setMethodFilter}>
            <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todas">Todas formas</SelectItem>
              <SelectItem value="dinheiro">Dinheiro</SelectItem>
              <SelectItem value="pix">PIX</SelectItem>
              <SelectItem value="boleto">Boleto</SelectItem>
              <SelectItem value="cartao">Cartão</SelectItem>
            </SelectContent>
          </Select>
          <Select value={catFilter} onValueChange={setCatFilter}>
            <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todas">Todas categorias</SelectItem>
              {categories.map((c) => (
                <SelectItem key={c} value={c}>{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {statCards.map((card) => (
            <div key={card.label} className="rounded-lg border p-3 text-center">
              <p className="text-[10px] font-semibold tracking-wide text-muted-foreground uppercase mb-1">
                {card.label}
              </p>
              <p className={`text-sm font-bold ${card.color}`}>{formatBRL(card.value)}</p>
            </div>
          ))}
        </div>

        {/* List / Empty state */}
        {loading ? (
          <div className="flex justify-center py-12">
            <div className="w-6 h-6 border-4 border-muted border-t-primary rounded-full animate-spin" />
          </div>
        ) : filteredBills.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <FileText className="w-12 h-12 text-muted-foreground/30 mb-3" />
            <p className="text-sm text-muted-foreground">Nenhum lançamento encontrado</p>
          </div>
        ) : (
          <div className="space-y-2">
            {filteredBills.map((bill) => {
              const status = getStatus(bill);
              return (
                <div key={bill.id} className="flex items-center gap-3 p-3 rounded-lg border hover:bg-muted/30 transition-colors">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-sm font-medium truncate">
                        {bill.description || bill.category || "Sem descrição"}
                      </span>
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${statusColors[status]}`}>
                        {statusLabels[status]}
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {bill.type === "pagar" ? "A Pagar" : "A Receber"} • {bill.supplier || "—"} • Venc: {formatDate(bill.due_date)}
                    </div>
                  </div>
                  <span className="text-sm font-semibold shrink-0">{formatBRL(bill.amount)}</span>
                  {!bill.paid && (
                    <Button size="sm" variant="outline" className="h-8 gap-1 shrink-0" onClick={() => markAsPaid(bill)}>
                      <Check className="w-3.5 h-3.5" /> Baixar
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}