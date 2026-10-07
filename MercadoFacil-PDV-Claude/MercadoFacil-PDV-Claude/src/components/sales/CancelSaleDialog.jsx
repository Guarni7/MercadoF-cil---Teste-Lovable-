// Confirmação de cancelamento da venda (e da NFC-e/NF-e, quando houver) no detalhe do Gerenciador.
//
// Antes, o botão Cancelar só mostrava "Cancelamento requer confirmação do administrador." e não
// iniciava nada. Agora há um modal de verdade, com a mesma regra do cancelamento da lista de Vendas
// (src/lib/saleCancellation.js): só administrador cancela documento fiscal, o motivo é obrigatório,
// a confirmação é explícita, e a venda e a nota só mudam depois que a SEFAZ autoriza o evento.
import React, { useEffect, useState } from "react";
import { AlertTriangle, Ban, Loader2, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/api/dataClient";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { bloqueioFiscalDaVenda, carregarConfigFiscal } from "@/lib/fiscalConfig";
import { analisarPrazoCancelamento, formatarDuracao, mensagemPrazoExpirado } from "@/lib/prazoCancelamento";
import { saleNumberFull } from "@/lib/saleNumber";
import {
  cancelarVendaCompleta,
  JUSTIFICATIVA_MAX,
  JUSTIFICATIVA_MIN,
  justificativaValida,
  podeCancelarDocumentoFiscal,
  vendaSincronizada,
  vendaTemDevolucao,
} from "@/lib/saleCancellation";

export default function CancelSaleDialog({ open, onClose, sale, onCancelled }) {
  const [carregando, setCarregando] = useState(false);
  const [pode, setPode] = useState(false);
  const [bloqueio, setBloqueio] = useState(null); // nota fiscal autorizada da venda, se houver
  const [temDevolucao, setTemDevolucao] = useState(false);
  const [erroVerificacao, setErroVerificacao] = useState(null);
  const [motivo, setMotivo] = useState("");
  const [ciente, setCiente] = useState(false);
  const [cancelando, setCancelando] = useState(false);
  const [uf, setUf] = useState(null); // UF do emitente: define o prazo de cancelamento da nota
  const [agora, setAgora] = useState(() => Date.now());

  useEffect(() => {
    if (!open || !sale) return undefined;
    let vivo = true;
    setMotivo("");
    setCiente(false);
    setBloqueio(null);
    setTemDevolucao(false);
    setErroVerificacao(null);
    setPode(false);
    setUf(null);
    setAgora(Date.now());
    if (!vendaSincronizada(sale)) return undefined;

    setCarregando(true);
    Promise.all([
      api.auth.me(),
      bloqueioFiscalDaVenda(sale.id),
      vendaTemDevolucao(sale),
      carregarConfigFiscal().catch(() => null), // sem a UF, não há bloqueio local de prazo: a SEFAZ decide
    ])
      .then(([usuario, fiscal, devolucao, config]) => {
        if (!vivo) return;
        setUf(config?.uf ?? null);
        setPode(podeCancelarDocumentoFiscal(usuario));
        setBloqueio(fiscal);
        setTemDevolucao(devolucao);
      })
      .catch((e) => {
        console.error("Falha ao verificar a venda para cancelamento:", e);
        if (vivo) setErroVerificacao("Não foi possível verificar a venda (nota fiscal e devoluções). Nada foi cancelado.");
      })
      .finally(() => vivo && setCarregando(false));
    return () => {
      vivo = false;
    };
  }, [open, sale]);

  // O prazo corre enquanto o modal está aberto (o usuário pode abrir no minuto 28 e confirmar no 31).
  useEffect(() => {
    if (!open || !bloqueio) return undefined;
    const t = setInterval(() => setAgora(Date.now()), 15_000);
    return () => clearInterval(t);
  }, [open, bloqueio]);

  if (!sale) return null;

  const tipoNota = bloqueio?.document?.model === "55" ? "NF-e" : "NFC-e";
  const titulo = bloqueio ? `Cancelar ${tipoNota}` : "Cancelar venda";
  const prazoDe = (instante) =>
    bloqueio
      ? analisarPrazoCancelamento({ uf, model: bloqueio.document.model, authorizedAt: bloqueio.document.authorized_at, agora: new Date(instante) })
      : null;
  const prazo = prazoDe(agora);
  const mensagemExpirado = (p) =>
    mensagemPrazoExpirado({ model: bloqueio.document.model, limiteMin: p.limiteMin, decorridoMin: p.decorridoMin });
  const semSincronizar = !vendaSincronizada(sale);
  const jaCancelada = sale.status === "cancelada";

  // O que impede de cancelar (e por quê). Enquanto houver um motivo aqui, o botão não faz nada.
  const impedimento = jaCancelada
    ? "Esta venda já está cancelada."
    : semSincronizar
      ? "Esta venda ainda não foi sincronizada. Cancele depois que ela sincronizar."
      : erroVerificacao
        ? erroVerificacao
        : temDevolucao
          ? "Esta venda já tem devolução registrada e não pode ser cancelada por inteiro. Devolva os itens restantes pela tela de devolução."
          : prazo?.expirado
            ? mensagemExpirado(prazo)
            : null;

  const motivoOk = !bloqueio || justificativaValida(motivo);
  const podeConfirmar = !carregando && !cancelando && pode && !impedimento && ciente && motivoOk;

  const confirmar = async () => {
    if (!podeConfirmar) return;
    // O relógio do modal anda a cada 15 s; confere de novo no instante do clique.
    const agoraExato = prazoDe(Date.now());
    if (agoraExato?.expirado) {
      setAgora(Date.now());
      toast.error(mensagemExpirado(agoraExato));
      return;
    }
    setCancelando(true);
    try {
      const { nota } = await cancelarVendaCompleta(sale, { justificativa: motivo, bloqueio });
      if (nota) toast.success(`${tipoNota} cancelada na SEFAZ (protocolo ${nota.protocolo}).`);
      toast.success("Venda cancelada.");
      onCancelled?.();
      onClose();
    } catch (e) {
      console.error("Falha ao cancelar a venda:", e);
      toast.error(e.message || "Erro ao cancelar venda.");
      // Nota já cancelada na SEFAZ mas venda não: a lista precisa refletir o que de fato mudou.
      if (e.notaCancelada) onCancelled?.();
    } finally {
      setCancelando(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && !cancelando && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-red-700">
            <Ban className="w-5 h-5" /> {titulo}
          </DialogTitle>
          <DialogDescription>Venda {saleNumberFull(sale)}</DialogDescription>
        </DialogHeader>

        {carregando ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
            <Loader2 className="w-4 h-4 animate-spin" /> Verificando a venda e a nota fiscal...
          </div>
        ) : (
          <div className="space-y-4 text-sm">
            {!pode && !semSincronizar && !jaCancelada && (
              <div className="flex gap-2 rounded-lg border border-red-200 bg-red-50 text-red-800 p-3">
                <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
                <span>
                  Somente administradores (proprietário ou administrador) podem cancelar uma venda com nota fiscal.
                  Nada foi cancelado. Peça a um administrador para fazer o cancelamento.
                </span>
              </div>
            )}

            {impedimento && (
              <div className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 text-amber-800 p-3">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{impedimento}</span>
              </div>
            )}

            {!impedimento && (
              <>
                <div className="rounded-lg border p-3 space-y-1.5 text-muted-foreground">
                  {bloqueio ? (
                    <>
                      <p>
                        Esta venda tem {tipoNota} autorizada pela SEFAZ (nº {bloqueio.document.number || "—"}). O sistema
                        cancela primeiro a nota na SEFAZ.
                      </p>
                      <p>
                        A venda só é cancelada, e o estoque só volta, <strong>depois que a SEFAZ autorizar o cancelamento</strong>.
                        Se a SEFAZ recusar, nada é cancelado.
                      </p>
                      <p>O cancelamento da nota na SEFAZ não pode ser desfeito.</p>
                      {prazo?.limiteMin != null && (
                        <p className={prazo.restanteMin < 5 ? "text-red-700 font-medium" : undefined}>
                          Prazo para cancelar: restam {prazo.restanteMin < 1 ? "menos de 1 min" : formatarDuracao(prazo.restanteMin)} (limite de {formatarDuracao(prazo.limiteMin)} após a autorização).
                        </p>
                      )}
                    </>
                  ) : (
                    <p>
                      Esta venda não tem nota fiscal autorizada. O cancelamento devolve os itens ao estoque e marca a venda
                      como cancelada.
                    </p>
                  )}
                </div>

                {bloqueio && (
                  <div className="space-y-1.5">
                    <Label htmlFor="motivo-cancelamento">
                      Motivo do cancelamento ({JUSTIFICATIVA_MIN} a {JUSTIFICATIVA_MAX} caracteres)
                    </Label>
                    <Textarea
                      id="motivo-cancelamento"
                      value={motivo}
                      onChange={(e) => setMotivo(e.target.value)}
                      maxLength={JUSTIFICATIVA_MAX}
                      rows={3}
                      disabled={!pode || cancelando}
                      placeholder="Ex.: erro na digitação do valor da venda"
                    />
                    <p className={`text-xs ${motivoOk ? "text-muted-foreground" : "text-red-600"}`}>
                      {motivo.trim().length}/{JUSTIFICATIVA_MIN} caracteres no mínimo
                    </p>
                  </div>
                )}

                <div className="flex items-start gap-2">
                  <Checkbox id="ciente-cancelamento" checked={ciente} onCheckedChange={(v) => setCiente(v === true)} disabled={!pode || cancelando} />
                  <Label htmlFor="ciente-cancelamento" className="leading-snug cursor-pointer">
                    {bloqueio
                      ? `Confirmo o cancelamento da ${tipoNota} e da venda ${saleNumberFull(sale)}.`
                      : `Confirmo o cancelamento da venda ${saleNumberFull(sale)}.`}
                  </Label>
                </div>
              </>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={cancelando}>
            Voltar
          </Button>
          <Button variant="destructive" onClick={confirmar} disabled={!podeConfirmar} className="gap-2">
            {cancelando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Ban className="w-4 h-4" />}
            {bloqueio ? `Confirmar cancelamento da ${tipoNota}` : "Confirmar cancelamento"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
