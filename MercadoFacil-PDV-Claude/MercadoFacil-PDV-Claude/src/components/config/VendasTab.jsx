import React, { useState, useEffect } from "react";
import { Switch } from "@/components/ui/switch";
import { lerConfigMesas, salvarConfigMesas, EVENTO_CONFIG_MESAS } from "@/lib/mesasApi";
import AtivarMesasDialog from "@/components/mesas/AtivarMesasDialog";
import { useMesasAcesso } from "@/components/mesas/useMesasAcesso";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  Scale, Printer, CreditCard, Tag,
  Landmark, Database, Save, Loader2, UtensilsCrossed,
} from "lucide-react";

const SHORTCUTS = [
  { icon: Scale, title: "Balança Checkout", desc: "Desconectada", tab: "balanca" },
  { icon: Printer, title: "Impressora", desc: "USB, Rede, Sistema", tab: "impressora" },
  { icon: CreditCard, title: "Extras", desc: "Caixa, comercial, estoque", tab: "extras" },
  { icon: Tag, title: "Balança de Etiqueta", desc: "Impressão de etiquetas", tab: "etiqueta" },
  { icon: Landmark, title: "Financeiro", desc: "Juros e mora", tab: "financeiro" },
  { icon: Database, title: "Backup / BD Offline", desc: "Servidor offline e backup", tab: "extras" },
];

export default function VendasTab({ onNavigate }) {
  const [saving, setSaving] = useState(false);
  const [mesasAtivas, setMesasAtivas] = useState(() => lerConfigMesas().ativo);
  const [configMesas, setConfigMesas] = useState(() => lerConfigMesas());
  const [ativarAberto, setAtivarAberto] = useState(false);
  const acesso = useMesasAcesso(configMesas);
  useEffect(() => {
    const sync = () => {
      setMesasAtivas(lerConfigMesas().ativo);
      setConfigMesas(lerConfigMesas());
    };
    window.addEventListener(EVENTO_CONFIG_MESAS, sync);
    return () => window.removeEventListener(EVENTO_CONFIG_MESAS, sync);
  }, []);

  function handleSave() {
    setSaving(true);
    try {
      toast.success("Configurações de vendas salvas!");
    } catch {
      toast.error("Erro ao salvar.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {SHORTCUTS.map((s) => {
          const Icon = s.icon;
          return (
            <Card
              key={s.title}
              onClick={() => onNavigate?.(s.tab)}
              className="p-5 flex flex-col items-center gap-3 text-center hover:shadow-md hover:border-primary/40 transition-all cursor-pointer"
            >
              <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center">
                <Icon className="w-6 h-6 text-primary" />
              </div>
              <div>
                <p className="font-semibold text-sm leading-tight">{s.title}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{s.desc}</p>
              </div>
            </Card>
          );
        })}
      </div>

      <Card className="p-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            <UtensilsCrossed className="w-5 h-5 text-primary" />
          </div>
          <div>
            <p className="font-semibold text-sm leading-tight">Atendimento por mesas e cartões</p>
            <p className="text-xs text-muted-foreground mt-0.5">Opcional, para restaurantes: mesas, cartões/comandas e almoço por peso. A venda rápida não muda.</p>
          </div>
        </div>
        <Switch checked={mesasAtivas} onCheckedChange={(v) => (v && acesso.precisaAceite ? setAtivarAberto(true) : salvarConfigMesas({ ativo: v }))} aria-label="Ativar atendimento por mesas" />
      </Card>
      <AtivarMesasDialog open={ativarAberto} onClose={() => setAtivarAberto(false)} acesso={acesso} />

      <Button onClick={handleSave} disabled={saving} className="gap-2 w-full">
        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
        Salvar Configurações
      </Button>
    </div>
  );
}
