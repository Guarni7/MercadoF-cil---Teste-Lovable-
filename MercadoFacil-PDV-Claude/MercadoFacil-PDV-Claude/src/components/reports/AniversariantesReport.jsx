import React, { useState, useEffect, useMemo } from "react";
import { api } from "@/api/dataClient";
import { Cake, Gift, TrendingUp, FileSpreadsheet, FileText, Search } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatBRL } from "@/lib/format";
import { toast } from "sonner";
import ReportShell from "./ReportShell";
import { reportLoadError } from "./reportError";

const months = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

export default function AniversariantesReport({ onBack }) {
  const [customers, setCustomers] = useState([]);
  const [sales, setSales] = useState([]);
  const [loading, setLoading] = useState(true);
  const [monthFilter, setMonthFilter] = useState("todos");
  const [search, setSearch] = useState("");

  useEffect(() => {
    Promise.all([
      api.entities.Customer.list("name", 500),
      api.entities.Sale.list("-created_date", 500),
    ])
      .then(([c, s]) => {
        setCustomers(c);
        setSales(s);
      })
      .catch(reportLoadError("os aniversariantes"))
      .finally(() => setLoading(false));
  }, []);

  const withBirthday = useMemo(() => {
    return customers.filter((c) => c.birthday);
  }, [customers]);

  const today = new Date();
  const todayMonth = today.getMonth() + 1;
  const todayDay = today.getDate();

  const hoje = withBirthday.filter((c) => {
    const d = new Date(c.birthday + "T00:00:00");
    return d.getDate() === todayDay && d.getMonth() + 1 === todayMonth;
  });

  const filtered = useMemo(() => {
    return withBirthday.filter((c) => {
      const d = new Date(c.birthday + "T00:00:00");
      const m = d.getMonth() + 1;
      const matchMonth = monthFilter === "todos" || String(m) === monthFilter;
      const matchSearch = !search || c.name?.toLowerCase().includes(search.toLowerCase());
      return matchMonth && matchSearch;
    });
  }, [withBirthday, monthFilter, search]);

  const totalCompras = useMemo(() => {
    const ids = new Set(filtered.map((c) => c.id));
    return sales
      .filter((s) => s.status === "concluida" && s.customer_id && ids.has(s.customer_id))
      .reduce((sum, s) => sum + s.total, 0);
  }, [filtered, sales]);

  const exportXLSX = () => {
    const headers = ["Nome", "WhatsApp", "Nascimento", "Total Compras"];
    const rows = filtered.map((c) => {
      const total = sales
        .filter((s) => s.customer_id === c.id && s.status === "concluida")
        .reduce((sum, s) => sum + s.total, 0);
      return [c.name || "", c.phone || "", c.birthday || "", formatBRL(total)];
    });
    const csv = [headers, ...rows].map((r) => r.map((v) => `"${v}"`).join(";")).join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "aniversariantes.csv";
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Exportado!");
  };

  if (loading)
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <div className="w-8 h-8 border-4 border-muted border-t-primary rounded-full animate-spin" />
      </div>
    );

  return (
    <ReportShell
      title="Aniversariantes"
      icon={Cake}
      iconColor="text-pink-500"
      onBack={onBack}
      showDateRange={false}
      rightActions={
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="gap-2" onClick={exportXLSX}>
            <FileSpreadsheet className="w-4 h-4" /> XLSX
          </Button>
          <Button variant="outline" size="sm" className="gap-2" onClick={() => toast.info("PDF em breve")}>
            <FileText className="w-4 h-4" /> PDF
          </Button>
        </div>
      }
    >
      <p className="text-sm text-muted-foreground mb-4">{filtered.length} cliente(s)</p>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-6">
        <Card className="p-4 flex flex-col gap-1 hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground uppercase">Hoje</span>
            <Gift className="w-4 h-4 text-pink-500" />
          </div>
          <div className="text-xl font-bold">{hoje.length}</div>
        </Card>
        <Card className="p-4 flex flex-col gap-1 hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground uppercase">No filtro</span>
            <Cake className="w-4 h-4 text-purple-500" />
          </div>
          <div className="text-xl font-bold">{filtered.length}</div>
        </Card>
        <Card className="p-4 flex flex-col gap-1 hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground uppercase">Total compras</span>
            <TrendingUp className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="text-xl font-bold">{formatBRL(totalCompras)}</div>
        </Card>
      </div>

      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <Select value={monthFilter} onValueChange={setMonthFilter}>
          <SelectTrigger className="w-[140px]"><SelectValue placeholder="Por mês" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos os meses</SelectItem>
            {months.map((m, i) => (
              <SelectItem key={i} value={String(i + 1)}>{m}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="relative flex-1 min-w-[200px]">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Buscar..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
      </div>

      <Card className="p-6">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 border-2 border-dashed rounded-lg">
            <Cake className="w-12 h-12 text-muted-foreground/30 mb-3" />
            <p className="text-sm text-muted-foreground font-medium">Nenhum aniversariante encontrado</p>
            <p className="text-xs text-muted-foreground/70 mt-1">Cadastre a data de nascimento dos clientes</p>
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map((c) => {
              const d = new Date(c.birthday + "T00:00:00");
              const total = sales
                .filter((s) => s.customer_id === c.id && s.status === "concluida")
                .reduce((sum, s) => sum + s.total, 0);
              return (
                <div key={c.id} className="flex items-center justify-between p-3 border rounded-lg">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-pink-50 flex items-center justify-center">
                      <Cake className="w-5 h-5 text-pink-500" />
                    </div>
                    <div>
                      <div className="text-sm font-medium">{c.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {d.getDate().toString().padStart(2, "0")} de {months[d.getMonth()]}
                      </div>
                    </div>
                  </div>
                  <div className="text-sm font-semibold">{formatBRL(total)}</div>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </ReportShell>
  );
}