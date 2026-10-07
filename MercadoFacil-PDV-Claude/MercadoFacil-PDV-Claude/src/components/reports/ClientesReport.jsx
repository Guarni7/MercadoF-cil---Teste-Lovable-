import React, { useState, useEffect, useMemo } from "react";
import { api } from "@/api/dataClient";
import { Users, BarChart3 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { formatBRL } from "@/lib/format";
import ReportShell from "./ReportShell";
import KpiCard from "./KpiCard";
import { reportLoadError } from "./reportError";
import { useReportFilters } from "./useReportFilters";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export default function ClientesReport({ onBack }) {
  const [customers, setCustomers] = useState([]);
  const [sales, setSales] = useState([]);
  const [loading, setLoading] = useState(true);
  const filtros = useReportFilters();

  useEffect(() => {
    Promise.all([
      api.entities.Customer.list("name", 500),
      api.entities.Sale.list("-created_date", 500),
    ])
      .then(([c, s]) => {
        setCustomers(c);
        setSales(s);
      })
      .catch(reportLoadError("os clientes"))
      .finally(() => setLoading(false));
  }, []);

  const { noPeriodo, combina, status } = filtros;

  const clientesVisiveis = useMemo(
    () => customers.filter((c) => status === "todas" || c.active !== false),
    [customers, status],
  );

  const vendasNoPeriodo = useMemo(
    () =>
      sales.filter((s) => s.status === "concluida" && noPeriodo(s.created_date)),
    [sales, noPeriodo],
  );

  // Venda de balcão não tem cliente; deixá-la no ranking colocava "Consumidor"
  // em primeiro lugar e escondia quem realmente compra na loja.
  const { ranking, semCliente } = useMemo(() => {
    const map = {};
    const anonimo = { total: 0, count: 0 };
    vendasNoPeriodo.forEach((s) => {
      const key = s.customer_id || s.customer_name;
      if (!key) {
        anonimo.total += s.total;
        anonimo.count++;
        return;
      }
      if (!map[key]) map[key] = { name: s.customer_name || "Cliente", total: 0, count: 0 };
      map[key].total += s.total;
      map[key].count++;
    });
    return {
      ranking: Object.values(map)
        .filter((c) => combina(c.name))
        .sort((a, b) => b.total - a.total),
      semCliente: anonimo,
    };
  }, [vendasNoPeriodo, combina]);

  const ticketMedio = useMemo(() => {
    return vendasNoPeriodo.length
      ? vendasNoPeriodo.reduce((s, v) => s + v.total, 0) / vendasNoPeriodo.length
      : 0;
  }, [vendasNoPeriodo]);

  if (loading)
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <div className="w-8 h-8 border-4 border-muted border-t-primary rounded-full animate-spin" />
      </div>
    );

  return (
    <ReportShell
      title="Clientes"
      icon={Users}
      onBack={onBack}
      filters={filtros}
      searchPlaceholder="Buscar cliente..."
      statusLabels={{ ativas: "Ativos", todas: "Todos" }}
    >
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-6">
        <KpiCard label="Clientes" value={String(clientesVisiveis.length)} icon={Users} colorClass="text-emerald-600" valueClass="text-emerald-700" />
        <KpiCard label="Ticket Médio" value={formatBRL(ticketMedio)} icon={BarChart3} colorClass="text-emerald-600" valueClass="text-emerald-700" />
      </div>

      <Card className="overflow-hidden">
        <div className="p-4 border-b">
          <h2 className="font-heading font-semibold">Ranking de Clientes</h2>
        </div>
        {ranking.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-12">
            Nenhuma compra de cliente identificado no período
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead className="text-xs uppercase">#</TableHead>
                <TableHead className="text-xs uppercase">Cliente</TableHead>
                <TableHead className="text-xs uppercase text-right">Compras</TableHead>
                <TableHead className="text-xs uppercase text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ranking.map((c, i) => (
                <TableRow key={i}>
                  <TableCell className="text-sm text-muted-foreground">{i + 1}</TableCell>
                  <TableCell className="font-medium text-sm">{c.name}</TableCell>
                  <TableCell className="text-sm text-right">{c.count}</TableCell>
                  <TableCell className="text-sm font-semibold text-right text-emerald-600">{formatBRL(c.total)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {semCliente.count > 0 && (
          <div className="flex justify-between items-center px-4 py-3 border-t bg-muted/30 text-sm">
            <span className="text-muted-foreground">
              Vendas sem cliente identificado ({semCliente.count})
            </span>
            <span className="font-medium">{formatBRL(semCliente.total)}</span>
          </div>
        )}
      </Card>
    </ReportShell>
  );
}