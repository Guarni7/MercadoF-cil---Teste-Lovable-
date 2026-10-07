import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Check, Info, Wallet } from "lucide-react";
import { toast } from "sonner";
import { ADDONS, formatAddonPrice, formatMonthlyPrice } from "@/lib/plans";
import { formatBRL } from "@/lib/format";
import { addonsComMesas } from "@/lib/mesasAcesso";
import { salvarConfigMesas } from "@/lib/mesasApi";

const ADICIONAL = ADDONS.find((a) => a.id === "mesas");

/**
 * Ativar Mesas (adicional pago): mostra o reajuste do plano e pede o aceite.
 * - Teste: "Aceito e ativar" liga Mesas neste caixa; nada é cobrado no teste.
 * - Plano ativo/vencido: abre a contratação com o adicional Mesas (PIX no fluxo de planos); o valor cobrado é o do servidor.
 * `acesso` vem de useMesasAcesso(). @param {any} props  { open, onClose, acesso, onAtivado? }
 */
export default function AtivarMesasDialog({ open, onClose, acesso, onAtivado }) {
  const navigate = useNavigate();
  const [aceito, setAceito] = useState(false);
  useEffect(() => {
    if (open) setAceito(false);
  }, [open]);

  const { reajuste, modo } = acesso;
  const teste = modo === "teste";

  const confirmar = () => {
    if (teste) {
      salvarConfigMesas({ ativo: true, aceiteMesas: { em: new Date().toISOString(), valorMensal: reajuste.adicional } });
      toast.success("Mesas ativado. Durante o teste nada é cobrado.");
      onAtivado?.();
      onClose();
      return;
    }
    onClose();
    navigate(`/selecionar-plano?plan=${acesso.plano}&addons=${addonsComMesas(acesso.addons).join(",")}`);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>Ativar Mesas</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="rounded-xl border bg-muted/40 p-3">
            <div className="flex items-start justify-between gap-3">
              <p className="font-semibold text-sm">{ADICIONAL.label}</p>
              <p className="text-sm font-semibold text-primary whitespace-nowrap">{formatAddonPrice(ADICIONAL)}</p>
            </div>
            <p className="text-xs text-muted-foreground mt-1">{ADICIONAL.description}</p>
          </div>

          <div className="rounded-xl border p-3 space-y-2">
            <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-primary">
              <Wallet className="w-3.5 h-3.5" /> Reajuste do plano
            </p>
            <div className="flex justify-between text-sm text-muted-foreground">
              <span>Plano atual</span><span>{formatMonthlyPrice(reajuste.planoAtual)}</span>
            </div>
            <div className="flex justify-between text-sm text-muted-foreground">
              <span>Mesas</span><span>+ {formatBRL(reajuste.adicional)}</span>
            </div>
            <div className="flex items-center justify-between border-t pt-2">
              <span className="font-bold text-sm">Seu plano fica</span>
              <span className="text-lg font-extrabold text-primary">{formatBRL(reajuste.novoTotal)}<span className="text-xs font-normal text-muted-foreground">/mês</span></span>
            </div>
            <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
              <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              {teste
                ? "Durante o teste nada é cobrado. O adicional entra na fatura quando você ativar o plano (por mês)."
                : "O adicional entra na sua assinatura. O pagamento é feito por PIX no próximo passo, com o valor calculado pelo servidor."}
            </p>
            <label className="flex items-start gap-2 text-sm cursor-pointer">
              <Checkbox checked={aceito} onCheckedChange={(v) => setAceito(!!v)} className="mt-0.5" aria-label="Concordo com o reajuste" />
              <span>Concordo com o reajuste e autorizo a cobrança de <strong>{formatBRL(reajuste.novoTotal)}/mês</strong>.</span>
            </label>
          </div>

          <Button className="w-full gap-2" disabled={!aceito} onClick={confirmar}>
            <Check className="w-4 h-4" /> {teste ? "Aceito e ativar" : "Aceito e contratar"}
          </Button>
          <Button variant="ghost" className="w-full" onClick={onClose}>Cancelar</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
