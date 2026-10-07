import React, { useState, useEffect, useMemo } from "react";
import { api } from "@/api/dataClient";
import { ArrowDownCircle, ArrowUpCircle, ArrowUpDown } from "lucide-react";
import { Card } from "@/components/ui/card";
import { formatBRL, formatDateTime } from "@/lib/format";
import ReportShell from "./ReportShell";
import KpiCard from "./KpiCard";
import { reportLoadError } from "./reportError";
import { useReportFilters } from "./useReportFilters";

export default function SangriasReport({ onBack }) {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const filtros = useReportFilters();

  useEffect(() => {
    api.entities.ActivityLog
      .list("-created_date", 500)
      .then(setLogs)
      .catch(reportLoadError("as sangrias e suprimentos"))
      .finally(() => setLoading(false));
  }, []);

  // O tipo é a fonte; a descrição é só fallback para registros antigos, que
  // eram todos gravados como "troco".
  const ehSangria = (l) =>
    l.type === "sangria" || (l.type === "troco" && l.description?.toLowerCase().includes("sangria"));
  const ehSuprimento = (l) =>
    l.type === "suprimento" ||
    (l.type === "troco" && l.description?.toLowerCase().includes("suprimento"));

  const { noPeriodo, combina } = filtros;
  const movimentacoes = useMemo(() => {
    return logs.filter(
      (l) =>
        (l.type === "discrepancia_caixa" || ehSangria(l) || ehSuprimento(l)) &&
        noPeriodo(l.created_date) &&
        combina(l.description, l.user_name, l.details),
    );
  }, [logs, noPeriodo, combina]);

  const stats = useMemo(() => {
    const valor = (l) => Math.abs(l.discrepancy || l.amount || 0);
    const saidas = movimentacoes.filter((l) => ehSangria(l) || l.discrepancy < 0);
    const entradas = movimentacoes.filter((l) => ehSuprimento(l) || l.discrepancy > 0);
    const sangrias = saidas.reduce((s, l) => s + valor(l), 0);
    const suprimentos = entradas.reduce((s, l) => s + valor(l), 0);
    return {
      sangrias,
      suprimentos,
      saldo: suprimentos - sangrias,
      opsSangria: saidas.length,
      opsSuprimento: entradas.length,
      ops: movimentacoes.length,
    };
  }, [movimentacoes]);

  if (loading)
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <div className="w-8 h-8 border-4 border-muted border-t-primary rounded-full animate-spin" />
      </div>
    );

  return (
    <ReportShell
      title="Sangrias"
      icon={ArrowUpDown}
      onBack={onBack}
      filters={filtros}
      searchPlaceholder="Buscar por motivo ou operador..."
      showStatus={false}
    >
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-6">
        <KpiCard label="Sangrias" value={formatBRL(stats.sangrias)} subtitle={`${stats.opsSangria} operações`} icon={ArrowDownCircle} colorClass="text-red-600" valueClass="text-red-600" />
        <KpiCard label="Suprimentos" value={formatBRL(stats.suprimentos)} subtitle={`${stats.opsSuprimento} operações`} icon={ArrowUpCircle} colorClass="text-emerald-600" valueClass="text-emerald-600" />
        <KpiCard label="Saldo" value={formatBRL(stats.saldo)} subtitle={`${stats.ops} total`} icon={ArrowUpDown} colorClass="text-emerald-600" valueClass="text-emerald-600" />
      </div>

      <Card className="p-4">
        <h2 className="font-heading font-semibold mb-4">Movimentações de Caixa</h2>
        {movimentacoes.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 border-2 border-dashed rounded-lg">
            <ArrowUpDown className="w-12 h-12 text-muted-foreground/30 mb-2" />
            <p className="text-sm text-muted-foreground">
              Nenhuma sangria ou suprimento encontrado no período
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {movimentacoes.map((l) => (
              <div key={l.id} className="flex items-center justify-between p-3 border rounded-lg">
                <div>
                  <div className="text-sm font-medium">{l.description}</div>
                  <div className="text-xs text-muted-foreground">{formatDateTime(l.created_date)} · {l.user_name}</div>
                </div>
                <div className={`text-sm font-semibold ${(l.discrepancy || l.amount || 0) < 0 ? "text-red-600" : "text-emerald-600"}`}>
                  {formatBRL(l.discrepancy || l.amount || 0)}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </ReportShell>
  );
}