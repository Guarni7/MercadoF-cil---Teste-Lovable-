import React, { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import CurrencyInput from "@/components/ui/currency-input";
import { api } from "@/api/dataClient";
import { formatBRL } from "@/lib/format";
import { toast } from "sonner";
import { Landmark, Loader2, Lock } from "lucide-react";
import { logActivity } from "@/lib/activityLog";
import { isOnline, openCashRegisterOffline, closeCashRegisterOffline } from "@/lib/dataLayer";
import { getCachedAuth } from "@/lib/offlineAuth";
import { generateCashClosePdf } from "@/lib/cashClosePdf";
import { FORMAS_FECHAMENTO, resumoDoCaixa } from "@/lib/cashClose";
import { carregarDadosDoCaixa } from "@/lib/cashCloseData";

export default function CashDialog({ open, onClose, mode, register, onSaved }) {
  const [amount, setAmount] = useState(0);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  // Vendas do caixa e o caixa com os totais de sangria/suprimento atuais.
  const [sales, setSales] = useState([]);
  const [reg, setReg] = useState(register);
  const [loadingSales, setLoadingSales] = useState(false);
  const [erroCarga, setErroCarga] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => {
    if (open) {
      setAmount(0);
      setNotes("");
      setReg(register);
      api.auth.me().then((u) => setCurrentUser(u)).catch(async () => {
        const cached = await getCachedAuth();
        if (cached) setCurrentUser(cached);
      });
      if (mode === "close" && register?.id) {
        let vivo = true;
        setLoadingSales(true);
        setErroCarga(false);
        setSales([]);
        carregarDadosDoCaixa(register)
          .then(({ sales: vendas, caixa }) => {
            if (!vivo) return;
            setSales(vendas);
            setReg(caixa);
          })
          .catch((e) => {
            // Sem as vendas não há total confiável: não deixa fechar com valor parcial.
            console.error("Falha ao carregar as vendas do caixa:", e);
            if (vivo) setErroCarga(true);
          })
          .finally(() => vivo && setLoadingSales(false));
        return () => { vivo = false; };
      }
    }
    return undefined;
  }, [open, mode, register]);

  // ---------- Valores calculados pelo sistema (nada digitado) ----------
  const {
    porForma: methodTotals, outros, total: totalVendido, vendas: qtdVendas,
    vendasDinheiro: salesDinheiro, suprimentos, sangrias, devolucoesDinheiro, expectedInDrawer,
  } = resumoDoCaixa(reg, sales);

  const downloadClosePdf = (r) => {
    try {
      generateCashClosePdf({
        register: r || reg,
        totals: { salesDinheiro, suprimentos, sangrias, devolucoesDinheiro, expectedInDrawer, totalVendido, qtdVendas, methodTotals, outros },
        movements: [],
        operatorName: currentUser?.full_name || currentUser?.email || reg?.opened_by_name || "—",
      });
    } catch (e) {
      console.error("Erro ao gerar PDF:", e);
    }
  };

  const handleConfirm = async () => {
    setSaving(true);
    try {
      if (mode === "open") {
        if (!isOnline()) {
          await openCashRegisterOffline(
            amount || 0,
            currentUser?.full_name || currentUser?.email || "—"
          );
          toast.success("Caixa aberto (offline) — será sincronizado!");
          onSaved?.();
          onClose();
          return;
        }
        await api.entities.CashRegister.create({
          status: "aberto",
          opening_balance: amount || 0,
          opened_at: new Date().toISOString(),
          opened_by_name: currentUser?.full_name || currentUser?.email || "—",
          sales_total: 0,
          sales_count: 0,
        });
        await logActivity({
          type: "abertura_caixa",
          description: `Abertura de caixa — ${currentUser?.full_name || currentUser?.email || "—"} · Fundo: ${formatBRL(amount || 0)}`,
          severity: "info",
          amount: amount || 0,
        });
        toast.success("Caixa aberto!");
      } else {
        if (erroCarga || loadingSales) return;
        // Tudo calculado pelo sistema: closing_balance = total vendido (todas as formas).
        if (!isOnline()) {
          await closeCashRegisterOffline(register.id, totalVendido);
          downloadClosePdf({ ...reg, closed_at: new Date().toISOString() });
          toast.success("Caixa fechado (offline) — será sincronizado!");
          onSaved?.();
          onClose();
          return;
        }
        await api.entities.CashRegister.update(register.id, {
          status: "fechado",
          closing_balance: totalVendido,
          closed_at: new Date().toISOString(),
          notes,
        });

        const openedBy = reg?.opened_by_name || "—";
        await logActivity({
          type: "fechamento_caixa",
          description: `Fechamento de caixa de ${openedBy} · Vendido: ${formatBRL(totalVendido)} (${qtdVendas} vendas) · Dinheiro esperado em caixa: ${formatBRL(expectedInDrawer)}`,
          severity: "info",
          amount: totalVendido,
          cashRegisterId: register?.id || "",
          details: notes || "",
        });

        toast.success("Caixa fechado!");
        downloadClosePdf({ ...reg, closed_at: new Date().toISOString() });
      }
      onSaved?.();
      onClose();
    } catch (e) {
      console.error(e);
      toast.error("Erro ao processar operação.");
    } finally {
      setSaving(false);
    }
  };

  // ---------- MODO ABRIR (mantido) ----------
  if (mode === "open") {
    return (
      <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Abrir Caixa</DialogTitle>
            <DialogDescription>Informe o valor em caixa na abertura.</DialogDescription>
          </DialogHeader>
          <div>
            <Label>Valor de Abertura</Label>
            <CurrencyInput
              value={amount}
              onChange={setAmount}
              className="text-lg font-semibold"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={onClose} disabled={saving}>
              Cancelar
            </Button>
            <Button onClick={handleConfirm} disabled={saving} className="gap-2">
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              Abrir Caixa
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  // ---------- MODO FECHAR ----------
  const linhas = [...FORMAS_FECHAMENTO.map((m) => ({ ...m, valor: methodTotals[m.key] || 0 }))];
  if (outros > 0) linhas.push({ key: "outros", label: "Outras formas", valor: outros });

  return (
    <>
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-xl p-0 gap-0 overflow-hidden" style={{ background: "#F8FAFA" }}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b" style={{ borderColor: "#E2E8F0" }}>
          <div className="flex items-center gap-2.5">
            <Landmark className="w-5 h-5 text-[#1A202C]" />
            <h2 className="text-lg font-bold text-[#1A202C]">Fechar Caixa</h2>
          </div>
        </div>

        <div className="px-6 py-5 space-y-5">
          {erroCarga && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              Não foi possível carregar as vendas deste caixa. Sem elas os totais não são confiáveis,
              então o fechamento está bloqueado. Verifique a conexão e abra de novo.
            </div>
          )}

          {/* Dinheiro físico esperado na gaveta */}
          <div className="rounded-xl p-4 space-y-2 text-sm" style={{ background: "#F1F5F9" }}>
            <p className="text-xs font-semibold uppercase tracking-wide text-[#718096]">
              Dinheiro na gaveta (calculado)
            </p>
            <div className="flex justify-between">
              <span className="text-[#718096]">Abertura</span>
              <span className="text-[#1A202C] tabular-nums">{formatBRL(reg?.opening_balance || 0)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[#718096]">Vendas em dinheiro</span>
              <span className="text-[#007D69] tabular-nums">+{formatBRL(salesDinheiro)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[#718096]">Suprimentos</span>
              <span className="text-[#007D69] tabular-nums">+{formatBRL(suprimentos)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[#718096]">Sangrias</span>
              <span className="text-[#E53E3E] tabular-nums">-{formatBRL(sangrias)}</span>
            </div>
            {devolucoesDinheiro > 0 && (
              <div className="flex justify-between">
                <span className="text-[#718096]">Devoluções pagas em dinheiro</span>
                <span className="text-[#E53E3E] tabular-nums">-{formatBRL(devolucoesDinheiro)}</span>
              </div>
            )}
            <div className="border-t my-1" style={{ borderColor: "#CBD5E0" }} />
            <div className="flex justify-between font-bold">
              <span className="text-[#007D69]">Esperado em caixa (dinheiro)</span>
              <span className="text-[#007D69] tabular-nums">{formatBRL(expectedInDrawer)}</span>
            </div>
          </div>

          {/* Total vendido por forma de pagamento */}
          <div>
            <p className="flex items-center gap-1.5 text-sm text-[#718096] mb-3">
              <Lock className="w-3.5 h-3.5 shrink-0" />
              Valores calculados pelo sistema a partir dos pagamentos das vendas concluídas
              deste caixa. Não podem ser editados.
            </p>
            <div className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 items-center text-sm">
              <div className="font-semibold text-[#718096] pb-2 border-b" style={{ borderColor: "#E2E8F0" }}>
                Forma de pagamento
              </div>
              <div className="font-semibold text-[#718096] pb-2 border-b text-right" style={{ borderColor: "#E2E8F0" }}>
                Total vendido
              </div>

              {linhas.map((m) => (
                <React.Fragment key={m.key}>
                  <div className="text-[#1A202C] font-medium py-1.5">{m.label}</div>
                  <div
                    className="text-right text-[#1A202C] py-1.5 tabular-nums font-medium"
                    aria-readonly="true"
                  >
                    {loadingSales ? "…" : formatBRL(m.valor)}
                  </div>
                </React.Fragment>
              ))}

              <div className="font-bold text-[#1A202C] pt-2 border-t" style={{ borderColor: "#CBD5E0" }}>
                Total ({qtdVendas} {qtdVendas === 1 ? "venda" : "vendas"})
              </div>
              <div className="text-right font-bold text-[#1A202C] pt-2 border-t tabular-nums" style={{ borderColor: "#CBD5E0" }}>
                {loadingSales ? "…" : formatBRL(totalVendido)}
              </div>
            </div>
            <p className="text-xs text-[#718096] mt-2">
              Só o dinheiro entra na gaveta. PIX, crédito, débito, vale presente e crédito loja
              não aumentam o dinheiro esperado.
            </p>
          </div>

          {/* Botão */}
          <Button
            onClick={() => setConfirmOpen(true)}
            disabled={saving || loadingSales || erroCarga}
            className="w-full h-12 text-base font-bold gap-2 hover:opacity-90"
            style={{ background: "#007D69", color: "#fff" }}
          >
            {loadingSales ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Landmark className="w-4 h-4" />
            )}
            Fechar Caixa
          </Button>
        </div>
      </DialogContent>

    </Dialog>

    {/* Confirmação */}
    <Dialog open={confirmOpen} onOpenChange={(v) => !v && setConfirmOpen(false)}>
      <DialogContent className="max-w-sm p-8" style={{ background: "#F8FAFA" }} hideClose>
        <p className="text-center text-base font-semibold text-[#1A202C] mb-8">
          Confirma o fechamento do caixa?
        </p>
        <div className="flex gap-3">
          <Button
            variant="outline"
            onClick={() => setConfirmOpen(false)}
            disabled={saving}
            className="flex-1 h-11 border-[#CBD5E0] text-[#1A202C] bg-white hover:bg-gray-50"
          >
            Voltar
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={saving}
            className="flex-1 h-11 gap-2 hover:opacity-90"
            style={{ background: "#E31A26", color: "#fff" }}
          >
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            Confirmar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
    </>
  );
}
