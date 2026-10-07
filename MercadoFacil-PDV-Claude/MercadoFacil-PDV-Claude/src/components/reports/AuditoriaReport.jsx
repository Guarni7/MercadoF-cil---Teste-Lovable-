import React, { useState, useEffect, useMemo } from "react";
import { api } from "@/api/dataClient";
import { Shield, Eraser, Trash2, Edit3, DollarSign } from "lucide-react";
import { Card } from "@/components/ui/card";
import { formatBRL, formatDateTime } from "@/lib/format";
import ReportShell from "./ReportShell";
import { reportLoadError } from "./reportError";
import { useReportFilters } from "./useReportFilters";

const filterTabs = [
  { v: "todos", l: "Todos" },
  { v: "limpeza", l: "Limpeza" },
  { v: "remocao", l: "Remoção" },
  { v: "alteracao", l: "Alteração Qtd" },
];

export default function AuditoriaReport({ onBack }) {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("todos");
  const filtros = useReportFilters();

  useEffect(() => {
    api.entities.ActivityLog
      .list("-created_date", 500)
      .then(setLogs)
      .catch(reportLoadError("a auditoria"))
      .finally(() => setLoading(false));
  }, []);

  const { noPeriodo, combina } = filtros;
  const noEscopo = useMemo(
    () =>
      logs.filter(
        (l) => noPeriodo(l.created_date) && combina(l.description, l.user_name, l.details),
      ),
    [logs, noPeriodo, combina],
  );

  const filtered = useMemo(() => {
    return noEscopo.filter((l) => {
      if (tab === "todos") return true;
      if (tab === "limpeza") return l.type === "estorno" || l.description?.toLowerCase().includes("limp");
      if (tab === "remocao") return l.type === "cancelamento_venda" || l.description?.toLowerCase().includes("remo");
      if (tab === "alteracao") return l.description?.toLowerCase().includes("qtd") || l.description?.toLowerCase().includes("alter");
      return true;
    });
  }, [noEscopo, tab]);

  const stats = useMemo(() => {
    const limpezas = noEscopo.filter((l) => l.type === "estorno" || l.description?.toLowerCase().includes("limp")).length;
    const remocoes = noEscopo.filter((l) => l.type === "cancelamento_venda" || l.description?.toLowerCase().includes("remo")).length;
    const alteracoes = noEscopo.filter((l) => l.description?.toLowerCase().includes("qtd") || l.description?.toLowerCase().includes("alter")).length;
    // Só o que está em auditoria: somar todo log (venda, sangria, abertura de
    // caixa) dava um "valor total" sem significado nenhum ao lado dos contadores.
    const valor = filtered.reduce((s, l) => s + (l.amount || 0), 0);
    return { limpezas, remocoes, alteracoes, valor };
  }, [noEscopo, filtered]);

  if (loading)
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <div className="w-8 h-8 border-4 border-muted border-t-primary rounded-full animate-spin" />
      </div>
    );

  return (
    <ReportShell
      title="Auditoria"
      icon={Shield}
      onBack={onBack}
      filters={filtros}
      searchPlaceholder="Buscar por descrição ou usuário..."
      showStatus={false}
    >
      <div className="mb-4">
        <span className="text-xs font-bold text-muted-foreground uppercase tracking-wide">Filtros</span>
        <div className="flex gap-2 mt-2 flex-wrap">
          {filterTabs.map((t) => (
            <button
              key={t.v}
              onClick={() => setTab(t.v)}
              className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
                tab === t.v
                  ? "bg-primary text-primary-foreground"
                  : "border text-foreground hover:bg-muted"
              }`}
            >
              {t.l}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <Card className="p-4 border-red-200 hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground uppercase">Limpezas</span>
            <Eraser className="w-4 h-4 text-red-600" />
          </div>
          <div className="text-xl font-bold text-red-700">{stats.limpezas}</div>
        </Card>
        <Card className="p-4 border-orange-200 hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground uppercase">Remoções</span>
            <Trash2 className="w-4 h-4 text-orange-500" />
          </div>
          <div className="text-xl font-bold text-orange-600">{stats.remocoes}</div>
        </Card>
        <Card className="p-4 border-blue-200 hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground uppercase">Alterações Qtd</span>
            <Edit3 className="w-4 h-4 text-blue-600" />
          </div>
          <div className="text-xl font-bold text-blue-700">{stats.alteracoes}</div>
        </Card>
        <Card className="p-4 hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground uppercase">Valor total</span>
            <DollarSign className="w-4 h-4 text-muted-foreground" />
          </div>
          <div className="text-xl font-bold">{formatBRL(stats.valor)}</div>
        </Card>
      </div>

      <Card className="p-12 text-center">
        {filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum registro no período</p>
        ) : (
          <div className="text-left space-y-2">
            {filtered.map((l) => (
              <div key={l.id} className="flex items-center justify-between p-3 border rounded-lg">
                <div>
                  <div className="text-sm font-medium">{l.description}</div>
                  <div className="text-xs text-muted-foreground">{formatDateTime(l.created_date)} · {l.user_name}</div>
                </div>
                {l.amount > 0 && <div className="text-sm font-semibold">{formatBRL(l.amount)}</div>}
              </div>
            ))}
          </div>
        )}
      </Card>
    </ReportShell>
  );
}