import React, { useState } from "react";
import { Sparkles, ChevronRight, Building2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import MercadoPagoCard from "@/components/integracoes/MercadoPagoCard";
import MetaPixelCard from "@/components/integracoes/MetaPixelCard";
import WhatsAppCard from "@/components/integracoes/WhatsAppCard";
import SicrediConfigDialog from "@/components/integracoes/SicrediConfigDialog";

export default function Integracoes() {
  const [sicrediOpen, setSicrediOpen] = useState(false);

  return (
    <div className="p-4 lg:p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-heading font-bold">Integrações</h1>
        <p className="text-muted-foreground text-sm mt-0.5">
          Conecte ferramentas externas. Cada integração usa a conta do seu negócio.
        </p>
      </div>

      <div className="space-y-4">
        <WhatsAppCard />

        <MercadoPagoCard />

        <Card
          className="p-5 flex flex-col gap-3 hover:shadow-md cursor-pointer transition-shadow"
          onClick={() => setSicrediOpen(true)}
        >
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-green-50 flex items-center justify-center">
                <Building2 className="w-5 h-5 text-green-700" />
              </div>
              <div>
                <h3 className="font-semibold text-sm">API Sicredi</h3>
                <Badge variant="secondary" className="text-xs mt-1 font-normal">Não configurado</Badge>
              </div>
            </div>
            <ChevronRight className="w-5 h-5 text-muted-foreground shrink-0" />
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Cobrança Online: boleto, híbrido (Pix), protesto e negativação via API da cooperativa.
          </p>
        </Card>

        <MetaPixelCard />

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {[
            { name: "Shopee", desc: "Sincronização de pedidos e catálogo (em breve)." },
            { name: "Mercado Livre", desc: "Integração de anúncios e pedidos (em breve)." },
          ].map((item) => (
            <Card key={item.name} className="p-5 flex flex-col gap-3 opacity-75">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center">
                  <Sparkles className="w-5 h-5 text-muted-foreground" />
                </div>
                <div>
                  <h3 className="font-semibold text-sm">{item.name}</h3>
                  <Badge variant="outline" className="text-xs mt-1 font-normal">Em breve</Badge>
                </div>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">{item.desc}</p>
            </Card>
          ))}
        </div>
      </div>

      <SicrediConfigDialog open={sicrediOpen} onClose={() => setSicrediOpen(false)} />
    </div>
  );
}