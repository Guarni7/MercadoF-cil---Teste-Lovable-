import React, { useEffect, useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { mensagemDeErro } from "@/lib/mensagemErro";
import { faixaDeMesas, mesasNovas, planejarRemocao } from "@/lib/mesas";
import { criarMesas, removerMesas } from "@/lib/mesasApi";

/**
 * Gerenciar mesas: Criar ou Remover, por faixa de números (ex.: 1 até 10) ou uma mesa só.
 * `cadastradas`: números cadastrados; `ocupadas`: mesas com atendimento aberto (não saem). `onAtualizado()` recarrega.
 */
export default function GerenciarMesasDialog({ open, onClose, cadastradas = [], ocupadas = [], onAtualizado }) {
  const [aba, setAba] = useState("criar");
  const [faixa, setFaixa] = useState(true);
  const [de, setDe] = useState("1");
  const [ate, setAte] = useState("10");
  const [numero, setNumero] = useState("");
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    if (open) {
      setAba("criar");
      setFaixa(true);
      setDe("1");
      setAte("10");
      setNumero("");
    }
  }, [open]);

  const criar = aba === "criar";
  const r = faixa ? faixaDeMesas(de, ate) : faixaDeMesas(numero, numero);

  const enviar = async () => {
    if (!r.ok) {
      toast.error(r.erro);
      return;
    }
    setOcupado(true);
    try {
      if (criar) {
        const criadas = await criarMesas(r.numeros);
        toast.success("Mesas atualizadas", { description: `${criadas} criada(s)` });
      } else {
        const plano = planejarRemocao(r.numeros, cadastradas, ocupadas);
        const removidas = await removerMesas(plano.remover);
        toast.success("Mesas atualizadas", {
          description: `${removidas} removida(s)${plano.ocupadas.length ? ` · ${plano.ocupadas.length} ocupada(s) não removida(s) (${plano.ocupadas.join(", ")})` : ""}`,
        });
      }
      await onAtualizado();
      onClose();
    } catch (e) {
      toast.error(mensagemDeErro(e, criar ? "criar as mesas" : "remover as mesas"));
    } finally {
      setOcupado(false);
    }
  };

  const previa = r.ok ? (criar ? mesasNovas(r.numeros, cadastradas).length : planejarRemocao(r.numeros, cadastradas, ocupadas).remover.length) : null;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Gerenciar mesas</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2">
            <Button variant={criar ? "default" : "outline"} onClick={() => setAba("criar")}>Criar</Button>
            <Button variant={!criar ? "default" : "outline"} onClick={() => setAba("remover")}>Remover</Button>
          </div>
          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <p className="text-sm font-semibold leading-tight">Faixa de números</p>
              <p className="text-xs text-muted-foreground">Ex.: 1 até 10</p>
            </div>
            <Switch checked={faixa} onCheckedChange={setFaixa} aria-label="Faixa de números" />
          </div>
          {faixa ? (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-sm">De</Label>
                <Input inputMode="numeric" value={de} onChange={(e) => setDe(e.target.value)} />
              </div>
              <div>
                <Label className="text-sm">Até</Label>
                <Input inputMode="numeric" value={ate} onChange={(e) => setAte(e.target.value)} />
              </div>
            </div>
          ) : (
            <div>
              <Label className="text-sm">Número da mesa</Label>
              <Input inputMode="numeric" value={numero} onChange={(e) => setNumero(e.target.value)} placeholder="Ex.: 5" />
            </div>
          )}
          {previa !== null && (
            <p className="text-xs text-muted-foreground">
              {criar ? `${previa} mesa(s) nova(s) serão criadas.` : `${previa} mesa(s) serão removidas. Mesa com atendimento aberto não é removida.`}
            </p>
          )}
          <Button className="w-full" onClick={enviar} disabled={ocupado || !r.ok}>
            {ocupado ? <Loader2 className="w-4 h-4 animate-spin" /> : `${criar ? "Criar" : "Remover"} ${faixa ? "faixa" : "mesa"}`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
