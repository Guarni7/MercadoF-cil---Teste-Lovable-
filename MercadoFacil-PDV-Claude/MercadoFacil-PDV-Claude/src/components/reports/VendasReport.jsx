import React, { useState, useEffect, useMemo } from "react";
import { api } from "@/api/dataClient";
import { ShoppingCart, DollarSign, BarChart3, Tag } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatBRL, formatDateTime } from "@/lib/format";
import { saleNumberLabel } from "@/lib/saleNumber";
import ReportShell from "./ReportShell";
import KpiCard from "./KpiCard";
import { reportLoadError } from "./reportError";
import { useReportFilters } from "./useReportFilters";
import { exportarCSV, exportarXLSX, exportarPDF } from "@/lib/exportTable";

const methodLabels = {
  dinheiro: "Dinheiro",
  pix: "PIX",
  credito: "Crédito",
  debito: "Débito",
  crediario: "Crediário",
};

export default function VendasReport({ onBack }) {
  const [sales, setSales] = useState([]);
  const [registers, setRegisters] = useState([]);
  const [loading, setLoading] = useState(true);
  const [payMethod, setPayMethod] = useState("todas");
  const [caixa, setCaixa] = useState("todos");
  const [mostrarItens, setMostrarItens] = useState(false);
  const filtros = useReportFilters();

  useEffect(() => {
    Promise.all([
      api.entities.Sale.list("-created_date", 500),
      api.entities.CashRegister.list("-created_date", 100),
    ])
      .then(([vendas, caixas]) => {
        setSales(vendas);
        setRegisters(caixas);
      })
      .catch(reportLoadError("as vendas"))
      .finally(() => setLoading(false));
  }, []);

  const { noPeriodo, combina, status } = filtros;
  const filtered = useMemo(() => {
    return sales.filter((s) => {
      if (status === "ativas" && s.status !== "concluida") return false;
      if (payMethod !== "todas" && s.payment_method !== payMethod) return false;
      if (caixa !== "todos" && s.cash_register_id !== caixa) return false;
      if (!noPeriodo(s.created_date)) return false;
      return combina(
        s.customer_name,
        s.number,
        s.created_by_name,
        s.items?.map((i) => i.name).join(" "),
      );
    });
  }, [sales, status, payMethod, caixa, noPeriodo, combina]);

  const stats = useMemo(() => {
    const valid = filtered.filter((s) => s.status === "concluida");
    const totalGeral = valid.reduce((sum, s) => sum + s.total, 0);
    const itens = valid.reduce(
      (sum, s) => sum + (s.items?.reduce((q, i) => q + (i.quantity || 0), 0) || 0),
      0
    );
    const ticket = valid.length ? totalGeral / valid.length : 0;
    const descontos = valid.reduce((sum, s) => sum + (s.discount || 0), 0);
    return { totalVendas: valid.length, totalGeral, ticket, itens, descontos };
  }, [filtered]);

  const colunas = ["Venda", "Data/Hora", "Cliente", "Vendedor", "Pagamento", "Desconto", "Total"];
  const linhas = () =>
    filtered.flatMap((s) => {
      const linha = [
        saleNumberLabel(s),
        formatDateTime(s.created_date),
        s.customer_name || "Consumidor",
        s.created_by_name || "—",
        methodLabels[s.payment_method] || s.payment_method || "—",
        formatBRL(s.discount || 0),
        formatBRL(s.total),
      ];
      if (!mostrarItens) return [linha];
      const itens = (s.items || []).map((i) => [
        "",
        "",
        `   ${i.quantity}x ${i.name}`,
        "",
        "",
        "",
        formatBRL(i.total || 0),
      ]);
      return [linha, ...itens];
    });
  const exportar = { nome: "vendas", titulo: "Relatório de Vendas", colunas };

  if (loading)
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <div className="w-8 h-8 border-4 border-muted border-t-primary rounded-full animate-spin" />
      </div>
    );

  return (
    <ReportShell
      title="Vendas"
      icon={ShoppingCart}
      onBack={onBack}
      filters={filtros}
      searchPlaceholder="Cliente, produto, vendedor ou nº da venda"
      statusLabels={{ ativas: "Concluídas", todas: "Todas" }}
    >
      <div className="flex flex-wrap gap-2 mb-4 p-3 rounded-lg bg-muted/40 border">
        <Select value={payMethod} onValueChange={setPayMethod}>
          <SelectTrigger className="w-[160px]"><SelectValue placeholder="Forma Pagamento" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="todas">Todas</SelectItem>
            <SelectItem value="dinheiro">Dinheiro</SelectItem>
            <SelectItem value="pix">PIX</SelectItem>
            <SelectItem value="credito">Crédito</SelectItem>
            <SelectItem value="debito">Débito</SelectItem>
            <SelectItem value="crediario">Crediário</SelectItem>
          </SelectContent>
        </Select>
        <Select value={caixa} onValueChange={setCaixa}>
          <SelectTrigger className="w-[220px]"><SelectValue placeholder="Caixa" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos os Caixas</SelectItem>
            {registers.map((r) => (
              <SelectItem key={r.id} value={r.id}>
                {formatDateTime(r.opened_at || r.created_date)}
                {r.status === "aberto" ? " (aberto)" : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 mb-6">
        <KpiCard label="Total Vendas" value={String(stats.totalVendas)} icon={ShoppingCart} colorClass="text-emerald-600" bgClass="bg-emerald-50" />
        <KpiCard label="Total Geral" value={formatBRL(stats.totalGeral)} icon={DollarSign} colorClass="text-blue-600" bgClass="bg-blue-50" />
        <KpiCard label="Ticket Médio" value={formatBRL(stats.ticket)} icon={BarChart3} colorClass="text-pink-600" bgClass="bg-pink-50" />
        <KpiCard label="Itens Vendidos" value={String(stats.itens)} icon={ShoppingCart} colorClass="text-amber-600" bgClass="bg-amber-50" />
        <KpiCard label="Descontos" value={formatBRL(stats.descontos)} icon={Tag} colorClass="text-orange-500" valueClass="text-orange-500" bgClass="bg-orange-50" />
      </div>

      <Card className="overflow-hidden">
        <div className="flex items-center justify-between p-4 border-b">
          <div>
            <h2 className="font-heading font-semibold">Detalhamento das Vendas</h2>
            <span className="text-xs text-muted-foreground">Registros: {filtered.length}</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium">Total: {formatBRL(stats.totalGeral)}</span>
            <div className="flex items-center gap-1.5">
              <Switch id="itens" checked={mostrarItens} onCheckedChange={setMostrarItens} />
              <label htmlFor="itens" className="text-xs text-muted-foreground">Itens</label>
            </div>
            <button
              className="px-2 py-1 text-xs border rounded-md hover:bg-muted"
              onClick={() => exportarCSV({ ...exportar, linhas: linhas() })}
            >
              CSV
            </button>
            <button
              className="px-2 py-1 text-xs border rounded-md hover:bg-muted"
              onClick={() => exportarXLSX({ ...exportar, linhas: linhas() })}
            >
              XLSX
            </button>
            <button
              className="px-2 py-1 text-xs border rounded-md hover:bg-muted"
              onClick={() => exportarPDF({ ...exportar, linhas: linhas() })}
            >
              PDF
            </button>
          </div>
        </div>
        {filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-12">
            Nenhuma venda encontrada no período selecionado
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead className="text-xs uppercase">Venda</TableHead>
                <TableHead className="text-xs uppercase">Vendedor</TableHead>
                <TableHead className="text-xs uppercase">Data/Hora</TableHead>
                <TableHead className="text-xs uppercase">Cliente</TableHead>
                <TableHead className="text-xs uppercase">Pagamento</TableHead>
                <TableHead className="text-xs uppercase text-right">Desconto</TableHead>
                <TableHead className="text-xs uppercase text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((s) => (
                <React.Fragment key={s.id}>
                  <TableRow>
                    <TableCell className="font-medium">{saleNumberLabel(s)}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{s.created_by_name || "—"}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{formatDateTime(s.created_date)}</TableCell>
                    <TableCell className="text-sm">{s.customer_name || "Consumidor"}</TableCell>
                    <TableCell className="text-sm">{methodLabels[s.payment_method] || s.payment_method}</TableCell>
                    <TableCell className="text-sm text-right text-orange-500">{formatBRL(s.discount || 0)}</TableCell>
                    <TableCell className="text-sm font-semibold text-right">{formatBRL(s.total)}</TableCell>
                  </TableRow>
                  {mostrarItens &&
                    (s.items || []).map((i, idx) => (
                      <TableRow key={`${s.id}_${idx}`} className="bg-muted/30">
                        <TableCell />
                        <TableCell colSpan={4} className="text-xs text-muted-foreground pl-6">
                          {i.quantity}x {i.name}
                        </TableCell>
                        <TableCell />
                        <TableCell className="text-xs text-right">{formatBRL(i.total || 0)}</TableCell>
                      </TableRow>
                    ))}
                </React.Fragment>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </ReportShell>
  );
}