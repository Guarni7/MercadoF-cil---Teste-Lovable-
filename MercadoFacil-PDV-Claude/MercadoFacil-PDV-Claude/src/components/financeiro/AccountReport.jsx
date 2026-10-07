import React, { useState, useEffect, useMemo } from "react";
import { ArrowLeft, FileText, TrendingUp, TrendingDown, Scale } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api } from "@/api/dataClient";
import { formatBRL } from "@/lib/format";

export default function AccountReport({ onBack }) {
  const [bills, setBills] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
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

  const filteredBills = useMemo(() => {
    return bills.filter((b) => {
      if (dateFrom && b.due_date < dateFrom) return false;
      if (dateTo && b.due_date > dateTo) return false;
      if (typeFilter !== "todas" && b.type !== typeFilter) return false;
      if (methodFilter !== "todas" && b.payment_method !== methodFilter) return false;
      if (catFilter !== "todas" && b.category !== catFilter) return false;
      return true;
    });
  }, [bills, dateFrom, dateTo, typeFilter, methodFilter, catFilter]);

  const metrics = useMemo(() => {
    const receitas = filteredBills
      .filter((b) => b.type === "receber" && b.paid)
      .reduce((s, b) => s + (b.amount || 0), 0);
    const despesas = filteredBills
      .filter((b) => b.type === "pagar" && b.paid)
      .reduce((s, b) => s + (b.amount || 0), 0);
    return { receitas, despesas, saldo: receitas - despesas };
  }, [filteredBills]);

  const categories = [...new Set(bills.map((b) => b.category).filter(Boolean))];

  const metricCards = [
    { label: "Receitas", value: metrics.receitas, color: "text-green-600", icon: TrendingUp },
    { label: "Despesas", value: metrics.despesas, color: "text-red-600", icon: TrendingDown },
    { label: "Saldo", value: metrics.saldo, color: metrics.saldo >= 0 ? "text-green-600" : "text-red-600", icon: Scale },
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
          <span className="font-semibold">Relatório</span>
        </div>
      </div>

      <div className="bg-card rounded-xl border shadow-sm p-5 space-y-4">
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
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todas">Todas</SelectItem>
              <SelectItem value="pagar">A Pagar</SelectItem>
              <SelectItem value="receber">A Receber</SelectItem>
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

        {/* Metric cards */}
        <div className="grid grid-cols-3 gap-3">
          {metricCards.map((card) => {
            const Icon = card.icon;
            return (
              <div key={card.label} className="rounded-lg border p-4 text-center">
                <div className="flex items-center justify-center mb-2">
                  <Icon className="w-5 h-5 text-muted-foreground" />
                </div>
                <p className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase mb-1">
                  {card.label}
                </p>
                <p className={`text-base font-bold ${card.color}`}>{formatBRL(card.value)}</p>
              </div>
            );
          })}
        </div>

        {/* Empty state */}
        {loading ? (
          <div className="flex justify-center py-12">
            <div className="w-6 h-6 border-4 border-muted border-t-primary rounded-full animate-spin" />
          </div>
        ) : filteredBills.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <FileText className="w-12 h-12 text-muted-foreground/30 mb-3" />
            <p className="text-sm text-muted-foreground">Nenhuma conta no período</p>
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
                    {bill.type === "pagar" ? "Despesa" : "Receita"} • {bill.supplier || "—"}
                  </div>
                </div>
                <span className={`text-sm font-semibold shrink-0 ${bill.type === "receber" ? "text-green-600" : "text-red-600"}`}>
                  {bill.type === "receber" ? "+" : "-"}{formatBRL(bill.amount)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}