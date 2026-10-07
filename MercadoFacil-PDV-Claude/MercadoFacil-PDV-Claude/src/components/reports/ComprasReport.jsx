import React, { useState, useEffect, useMemo } from "react";
import { api } from "@/api/dataClient";
import { ShoppingBag, FileText, FileCheck, BarChart3, Search } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatBRL, formatDate } from "@/lib/format";
import ReportShell from "./ReportShell";
import KpiCard from "./KpiCard";
import { reportLoadError } from "./reportError";
import { useReportFilters } from "./useReportFilters";

export default function ComprasReport({ onBack }) {
  const [bills, setBills] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [fonte, setFonte] = useState("todas");
  // Compra e despesa fixa moram na mesma tabela; sem recortar por categoria o
  // "total de compras" somava aluguel e energia.
  const [categoria, setCategoria] = useState("Compras");
  const filtros = useReportFilters("todas");

  useEffect(() => {
    api.entities.Bill
      .filter({ type: "pagar" }, "-created_date", 500)
      .then(setBills)
      .catch(reportLoadError("as compras"))
      .finally(() => setLoading(false));
  }, []);

  const categorias = useMemo(() => {
    const nomes = new Set(bills.map((b) => b.category).filter(Boolean));
    return [...nomes].sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [bills]);

  const { noPeriodo, status } = filtros;
  const filtered = useMemo(() => {
    const termo = search.trim().toLowerCase();
    return bills.filter((b) => {
      if (status === "ativas" && b.paid) return false;
      if (categoria !== "todas" && (b.category || "Sem categoria") !== categoria) return false;
      if (fonte !== "todas" && (b.source || "manual") !== fonte) return false;
      if (!noPeriodo(b.issue_date || b.due_date || b.created_date)) return false;
      if (!termo) return true;
      return [b.supplier, b.description, b.document_number, b.access_key].some((c) =>
        String(c || "").toLowerCase().includes(termo),
      );
    });
  }, [bills, search, fonte, categoria, status, noPeriodo]);

  const stats = useMemo(() => {
    const total = filtered.reduce((s, b) => s + (b.amount || 0), 0);
    const ticket = filtered.length ? total / filtered.length : 0;
    // Antes eram zeros fixos no código — os cartões mostravam 0 mesmo com notas
    // importadas. Agora saem da origem gravada em cada conta.
    const xml = filtered.filter((b) => b.source === "xml").length;
    const manual = filtered.filter((b) => (b.source || "manual") === "manual").length;
    return { total, notas: filtered.length, xml, manual, ticket };
  }, [filtered]);

  if (loading)
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <div className="w-8 h-8 border-4 border-muted border-t-primary rounded-full animate-spin" />
      </div>
    );

  return (
    <ReportShell
      title="Compras"
      icon={ShoppingBag}
      onBack={onBack}
      filters={filtros}
      showSearch={false}
      statusLabels={{ ativas: "Em aberto", todas: "Todas" }}
    >
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <KpiCard label="Total Compras" value={formatBRL(stats.total)} subtitle={`${stats.notas} nota(s)`} icon={ShoppingBag} colorClass="text-orange-500" valueClass="text-orange-500" />
        <KpiCard label="XML Importados" value={String(stats.xml)} icon={FileText} colorClass="text-blue-600" valueClass="text-blue-600" />
        <KpiCard label="Lançadas à mão" value={String(stats.manual)} icon={FileCheck} colorClass="text-emerald-600" valueClass="text-emerald-600" />
        <KpiCard label="Ticket Médio" value={formatBRL(stats.ticket)} icon={BarChart3} colorClass="text-muted-foreground" />
      </div>

      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Filtrar por fornecedor, CNPJ, número ou chave..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Select value={categoria} onValueChange={setCategoria}>
          <SelectTrigger className="w-[190px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="todas">Todas as categorias</SelectItem>
            {!categorias.includes("Compras") && (
              <SelectItem value="Compras">Compras</SelectItem>
            )}
            {categorias.map((c) => (
              <SelectItem key={c} value={c}>{c}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={fonte} onValueChange={setFonte}>
          <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="todas">Todas as fontes</SelectItem>
            <SelectItem value="xml">XML importado</SelectItem>
            <SelectItem value="manual">Lançamento manual</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card className="p-4">
        {filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">
            Nenhuma nota de compra encontrada no período
            {categoria !== "todas" && ` na categoria "${categoria}" — troque o filtro de categoria para ver os demais lançamentos`}
          </p>
        ) : (
          <div className="text-left space-y-2">
            {filtered.map((b) => (
              <div key={b.id} className="flex items-center justify-between p-3 border rounded-lg">
                <div>
                  <div className="text-sm font-medium">{b.supplier || b.description || "—"}</div>
                  <div className="text-xs text-muted-foreground">
                    {b.source === "xml" ? `NF-e ${b.document_number || "s/nº"} · ` : ""}
                    {formatDate(b.issue_date || b.due_date || b.created_date)}
                    {b.paid ? " · baixada" : " · em aberto"}
                  </div>
                </div>
                <div className="text-sm font-semibold">{formatBRL(b.amount || 0)}</div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </ReportShell>
  );
}