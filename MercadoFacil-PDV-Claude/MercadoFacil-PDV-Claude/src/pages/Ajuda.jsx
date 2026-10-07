import React from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, CheckCircle2, Download, KeyRound, Store, CreditCard } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SUPPORT_WHATSAPP_URL } from "@/lib/supportContact";

const steps = [
  {
    icon: Store,
    title: "1. Crie sua conta",
    text: "Registre-se em /register e escolha o plano (MEI ou Simples Nacional).",
  },
  {
    icon: CheckCircle2,
    title: "2. Inicie o teste de 7 dias",
    text: "Em “Escolher plano”, confirme o trial. Sem plano ativo o PDV permanece bloqueado.",
  },
  {
    icon: KeyRound,
    title: "3. Configure pagamentos",
    text: "Admin: Configurações → Pagamento. O Access Token do Mercado Pago da sua loja é gravado cifrado no servidor e nunca volta para a tela — o PIX da venda cai direto na conta da loja.",
  },
  {
    icon: CreditCard,
    title: "4. Abra o caixa e venda",
    text: "PDV → abra o caixa → venda com dinheiro, PIX ou cartão. Use Sync se trabalhar offline.",
  },
  {
    icon: Download,
    title: "5. Instale no Windows (opcional)",
    text: "Em /baixar, baixe o instalador FINAL. Android: adicione o site à tela inicial (PWA).",
  },
];

export default function Ajuda() {
  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-3xl px-4 py-10">
        <Link to="/landing" className="inline-flex items-center gap-2 text-sm text-emerald-700 mb-6">
          <ArrowLeft className="w-4 h-4" /> Voltar
        </Link>
        <h1 className="text-3xl font-bold text-slate-900 mb-2">Central de ajuda</h1>
        <p className="text-slate-600 mb-8">
          Onboarding rápido para colocar o MercadoFácil em produção na sua loja.
        </p>
        <div className="space-y-4 mb-10">
          {steps.map((s) => {
            const Icon = s.icon;
            return (
              <div key={s.title} className="rounded-xl border bg-white p-4 flex gap-3">
                <div className="h-10 w-10 rounded-lg bg-emerald-50 flex items-center justify-center shrink-0">
                  <Icon className="w-5 h-5 text-emerald-700" />
                </div>
                <div>
                  <h2 className="font-semibold text-slate-900">{s.title}</h2>
                  <p className="text-sm text-slate-600 mt-1">{s.text}</p>
                </div>
              </div>
            );
          })}
        </div>
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 mb-6">
          <strong>Fiscal:</strong> a emissão é validada, numerada, assinada e transmitida pelo
          servidor, e o documento só aparece como autorizado com protocolo oficial. A NFS-e
          Nacional já opera com o certificado A1 da loja; a transmissão de NFC-e e NF-e para a
          SEFAZ depende de homologação na UF. Cadastre o certificado em Configurações → Fiscal e
          acompanhe o estado de cada item em "Status da integração".
        </div>
        <div className="flex flex-wrap gap-3">
          <Link to="/register"><Button className="bg-emerald-700">Criar conta</Button></Link>
          <Link to="/baixar"><Button variant="outline">Baixar Windows</Button></Link>
          <a href={SUPPORT_WHATSAPP_URL} target="_blank" rel="noreferrer">
            <Button variant="outline">WhatsApp suporte</Button>
          </a>
        </div>
      </div>
    </div>
  );
}
