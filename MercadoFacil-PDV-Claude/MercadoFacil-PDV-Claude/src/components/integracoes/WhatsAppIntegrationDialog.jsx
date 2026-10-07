import React, { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  MessageCircle,
  Check,
  Copy,
  X,
  RefreshCw,
  Loader2,
  Send,
  Users,
  Clock,
  Shield,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "@/api/dataClient";
import {
  WHATSAPP_ADDON,
  getWhatsAppAddonState,
  setWhatsAppAddonState,
  clearWhatsAppAddonCharge,
  formatPixCountdown,
  isWhatsAppAddonUnlocked,
} from "@/lib/whatsappAddon";
import { cn } from "@/lib/utils";

const BENEFITS = [
  {
    icon: Send,
    title: "Envio em massa e individual",
    text: "Aniversariantes, clientes sumidos e lembretes direto do PDV.",
  },
  {
    icon: Users,
    title: "Bot e atendimento",
    text: "Mensagens prontas e fluxo de conversa para sua loja.",
  },
  {
    icon: Clock,
    title: "Liberação em até 8 horas",
    text: "Após o Pix confirmado, a conexão é liberada em até 8 horas.",
  },
  {
    icon: Shield,
    title: "Sem fidelidade",
    text: "Cancele quando quiser. Cobrança mensal do complemento.",
  },
];

/**
 * Fluxo: marketing → termos → Pix (QR / copia e cola / Já paguei).
 */
export default function WhatsAppIntegrationDialog({ open, onClose }) {
  const [step, setStep] = useState("marketing"); // marketing | terms | pix | done
  const [accepted, setAccepted] = useState(false);
  const [loadingPix, setLoadingPix] = useState(false);
  const [checking, setChecking] = useState(false);
  const [pixData, setPixData] = useState(null);
  const [countdown, setCountdown] = useState(null);

  const reset = () => {
    setStep("marketing");
    setAccepted(false);
    setLoadingPix(false);
    setChecking(false);
    setPixData(null);
    setCountdown(null);
  };

  useEffect(() => {
    if (!open) return;
    const state = getWhatsAppAddonState();
    if (state.status === "active" || (state.status === "paid" && isWhatsAppAddonUnlocked())) {
      setStep("done");
      return;
    }
    if (state.status === "pending_payment" && state.paymentId && state.qrCode) {
      setPixData({
        paymentId: state.paymentId,
        qrCode: state.qrCode,
        qrCodeImage: state.qrCodeImage || null,
        expiresAt: state.expiresAt || null,
      });
      setStep("pix");
      return;
    }
    reset();
  }, [open]);

  useEffect(() => {
    if (step !== "pix" || !pixData?.expiresAt) return;
    const tick = () => setCountdown(formatPixCountdown(pixData.expiresAt));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [step, pixData?.expiresAt]);

  const handleClose = () => {
    onClose?.();
  };

  // PENDÊNCIA (cobrança do add-on WhatsApp): generate-pix-payment passou a exigir
  // `planId` (valor sempre recalculado no servidor) para purpose "platform".
  // Este add-on só mandava `amount` e seria recusado com 400 — e o backend não
  // tem catálogo de preço/ativação para ele ainda. Enquanto não houver essa
  // cobrança server-side, o botão não gera PIX inválido. Para religar: criar o
  // produto no backend (preço + ativação) e trocar este flag.
  const ADDON_BILLING_PENDING = true;

  const startPixCharge = async () => {
    if (ADDON_BILLING_PENDING) {
      toast.message("A contratação do WhatsApp está temporariamente indisponível. Fale com o suporte para ativar.");
      return;
    }
    setLoadingPix(true);
    try {
      // Add-on é cobrança da plataforma, não da loja: usa a conta do
      // MercadoFácil, senão o lojista pagaria para si mesmo.
      const res = await api.functions.invoke("generatePixPayment", {
        amount: WHATSAPP_ADDON.price,
        description: `${WHATSAPP_ADDON.title} — mensal`,
        externalReference: `addon-whatsapp-${Date.now()}`,
        purpose: "platform",
      });
      const data = res.data || res;
      if (data.error || !data.qrCode) {
        toast.error(data.error || "Não foi possível gerar o Pix no momento.");
        return;
      }
      const expiresAt =
        data.expiresAt || new Date(Date.now() + WHATSAPP_ADDON.pixTtlMs).toISOString();
      const next = {
        paymentId: data.paymentId,
        qrCode: data.qrCode,
        qrCodeImage: data.qrCodeImage || null,
        expiresAt,
      };
      setPixData(next);
      setWhatsAppAddonState({
        status: "pending_payment",
        ...next,
        amount: WHATSAPP_ADDON.price,
      });
      setStep("pix");
    } catch (e) {
      toast.error(e.message || "Erro ao gerar Pix");
    } finally {
      setLoadingPix(false);
    }
  };

  const handleAcceptAndPay = async () => {
    if (!accepted) {
      toast.message("Marque que leu e aceitou os termos.");
      return;
    }
    await startPixCharge();
  };

  const copyPix = () => {
    if (!pixData?.qrCode) return;
    navigator.clipboard.writeText(pixData.qrCode);
    toast.success("Pix copia e cola copiado!");
  };

  const cancelCharge = () => {
    clearWhatsAppAddonCharge();
    setPixData(null);
    setStep("marketing");
    toast.message("Cobrança cancelada.");
  };

  const verifyPaid = async () => {
    if (!pixData?.paymentId) {
      toast.error("Gere o Pix primeiro.");
      return;
    }
    setChecking(true);
    try {
      const res = await api.functions.invoke("checkPixPayment", {
        paymentId: pixData.paymentId,
      });
      const data = res.data || res;
      if (data.approved) {
        setWhatsAppAddonState({
          status: "paid",
          paidAt: new Date().toISOString(),
          paymentId: pixData.paymentId,
        });
        setStep("done");
        toast.success("Pix confirmado! Liberação da conexão em até 8 horas.");
      } else {
        toast.message(
          data.status
            ? `Ainda não aprovado (${data.status}). Aguarde a confirmação automática.`
            : "Aguardando confirmação automática do Pix..."
        );
      }
    } catch (e) {
      toast.error(e.message || "Falha ao verificar pagamento.");
    } finally {
      setChecking(false);
    }
  };

  const hideDefaultClose = step === "pix";

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent
        className={cn(
          "max-w-md p-0 gap-0 overflow-hidden border bg-[#f3f4f6] sm:rounded-2xl max-h-[92vh] flex flex-col",
          hideDefaultClose && "[&>button]:hidden"
        )}
        aria-describedby={undefined}
        onPointerDownOutside={(e) => {
          if (step === "pix") e.preventDefault();
        }}
        onEscapeKeyDown={(e) => {
          if (step === "pix") e.preventDefault();
        }}
      >
        {step === "marketing" && (
          <div className="flex flex-col overflow-y-auto">
            <div className="px-5 pt-5 pb-4">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-12 h-12 rounded-2xl bg-[#25D366]/15 flex items-center justify-center">
                  <MessageCircle className="w-6 h-6 text-[#128C7E]" />
                </div>
                <div>
                  <DialogTitle className="text-xl font-bold text-foreground">
                    {WHATSAPP_ADDON.title}
                  </DialogTitle>
                  <p className="text-sm text-muted-foreground mt-0.5">
                    Complemento mensal · {WHATSAPP_ADDON.priceLabel}
                    {WHATSAPP_ADDON.periodLabel}
                  </p>
                </div>
              </div>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Conecte o WhatsApp da loja ao MercadoFácil para campanhas, aniversários e clientes
                sumidos — com confirmação de pagamento via Pix.
              </p>
            </div>
            <div className="px-5 space-y-2.5 pb-4">
              {BENEFITS.map((b) => {
                const Icon = b.icon;
                return (
                  <div
                    key={b.title}
                    className="flex gap-3 rounded-xl border bg-white px-3 py-3"
                  >
                    <div className="w-9 h-9 rounded-lg bg-emerald-50 flex items-center justify-center shrink-0">
                      <Icon className="w-4 h-4 text-emerald-700" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-foreground">{b.title}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{b.text}</p>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="px-5 pb-5 space-y-2">
              <Button className="w-full h-11 text-sm font-semibold" onClick={() => setStep("terms")}>
                Continuar
              </Button>
              <Button variant="ghost" className="w-full" onClick={handleClose}>
                Agora não
              </Button>
            </div>
          </div>
        )}

        {step === "terms" && (
          <div className="flex flex-col overflow-hidden max-h-[92vh]">
            <div className="px-5 pt-5 pb-3 shrink-0">
              <DialogTitle className="text-lg font-bold">Termos do complemento</DialogTitle>
              <p className="text-sm text-muted-foreground mt-1">
                {WHATSAPP_ADDON.title} — {WHATSAPP_ADDON.priceLabel}
                {WHATSAPP_ADDON.periodLabel}
              </p>
            </div>
            <div className="px-5 flex-1 overflow-y-auto text-sm text-muted-foreground space-y-3 leading-relaxed">
              <p>
                Ao contratar, você autoriza a cobrança mensal de {WHATSAPP_ADDON.priceLabel} referente
                à Integração WhatsApp do MercadoFácil PDV.
              </p>
              <p>
                O pagamento é feito via Pix. Após a confirmação automática, a conexão do WhatsApp é
                liberada em até {WHATSAPP_ADDON.releaseHours} horas (provisionamento manual/técnico).
              </p>
              <p>
                O complemento não inclui o plano base do PDV. Pode ser cancelado a qualquer momento
                junto ao suporte. Uso indevido (spam) pode resultar em suspensão da integração.
              </p>
              <p>
                Dados de clientes usados nas mensagens são de responsabilidade da loja, conforme a
                LGPD e nossa Política de Privacidade.
              </p>
            </div>
            <div className="px-5 pt-3 pb-5 shrink-0 space-y-4 border-t bg-white/60">
              <label className="flex items-start gap-3 cursor-pointer">
                <Checkbox
                  checked={accepted}
                  onCheckedChange={(v) => setAccepted(!!v)}
                  className="mt-0.5"
                />
                <span className="text-sm text-foreground">
                  Li e aceito os termos da Integração WhatsApp.
                </span>
              </label>
              <Button
                className="w-full h-11 text-sm font-semibold gap-2"
                disabled={!accepted || loadingPix}
                onClick={handleAcceptAndPay}
              >
                {loadingPix ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Check className="w-4 h-4" />
                )}
                Aceitar e pagar {WHATSAPP_ADDON.priceLabel}
              </Button>
              <Button variant="ghost" className="w-full" onClick={() => setStep("marketing")} disabled={loadingPix}>
                Voltar
              </Button>
            </div>
          </div>
        )}

        {step === "pix" && (
          <div className="flex flex-col px-5 pt-6 pb-5 items-center text-center">
            <DialogTitle className="text-xl font-bold text-foreground">
              Pague o Pix para liberar
            </DialogTitle>
            <p className="text-sm text-foreground mt-2">
              {WHATSAPP_ADDON.title} —{" "}
              <span className="font-semibold">{WHATSAPP_ADDON.priceLabel}</span>
            </p>
            {countdown && (
              <p className="text-sm font-medium text-orange-500 mt-1.5">{countdown}</p>
            )}

            <div className="mt-5 w-full max-w-[280px] rounded-2xl border bg-white p-4 flex items-center justify-center">
              {pixData?.qrCodeImage ? (
                <img
                  src={`data:image/png;base64,${pixData.qrCodeImage}`}
                  alt="QR Code Pix"
                  className="w-52 h-52 object-contain"
                />
              ) : pixData?.qrCode ? (
                <img
                  src={`https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(pixData.qrCode)}`}
                  alt="QR Code Pix"
                  className="w-52 h-52 object-contain"
                />
              ) : (
                <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
              )}
            </div>

            <Button
              variant="outline"
              className="mt-4 w-full max-w-[280px] h-11 gap-2 bg-white"
              onClick={copyPix}
            >
              <Copy className="w-4 h-4" />
              Copiar Pix copia e cola
            </Button>

            <p className="mt-4 text-xs text-muted-foreground leading-relaxed max-w-sm">
              Após o pagamento, a conexão do WhatsApp é liberada em até{" "}
              {WHATSAPP_ADDON.releaseHours} horas. Aguardando confirmação automática do Pix...
            </p>

            <div className="mt-5 w-full grid grid-cols-2 gap-2">
              <Button
                variant="outline"
                className="h-11 gap-1.5 bg-white text-sm"
                onClick={cancelCharge}
              >
                <X className="w-4 h-4" />
                Cancelar cobrança
              </Button>
              <Button
                variant="outline"
                className="h-11 gap-1.5 bg-white text-sm"
                onClick={verifyPaid}
                disabled={checking}
              >
                {checking ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <RefreshCw className="w-4 h-4" />
                )}
                Já paguei
              </Button>
            </div>
          </div>
        )}

        {step === "done" && (
          <div className="flex flex-col items-center px-5 py-8 text-center gap-3">
            <div className="w-14 h-14 rounded-full bg-emerald-100 flex items-center justify-center">
              <Check className="w-7 h-7 text-emerald-600" />
            </div>
            <DialogTitle className="text-lg font-bold">Pagamento confirmado</DialogTitle>
            <p className="text-sm text-muted-foreground max-w-sm">
              A Integração WhatsApp foi contratada. A conexão é liberada em até{" "}
              {WHATSAPP_ADDON.releaseHours} horas. Você pode acompanhar o status em Integrações.
            </p>
            <Button className="mt-2 w-full max-w-xs" onClick={handleClose}>
              Fechar
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
