import React, { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Wallet, ChevronRight, ChevronDown } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { toast } from "sonner";

export default function MercadoPagoCard() {
  const [open, setOpen] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [connected, setConnected] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("mp_connected") || "false");
    } catch {
      return false;
    }
  });

  const handleConnect = () => {
    toast.info("Redirecionando para Mercado Pago...");
    setTimeout(() => {
      setConnected(true);
      localStorage.setItem("mp_connected", "true");
      toast.success("Mercado Pago conectado!");
    }, 2000);
  };

  const handleDisconnect = () => {
    setConnected(false);
    localStorage.setItem("mp_connected", "false");
    toast.success("Desconectado.");
  };

  return (
    <>
      <Card
        className="p-5 flex flex-col gap-3 hover:shadow-md cursor-pointer transition-shadow"
        onClick={() => setOpen(true)}
      >
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-[#e0f2f1] flex items-center justify-center">
              <Wallet className="w-5 h-5 text-[#00695c]" />
            </div>
            <div>
              <h3 className="font-semibold text-sm">Mercado Pago</h3>
              <Badge
                variant={connected ? "default" : "secondary"}
                className="text-xs mt-1 font-normal"
              >
                {connected ? "Configurado" : "Não configurado"}
              </Badge>
            </div>
          </div>
          <ChevronRight className="w-5 h-5 text-muted-foreground shrink-0" />
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed">
          Mesma conta do Delivery e do PIX Checkout no PDV. Conecte uma vez, vale em todos.
        </p>
      </Card>

      <Dialog open={open} onOpenChange={(v) => !v && setOpen(false)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-lg bg-[#e0f2f1] flex items-center justify-center">
                <Wallet className="w-4.5 h-4.5 text-[#00695c]" />
              </div>
              Mercado Pago
            </DialogTitle>
            <DialogDescription>
              PIX Checkout no PDV e pagamento no cardápio — uma conta para tudo.
            </DialogDescription>
          </DialogHeader>

          <div className="rounded-lg border p-5">
            <h4 className="font-heading font-semibold text-sm mb-3">Conectar em 1 passo</h4>
            <div className="space-y-2 mb-4 text-sm text-muted-foreground">
              <div className="flex gap-2"><span className="font-semibold text-foreground">1.</span> Clique no botão abaixo</div>
              <div className="flex gap-2"><span className="font-semibold text-foreground">2.</span> Faça login na conta Mercado Pago da loja</div>
              <div className="flex gap-2"><span className="font-semibold text-foreground">3.</span> Autorize — pronto. Sem token e sem painel técnico.</div>
            </div>
            <Button
              onClick={handleConnect}
              disabled={connected}
              className="w-full bg-[#009EE3] hover:bg-[#0086c5] gap-2"
            >
              {connected ? "✓ Conta Mercado Pago Conectada" : "Conectar conta Mercado Pago"}
            </Button>
            {connected && (
              <Button variant="outline" size="sm" className="w-full mt-2" onClick={handleDisconnect}>
                Desconectar
              </Button>
            )}
            <p className="text-xs text-muted-foreground text-center mt-2">
              Você será redirecionado ao site do Mercado Pago e volta automaticamente.
            </p>
          </div>

          <button
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1"
          >
            <ChevronDown className={`w-4 h-4 transition-transform ${showAdvanced ? "rotate-180" : ""}`} />
            Opção avançada (colar Access Token)
          </button>
          {showAdvanced && (
            <div className="rounded-lg border p-4">
              <label className="text-xs text-muted-foreground mb-1.5 block">Access Token</label>
              <input
                type="text"
                placeholder="APP_USR-xxxx-xxxx-xxxx"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
              <Button variant="outline" size="sm" className="mt-3">Salvar Token</Button>
            </div>
          )}

          <div className="rounded-lg bg-muted p-4 text-xs text-muted-foreground leading-relaxed">
            Conectar em Sistema → Integrações ou em Delivery é a mesma conta. No PDV, ative
            PIX Checkout — Mercado Pago na forma de pagamento. No cardápio, o cliente vê só
            as formas liberadas acima (PIX e/ou cartão).
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}