import React, { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Clock, Send, MessageCircle, RefreshCw, History } from "lucide-react";
import { toast } from "sonner";
import VersionHistory from "./VersionHistory";
import { APP_VERSION, APP_VERSION_CODE } from "@/lib/appVersion";
import { requestUpdateCheck } from "@/components/updates/UpdateFlowHost";
import { hasElectronUpdate, verificarAtualizacaoAgora } from "@/lib/electronUpdate";
import { SUPPORT_PHONE_DISPLAY, supportWhatsAppUrl } from "@/lib/supportContact";

export default function SuporteTab() {
  const [phone, setPhone] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [verificando, setVerificando] = useState(false);

  // Desktop: checagem REAL do electron-updater (o progresso aparece no painel de atualização).
  // Web: segue a tela de novidades de sempre.
  const handleVerificarAtualizacoes = async () => {
    if (!hasElectronUpdate()) return requestUpdateCheck();
    setVerificando(true);
    try {
      const r = await verificarAtualizacaoAgora(APP_VERSION);
      ({ sucesso: toast.success, info: toast.info, erro: toast.error })[r.tipo](r.mensagem);
    } finally {
      setVerificando(false);
    }
  };

  const handleSend = () => {
    if (!phone || !message) {
      toast.error("Preencha o telefone e a mensagem.");
      return;
    }
    setSending(true);
    setTimeout(() => {
      try {
        const solicitations = JSON.parse(localStorage.getItem("support_solicitations") || "[]");
        solicitations.push({ phone, message, date: new Date().toISOString() });
        localStorage.setItem("support_solicitations", JSON.stringify(solicitations));
      } catch {}
      setSending(false);
      toast.success("Solicitação enviada! Retornaremos em breve.");
      setPhone("");
      setMessage("");
    }, 1000);
  };

  return (
    <div className="space-y-6">
      <Card className="p-6 bg-blue-50 border-blue-100">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
            <Clock className="w-6 h-6 text-primary" />
          </div>
          <div>
            <h3 className="font-heading font-semibold text-base">Horário de Atendimento</h3>
            <p className="text-sm text-muted-foreground">Segunda a Sexta: 08h às 18h</p>
            <p className="text-sm text-muted-foreground">Sábado e Domingo: sem atendimento</p>
          </div>
        </div>
      </Card>

      <Card className="p-6">
        <h3 className="font-heading font-semibold text-base mb-1 flex items-center gap-2">
          <Send className="w-4 h-4 text-primary" /> Solicitar Contato
        </h3>
        <p className="text-sm text-muted-foreground mb-4">
          Envie sua dúvida ou solicitação e retornaremos o mais breve possível.
        </p>
        <div className="space-y-4">
          <div>
            <Label className="mb-1.5 block">Seu telefone/WhatsApp</Label>
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(00) 00000-0000" />
          </div>
          <div>
            <Label className="mb-1.5 block">Como podemos ajudar?</Label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={4}
              className="w-full min-h-[80px] rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              placeholder="Descreva sua dúvida ou solicitação..."
            />
          </div>
          <Button onClick={handleSend} disabled={sending} className="w-full gap-2">
            {sending ? "Enviando..." : (<><Send className="w-4 h-4" /> Enviar Solicitação</>)}
          </Button>
        </div>
      </Card>

      <Card className="p-6 bg-emerald-50 border-emerald-100">
        <div className="flex items-center gap-4 mb-4">
          <div className="w-12 h-12 rounded-full bg-emerald-100 flex items-center justify-center shrink-0">
            <MessageCircle className="w-6 h-6 text-emerald-600" />
          </div>
          <div>
            <h3 className="font-heading font-semibold text-base">Falar no WhatsApp</h3>
            <p className="text-sm text-muted-foreground">
              Precisa de ajuda imediata? Fale conosco: {SUPPORT_PHONE_DISPLAY}
            </p>
          </div>
        </div>
        <Button
          className="bg-emerald-600 hover:bg-emerald-700 gap-2"
          onClick={() =>
            window.open(
              supportWhatsAppUrl("Olá, preciso de ajuda com o MercadoFácil PDV"),
              "_blank"
            )
          }
        >
          <MessageCircle className="w-4 h-4" /> Abrir WhatsApp
        </Button>
      </Card>

      <Card className="p-6">
        <div className="flex items-center gap-4 mb-4">
          <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center shrink-0">
            <RefreshCw className="w-6 h-6 text-muted-foreground" />
          </div>
          <div>
            <h3 className="font-heading font-semibold text-base">Atualizar Sistema</h3>
            <p className="text-sm text-muted-foreground">
              Versão atual: {APP_VERSION} (código {APP_VERSION_CODE})
            </p>
          </div>
        </div>
        <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm text-emerald-950">
          <p className="font-medium mb-0.5">Não precisa reinstalar o Windows a cada update</p>
          <p className="text-emerald-900/90 text-xs leading-relaxed">
            Com internet, o sistema atualiza sozinho na nuvem (como a sincronização de vendas).
            Baixe o instalador de novo só em computador novo ou quando avisarmos uma atualização
            do programa do caixa. Use o botão abaixo para ver as novidades da versão.
          </p>
        </div>
        <Button variant="outline" className="gap-2 mb-4" onClick={handleVerificarAtualizacoes} disabled={verificando}>
          <RefreshCw className={`w-4 h-4 ${verificando ? "animate-spin" : ""}`} /> {verificando ? "Verificando..." : "Verificar Atualizações"}
        </Button>
        <button
          onClick={() => setShowHistory(!showHistory)}
          className="text-sm text-primary hover:underline flex items-center gap-1"
        >
          <History className="w-3.5 h-3.5" /> Histórico de versões
        </button>
        {showHistory && <VersionHistory />}
      </Card>
    </div>
  );
}