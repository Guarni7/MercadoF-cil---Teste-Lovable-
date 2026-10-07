import React, { useState, useEffect, useMemo, useRef } from "react";
import { api } from "@/api/dataClient";
import { Building2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatBRL, formatDateTime } from "@/lib/format";
import { resumoDoCaixa } from "@/lib/cashClose";
import { carregarVendasDasSessoes } from "@/lib/cashCloseData";
import ReportShell from "./ReportShell";
import KpiCard from "./KpiCard";
import { reportLoadError } from "./reportError";
import { useReportFilters } from "./useReportFilters";

export default function CaixaReport({ onBack }) {
  const [registers, setRegisters] = useState([]);
  const [loading, setLoading] = useState(true);
  const filtros = useReportFilters("todas");
  // Dinheiro esperado por sessão (mesma regra do Fechar Caixa: resumoDoCaixa). Enquanto carrega
  // ou se falhar, a tela não mostra valor — nunca um número calculado pela conta antiga.
  const [esperados, setEsperados] = useState({ estado: "carregando", porId: {} });
  const [tentativa, setTentativa] = useState(0);
  const calculados = useRef(new Map()); // id → dinheiro esperado já calculado (evita refazer ao mudar filtro)

  useEffect(() => {
    api.entities.CashRegister
      .list("-opened_at", 200)
      .then(setRegisters)
      .catch(reportLoadError("o relatório de caixa"))
      .finally(() => setLoading(false));
  }, []);

  const { noPeriodo, combina, status } = filtros;
  const sessoes = useMemo(
    () =>
      registers.filter(
        (r) =>
          (status === "todas" || r.status === "aberto") &&
          noPeriodo(r.opened_at || r.created_date) &&
          combina(r.opened_by_name, r.closed_by_name),
      ),
    [registers, status, noPeriodo, combina],
  );

  // Vendas só das sessões visíveis, em lote; sessão já calculada não é buscada de novo.
  const chaveIds = sessoes.map((r) => r.id).join(",");
  useEffect(() => {
    const faltam = sessoes.filter((r) => !calculados.current.has(r.id));
    const montar = () => Object.fromEntries(sessoes.map((r) => [r.id, calculados.current.get(r.id)]));
    if (faltam.length === 0) {
      setEsperados({ estado: "ok", porId: montar() });
      return undefined;
    }
    let vivo = true;
    setEsperados({ estado: "carregando", porId: {} });
    carregarVendasDasSessoes(faltam.map((r) => r.id))
      .then((porCaixa) => {
        for (const r of faltam) calculados.current.set(r.id, resumoDoCaixa(r, porCaixa.get(String(r.id)) || []).expectedInDrawer);
        if (vivo) setEsperados({ estado: "ok", porId: montar() });
      })
      .catch((e) => {
        console.error("Falha ao calcular o dinheiro esperado das sessões:", e);
        if (vivo) setEsperados({ estado: "erro", porId: {} });
      });
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chaveIds, tentativa]);

  const totais = useMemo(() => {
    const soma = (campo) => sessoes.reduce((s, r) => s + (r[campo] || 0), 0);
    return {
      vendas: soma("sales_total"),
      suprimentos: soma("supplies_total"),
      sangrias: soma("withdrawals_total"),
    };
  }, [sessoes]);

  if (loading)
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <div className="w-8 h-8 border-4 border-muted border-t-primary rounded-full animate-spin" />
      </div>
    );

  return (
    <ReportShell
      title="Caixa"
      icon={Building2}
      onBack={onBack}
      filters={filtros}
      searchPlaceholder="Buscar por operador..."
      statusLabels={{ ativas: "Abertos", todas: "Todos" }}
    >
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <KpiCard label="Sessões" value={String(sessoes.length)} icon={Building2} colorClass="text-muted-foreground" />
        <KpiCard label="Vendas" value={formatBRL(totais.vendas)} colorClass="text-blue-600" valueClass="text-blue-600" />
        <KpiCard label="Suprimentos" value={formatBRL(totais.suprimentos)} colorClass="text-emerald-600" valueClass="text-emerald-600" />
        <KpiCard label="Sangrias" value={formatBRL(totais.sangrias)} colorClass="text-red-600" valueClass="text-red-600" />
      </div>

      <Card className="p-4">
        {sessoes.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-12">
            <Building2 className="w-14 h-14 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">
              Nenhuma sessão de caixa encontrada no período
            </p>
          </div>
        ) : (
          <div className="text-left space-y-2">
            {esperados.estado === "erro" && (
              <div className="text-xs text-red-600">
                Não foi possível calcular o dinheiro esperado das sessões.{" "}
                <button className="underline" onClick={() => setTentativa((n) => n + 1)}>Tentar de novo</button>
              </div>
            )}
            {sessoes.map((r) => {
              const esperado = esperados.estado === "ok" ? esperados.porId[r.id] : undefined;
              return (
                <div key={r.id} className="flex items-center justify-between p-3 border rounded-lg">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">{formatDateTime(r.opened_at)}</span>
                      <Badge variant={r.status === "aberto" ? "default" : "secondary"}>
                        {r.status === "aberto" ? "Aberto" : "Fechado"}
                      </Badge>
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {r.opened_by_name || "—"} · {r.sales_count || 0} vendas · abertura{" "}
                      {formatBRL(r.opening_balance || 0)}
                      {(r.supplies_total || 0) > 0 && ` · +${formatBRL(r.supplies_total)} supr.`}
                      {(r.withdrawals_total || 0) > 0 && ` · −${formatBRL(r.withdrawals_total)} sangria`}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-semibold">{formatBRL(r.sales_total || 0)}</div>
                    <div className="text-xs text-muted-foreground">
                      {r.status === "aberto" ? "dinheiro esperado em caixa" : "dinheiro esperado no fecho"}:{" "}
                      {esperado === undefined ? (esperados.estado === "erro" ? "—" : "…") : formatBRL(esperado)}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </ReportShell>
  );
}
