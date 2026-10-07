import React, { useState, useEffect } from "react";
import { api } from "@/api/dataClient";
import { loadCashRegisters } from "@/lib/dataLayer";
import { resumoDoCaixa } from "@/lib/cashClose";
import { carregarDadosDoCaixa } from "@/lib/cashCloseData";
import { Wallet, ArrowUpCircle, ArrowDownCircle, Clock, User, ShieldAlert, ArrowDownToLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatBRL, formatDateTime } from "@/lib/format";
import CashDialog from "@/components/cash/CashDialog";
import SangriaDialog from "@/components/cash/SangriaDialog";

export default function CashRegister() {
  const [registers, setRegisters] = useState([]);
  const [currentRegister, setCurrentRegister] = useState(null);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState("open");
  const [closingReg, setClosingReg] = useState(null);
  const [sangriaOpen, setSangriaOpen] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  // Dinheiro esperado em caixa do caixa aberto: { estado: "carregando" | "ok" | "erro", resumo }
  const [saldo, setSaldo] = useState({ estado: "carregando", resumo: null });
  const [tentativaSaldo, setTentativaSaldo] = useState(0);

  useEffect(() => {
    api.auth.me().then((u) => setIsAdmin(u?.role === "admin")).catch(() => {});
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const data = await loadCashRegisters(50);
      setRegisters(data);
      setCurrentRegister(data.find((r) => r.status === "aberto") || null);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  // Mesma regra do Fechar Caixa (resumoDoCaixa): recalcula sempre que o caixa é recarregado
  // (abrir, sangria, fechamento) ou quando o operador pede de novo depois de um erro.
  useEffect(() => {
    if (!currentRegister) return undefined;
    let vivo = true;
    setSaldo({ estado: "carregando", resumo: null });
    carregarDadosDoCaixa(currentRegister)
      .then(({ sales, caixa }) => vivo && setSaldo({ estado: "ok", resumo: resumoDoCaixa(caixa, sales) }))
      .catch((e) => {
        console.error("Falha ao calcular o dinheiro esperado em caixa:", e);
        if (vivo) setSaldo({ estado: "erro", resumo: null });
      });
    return () => { vivo = false; };
  }, [currentRegister, tentativaSaldo]);

  const openDialog = (mode) => {
    setDialogMode(mode);
    setClosingReg(null);
    setDialogOpen(true);
  };

  const forceClose = (reg) => {
    setClosingReg(reg);
    setDialogMode("close");
    setDialogOpen(true);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="w-8 h-8 border-4 border-muted border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-4 lg:p-8">
      <div className="mb-6">
        <h1 className="text-2xl lg:text-3xl font-heading font-bold">Fluxo de Caixa</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Gestão de abertura e fechamento
        </p>
      </div>

      <Card className="p-6 mb-6">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-4">
            <div
              className={`w-14 h-14 rounded-xl flex items-center justify-center ${
                currentRegister ? "bg-emerald-50" : "bg-muted"
              }`}
            >
              <Wallet
                className={`w-7 h-7 ${
                  currentRegister ? "text-emerald-600" : "text-muted-foreground"
                }`}
              />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-heading font-bold">
                  {currentRegister ? "Caixa Aberto" : "Caixa Fechado"}
                </h2>
                <Badge
                  variant={currentRegister ? "default" : "secondary"}
                  className={currentRegister ? "bg-emerald-600" : ""}
                >
                  {currentRegister ? "Ativo" : "Inativo"}
                </Badge>
              </div>
              {currentRegister && (
                <p className="text-sm text-muted-foreground">
                  Aberto em {formatDateTime(currentRegister.opened_at)}
                </p>
              )}
            </div>
          </div>
          {currentRegister ? (
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                onClick={() => setSangriaOpen(true)}
                className="gap-2"
              >
                <ArrowDownToLine className="w-4 h-4" /> Sangria
              </Button>
              <Button
                variant="destructive"
                onClick={() => openDialog("close")}
                className="gap-2"
              >
                <ArrowDownCircle className="w-4 h-4" /> Fechar Caixa
              </Button>
            </div>
          ) : (
            <Button onClick={() => openDialog("open")} className="gap-2">
              <ArrowUpCircle className="w-4 h-4" /> Abrir Caixa
            </Button>
          )}
        </div>

        {currentRegister && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-6 pt-6 border-t">
            <div>
              <div className="text-xs text-muted-foreground">Abertura</div>
              <div className="text-lg font-bold">
                {formatBRL(currentRegister.opening_balance)}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Vendas</div>
              <div className="text-lg font-bold">
                {formatBRL(currentRegister.sales_total)}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Qtd. Vendas</div>
              <div className="text-lg font-bold">{currentRegister.sales_count}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Dinheiro esperado em caixa</div>
              <div className="text-lg font-bold text-primary">
                {saldo.estado === "ok" ? formatBRL(saldo.resumo.expectedInDrawer) : saldo.estado === "erro" ? "—" : "…"}
              </div>
              {saldo.estado === "erro" && (
                <div className="text-xs text-red-600">
                  Não foi possível calcular.{" "}
                  <button className="underline" onClick={() => setTentativaSaldo((n) => n + 1)}>Tentar de novo</button>
                </div>
              )}
              {(currentRegister.supplies_total || 0) > 0 && (
                <div className="text-xs text-emerald-600">
                  + {formatBRL(currentRegister.supplies_total)} em suprimentos
                </div>
              )}
              {(currentRegister.withdrawals_total || 0) > 0 && (
                <div className="text-xs text-red-600">
                  − {formatBRL(currentRegister.withdrawals_total)} em sangrias
                </div>
              )}
              {saldo.estado === "ok" && saldo.resumo.devolucoesDinheiro > 0 && (
                <div className="text-xs text-red-600">
                  − {formatBRL(saldo.resumo.devolucoesDinheiro)} em devoluções em dinheiro
                </div>
              )}
            </div>
          </div>
        )}
      </Card>

      {isAdmin && registers.filter((r) => r.status === "aberto").length > 1 && (
        <Card className="p-5 mb-6 border-amber-200 bg-amber-50/50">
          <h2 className="font-heading font-semibold text-base mb-3 flex items-center gap-2 text-amber-800">
            <ShieldAlert className="w-4 h-4" /> Caixas Abertos Agora
          </h2>
          <div className="space-y-2">
            {registers.filter((r) => r.status === "aberto").map((reg) => (
              <div key={reg.id} className="flex items-center gap-3 p-2.5 rounded-lg bg-white border border-amber-100">
                <div className="w-8 h-8 rounded-lg bg-emerald-50 flex items-center justify-center shrink-0">
                  <Wallet className="w-4 h-4 text-emerald-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium">{reg.opened_by_name || "—"}</div>
                  <div className="text-xs text-muted-foreground">
                    {formatDateTime(reg.opened_at)} · {formatBRL(reg.sales_total)} em {reg.sales_count} vendas
                  </div>
                </div>
                {reg.id !== currentRegister?.id && (
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => forceClose(reg)}
                    className="gap-1.5 shrink-0"
                  >
                    <ShieldAlert className="w-3.5 h-3.5" /> Fechar
                  </Button>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      <div>
        <h2 className="font-heading font-semibold text-lg mb-3 flex items-center gap-2">
          <Clock className="w-5 h-5" /> Histórico
        </h2>
        {registers.length === 0 ? (
          <Card className="p-8 text-center text-muted-foreground text-sm">
            Nenhum registro de caixa.
          </Card>
        ) : (
          <div className="space-y-2">
            {registers.map((reg) => (
              <Card key={reg.id} className="p-4 flex items-center gap-4">
                <div
                  className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                    reg.status === "aberto" ? "bg-emerald-50" : "bg-muted"
                  }`}
                >
                  <Wallet
                    className={`w-5 h-5 ${
                      reg.status === "aberto"
                        ? "text-emerald-600"
                        : "text-muted-foreground"
                    }`}
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm">
                      {formatDateTime(reg.opened_at)}
                    </span>
                    <Badge
                      variant={reg.status === "aberto" ? "default" : "secondary"}
                      className="text-xs"
                    >
                      {reg.status === "aberto" ? "Aberto" : "Fechado"}
                    </Badge>
                  </div>
                  {reg.closed_at && (
                    <div className="text-xs text-muted-foreground">
                      Fechado em {formatDateTime(reg.closed_at)}
                    </div>
                  )}
                  {reg.opened_by_name && (
                    <div className="text-xs text-muted-foreground flex items-center gap-1">
                      <User className="w-3 h-3" /> Aberto por: {reg.opened_by_name}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-right text-sm">
                    <div className="text-muted-foreground">
                      Vendas: {formatBRL(reg.sales_total)}
                    </div>
                    <div className="text-muted-foreground">
                      {reg.sales_count} vendas
                    </div>
                  </div>
                  {isAdmin && reg.status === "aberto" && reg.id !== currentRegister?.id && (
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => forceClose(reg)}
                      className="gap-1.5 shrink-0"
                    >
                      <ShieldAlert className="w-3.5 h-3.5" /> Fechar
                    </Button>
                  )}
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      <CashDialog
        open={dialogOpen}
        onClose={() => { setDialogOpen(false); setClosingReg(null); }}
        mode={dialogMode}
        register={closingReg || currentRegister}
        onSaved={loadData}
      />

      <SangriaDialog
        open={sangriaOpen}
        onClose={() => setSangriaOpen(false)}
        register={currentRegister}
        onSaved={loadData}
      />
    </div>
  );
}