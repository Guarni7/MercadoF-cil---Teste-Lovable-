import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CreditCard, QrCode, Loader2, CheckCircle2, Copy } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/api/dataClient";
import { formatBRL } from "@/lib/format";

const POLL_INTERVAL_MS = 4000;
const TERMINAL_STATUSES = ["rejected", "cancelled"];
// Motivos de check-pix-payment em que repetir a verificação não adianta: o
// pagamento foi aprovado no Mercado Pago, mas a ativação nunca vai concluir
// sozinha (valor divergente, cobrança sem registro ou sem plano associado).
const DEFINITIVE_ACTIVATION_REASONS = ["amount_mismatch", "charge_not_found", "not_a_subscription_charge"];

// `amount` é só pra exibir uma prévia ANTES de gerar o PIX (plan.monthlyPrice
// ou o total já calculado em src/lib/plans.js). O valor que é cobrado de
// verdade vem sempre da resposta do backend (generatePixPayment recalcula a
// partir de planId/addonIds) — nunca do que foi mostrado em tela.
export default function PlanPaymentDialog({ open, onClose, plan, addonIds = [], amount, onConfirm, renewal = false }) {
  const [method, setMethod] = useState(null);
  const [loading, setLoading] = useState(false);
  const [pixData, setPixData] = useState(null);
  const [paid, setPaid] = useState(false);
  const [verificando, setVerificando] = useState(false);
  // Mensagem fixa no dialog quando a ativação falhou de forma definitiva
  // (toast some sozinho, e o usuário não deve gerar outro PIX nesse caso).
  const [erroAtivacao, setErroAtivacao] = useState(null);

  // Cada "sessão" de PIX (gerar → fechar/voltar) tem um número. Respostas
  // assíncronas que chegam depois de fechar o dialog ou clicar em "Voltar"
  // comparam o número que capturaram com o atual e se descartam — senão uma
  // verificação em voo poderia marcar `paid` ou disparar toast fora de hora.
  const sessionRef = useRef(0);

  // Trava o setInterval do polling (não o estado React — precisa sobreviver
  // a closures velhas e ser limpável de qualquer lugar: tick automático,
  // clique manual, expiração ou fechar o dialog).
  const pollIntervalRef = useRef(null);
  // Evita duas verificações em voo ao mesmo tempo (tick automático caindo
  // em cima de um clique manual, ou um tick caindo em cima do anterior
  // ainda não resolvido se a rede estiver lenta).
  const checkingRef = useRef(false);

  const priceValue = pixData?.amount ?? amount ?? plan?.monthlyPrice ?? 0;

  const stopPolling = useCallback(() => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
  }, []);

  // Invalida qualquer resposta assíncrona ainda em voo e limpa o polling.
  const invalidarSessao = () => {
    sessionRef.current += 1;
    checkingRef.current = false;
    stopPolling();
  };

  const reset = () => {
    invalidarSessao();
    setMethod(null);
    setLoading(false);
    setPixData(null);
    setPaid(false);
    setErroAtivacao(null);
    setVerificando(false);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleVoltar = () => {
    invalidarSessao();
    setMethod(null);
    setPixData(null);
    setErroAtivacao(null);
    setVerificando(false);
  };

  const handlePix = async () => {
    const sessao = sessionRef.current;
    setLoading(true);
    try {
      // Assinatura é cobrança da plataforma, não da conta do lojista. O
      // valor NÃO é enviado — o backend recalcula a partir de planId/
      // addonIds (generate-pix-payment ignora "amount" para purpose
      // "platform").
      const res = await api.functions.invoke("generatePixPayment", {
        description: `${renewal ? "Renovação" : "Upgrade"} Plano ${plan.name}`,
        externalReference: `${renewal ? "renew" : "upgrade"}-${plan.id}-${Date.now()}`,
        purpose: "platform",
        planId: plan.id,
        addonIds,
      });
      const data = res?.data || res;
      if (sessao !== sessionRef.current) return;
      if (data.error || !data.qrCode) {
        toast.error(data.error || "Não foi possível gerar o PIX agora.");
        return;
      }
      setPixData(data);
    } catch (e) {
      if (sessao !== sessionRef.current) return;
      console.error("Erro ao gerar PIX do plano:", e);
      toast.error(e.message || "Erro ao gerar PIX");
    } finally {
      if (sessao === sessionRef.current) setLoading(false);
    }
  };

  // Só o Mercado Pago diz se entrou dinheiro. Antes havia um botão que marcava
  // o plano como pago sem nenhuma cobrança. Usada tanto pelo botão manual
  // quanto pelo polling automático (mesma função, nunca duas lógicas de
  // verificação) — `silent` só suprime os toasts de "ainda pendente" nos
  // ticks automáticos pra não spammar o usuário a cada 4s; estados
  // terminais (aprovado/recusado/cancelado) sempre avisam.
  const verificarPagamento = useCallback(
    async ({ silent = false } = {}) => {
      if (!pixData?.paymentId || checkingRef.current) return;
      const sessao = sessionRef.current;
      checkingRef.current = true;
      if (!silent) setVerificando(true);
      try {
        const res = await api.functions.invoke("checkPixPayment", {
          paymentId: pixData.paymentId,
        });
        const data = res?.data || res;
        // Dialog fechado (ou "Voltar") enquanto a requisição estava em voo:
        // descarta a resposta, nada de setPaid/toast fora de hora.
        if (sessao !== sessionRef.current) return;
        // "approved" é só o que o Mercado Pago diz — o plano só está de fato
        // liberado quando "activated" também vier true (confirmado pelo
        // banco). Nunca considerar sucesso com approved sozinho.
        if (data.approved && data.activated) {
          stopPolling();
          setPaid(true);
          toast.success("Pagamento confirmado!");
        } else if (data.approved && !data.activated) {
          if (DEFINITIVE_ACTIVATION_REASONS.includes(data.activationReason)) {
            // Não vai se resolver sozinho: para de verificar e avisa com
            // clareza, sem sugerir gerar outro PIX (já foi pago).
            stopPolling();
            const msg =
              "Pagamento aprovado, mas não conseguimos ativar o plano automaticamente. Não gere outro PIX — fale com o suporte informando o código do pagamento " +
              `${pixData.paymentId}.`;
            setErroAtivacao(msg);
            toast.error(msg);
          } else if (!silent) {
            // Aprovado no Mercado Pago, ativação ainda não terminou — continua
            // verificando, não é um estado final.
            toast.message("Pagamento aprovado, mas a ativação ainda não foi concluída. Tente novamente em instantes.");
          }
        } else if (TERMINAL_STATUSES.includes(data.status)) {
          stopPolling();
          toast.error(
            data.status === "rejected"
              ? "Pagamento recusado. Gere um novo PIX para tentar de novo."
              : "Pagamento cancelado. Gere um novo PIX para tentar de novo."
          );
        } else if (!silent) {
          toast.message(
            data.status
              ? `Ainda não identificamos o pagamento (${data.status}).`
              : "Ainda não identificamos o pagamento."
          );
        }
      } catch (e) {
        if (sessao !== sessionRef.current) return;
        console.error("Erro ao verificar pagamento do plano:", e);
        if (!silent) toast.error(e.message || "Falha ao verificar o pagamento.");
      } finally {
        // Só a sessão atual mexe nas flags — uma resposta antiga não pode
        // liberar o `checkingRef` de uma verificação mais nova.
        if (sessao === sessionRef.current) {
          checkingRef.current = false;
          if (!silent) setVerificando(false);
        }
      }
    },
    [pixData?.paymentId, stopPolling]
  );

  // Polling automático: começa quando o QR Code é gerado, para quando
  // aprovar+ativar, recusar/cancelar, expirar (via pixData.expiresAt) ou o
  // dialog fechar/desmontar. `pollIntervalRef` garante que nunca existam
  // dois intervals rodando ao mesmo tempo (stopPolling antes de recriar).
  useEffect(() => {
    if (!pixData?.paymentId || paid) return;
    stopPolling();
    pollIntervalRef.current = setInterval(() => {
      if (pixData.expiresAt && Date.now() > new Date(pixData.expiresAt).getTime()) {
        stopPolling();
        toast.error("O PIX expirou. Gere um novo código para continuar.");
        return;
      }
      verificarPagamento({ silent: true });
    }, POLL_INTERVAL_MS);
    return () => stopPolling();
  }, [pixData, paid, verificarPagamento, stopPolling]);

  const handleFinish = () => {
    onConfirm();
    handleClose();
  };

  const copyCode = () => {
    navigator.clipboard.writeText(pixData.qrCode);
    toast.success("Código PIX copiado!");
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{renewal ? "Renovar plano" : "Upgrade para"} {plan?.name}</DialogTitle>
          <DialogDescription>
            {formatBRL(priceValue)} — Complete o pagamento para {renewal ? "renovar o plano por mais 30 dias" : "ativar o plano"}
          </DialogDescription>
        </DialogHeader>

        {paid ? (
          <div className="flex flex-col items-center py-6 gap-3">
            <CheckCircle2 className="w-16 h-16 text-emerald-500" />
            <p className="font-semibold text-lg">Pagamento confirmado!</p>
            <p className="text-sm text-muted-foreground text-center">
              Seu plano {plan?.name} foi {renewal ? "renovado" : "ativado"} com sucesso.
            </p>
            <Button onClick={handleFinish} className="w-full mt-2">
              Concluir
            </Button>
          </div>
        ) : !method ? (
          <div className="space-y-3 py-2">
            <button
              onClick={() => setMethod("pix")}
              className="w-full flex items-center gap-3 p-4 rounded-lg border-2 hover:border-primary transition-colors text-left"
            >
              <QrCode className="w-8 h-8 text-primary" />
              <div>
                <p className="font-semibold">PIX</p>
                <p className="text-sm text-muted-foreground">Pague com QR Code ou copia e cola</p>
              </div>
            </button>
            {/* Cartão ainda não tem cobrança de verdade por trás: o formulário
                aprovava sozinho depois de dois segundos e liberava o plano. */}
            <div className="w-full flex items-center gap-3 p-4 rounded-lg border-2 border-dashed text-left opacity-60">
              <CreditCard className="w-8 h-8 text-muted-foreground" />
              <div>
                <p className="font-semibold">Cartão de Crédito</p>
                <p className="text-sm text-muted-foreground">Em breve — por enquanto, pague com PIX</p>
              </div>
            </div>
          </div>
        ) : method === "pix" ? (
          <div className="py-2">
            {!pixData ? (
              <div className="flex flex-col items-center gap-4">
                {loading ? (
                  <Loader2 className="w-8 h-8 animate-spin text-primary" />
                ) : (
                  <>
                    <p className="text-sm text-muted-foreground text-center">
                      Clique para gerar o QR Code PIX no valor de{" "}
                      <strong>{formatBRL(priceValue)}</strong>
                    </p>
                    <Button onClick={handlePix} className="w-full">
                      Gerar PIX
                    </Button>
                  </>
                )}
              </div>
            ) : (
              <div className="flex flex-col items-center gap-3">
                {pixData.qrCodeImage ? (
                  <img
                    src={`data:image/png;base64,${pixData.qrCodeImage}`}
                    alt="QR Code PIX"
                    className="w-48 h-48 rounded-lg border"
                  />
                ) : (
                  <div className="w-48 h-48 rounded-lg border flex items-center justify-center text-muted-foreground text-sm">
                    QR Code indisponível
                  </div>
                )}
                <div className="w-full">
                  <Label className="text-xs">PIX Copia e Cola</Label>
                  <div className="flex gap-2 mt-1">
                    <Input
                      readOnly
                      value={pixData.qrCode || ""}
                      className="text-xs"
                    />
                    <Button size="icon" variant="outline" onClick={copyCode}>
                      <Copy className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
                <Button
                  onClick={() => verificarPagamento()}
                  disabled={verificando}
                  variant="outline"
                  className="w-full mt-2 gap-2"
                >
                  {verificando && <Loader2 className="w-4 h-4 animate-spin" />}
                  Já paguei — verificar
                </Button>
                {erroAtivacao && (
                  <p className="text-sm text-destructive text-center">{erroAtivacao}</p>
                )}
              </div>
            )}
            <Button variant="ghost" onClick={handleVoltar} className="w-full mt-3">
              Voltar
            </Button>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}