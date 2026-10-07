import React, { useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { MessageCircle, ChevronRight } from "lucide-react";
import WhatsAppIntegrationDialog from "@/components/integracoes/WhatsAppIntegrationDialog";
import {
  WHATSAPP_ADDON,
  getWhatsAppAddonState,
  isWhatsAppAddonUnlocked,
} from "@/lib/whatsappAddon";

/** @returns {{ label: string, variant: "default" | "secondary" }} */
function statusBadge() {
  const s = getWhatsAppAddonState();
  if (s.status === "active" || (s.status === "paid" && isWhatsAppAddonUnlocked())) {
    return { label: s.status === "active" ? "Ativo" : "Pago · liberando", variant: "default" };
  }
  if (s.status === "pending_payment") {
    return { label: "Pix pendente", variant: "secondary" };
  }
  return { label: "Não contratado", variant: "secondary" };
}

export default function WhatsAppCard() {
  const [open, setOpen] = useState(false);
  const [tick, setTick] = useState(0);
  const badge = statusBadge();
  void tick;

  return (
    <>
      <Card
        className="p-5 flex flex-col gap-3 hover:shadow-md cursor-pointer transition-shadow"
        onClick={() => setOpen(true)}
      >
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-[#25D366]/15 flex items-center justify-center">
              <MessageCircle className="w-5 h-5 text-[#128C7E]" />
            </div>
            <div>
              <h3 className="font-semibold text-sm">{WHATSAPP_ADDON.title}</h3>
              <Badge variant={badge.variant} className="text-xs mt-1 font-normal">
                {badge.label}
              </Badge>
            </div>
          </div>
          <ChevronRight className="w-5 h-5 text-muted-foreground shrink-0" />
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed">
          Campanhas, aniversários e clientes sumidos pelo WhatsApp da loja.{" "}
          {WHATSAPP_ADDON.priceLabel}
          {WHATSAPP_ADDON.periodLabel} · liberação em até {WHATSAPP_ADDON.releaseHours}h após o Pix.
        </p>
      </Card>

      <WhatsAppIntegrationDialog
        open={open}
        onClose={() => {
          setOpen(false);
          setTick((n) => n + 1);
        }}
      />
    </>
  );
}
