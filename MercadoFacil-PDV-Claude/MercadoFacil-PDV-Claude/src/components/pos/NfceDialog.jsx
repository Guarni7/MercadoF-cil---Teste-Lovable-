// Emissão de NFC-e a partir da venda.
//
// A versão anterior deste diálogo "emitia" a nota inteira no navegador: montava
// a chave de acesso com número aleatório, gravava status "emitida" e mostrava
// check verde — sem nunca falar com a SEFAZ. Nota nenhuma existia perante o
// fisco, mas o lojista via "NFC-e Emitida!".
//
// Agora quem decide o status é o autorizador. A tela pede a emissão, o servidor
// valida, calcula, numera, assina e transmite, e aqui só se mostra o que voltou
// — inclusive quando o que voltou é recusa.

import React, { useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Check, Clock, Download, FileText, Loader2, Printer, XCircle } from "lucide-react";
import { toast } from "sonner";
import { emitirDocumento, carregarConfigFiscal } from "@/lib/fiscalConfig";
import { api } from "@/api/dataClient";
import { saleNumberFull, saleNumberLabel } from "@/lib/saleNumber";
import { abrirNfceDanfePdf } from "@/lib/nfceDanfePdf";
import { baixarXmlNfce, MSG_XML_INDISPONIVEL, xmlDisponivel } from "@/lib/nfceXml";
import { podeTentarEmitirDeNovo } from "@/lib/acoesFiscaisVenda";

const APARENCIA = {
  authorized: {
    icone: Check,
    titulo: "NFC-e autorizada",
    caixa: "bg-emerald-50 border-emerald-200",
    circulo: "bg-emerald-100",
    texto: "text-emerald-700",
    detalhe: "text-emerald-600",
  },
  pending: {
    icone: Clock,
    titulo: "Aguardando o autorizador",
    caixa: "bg-amber-50 border-amber-200",
    circulo: "bg-amber-100",
    texto: "text-amber-700",
    detalhe: "text-amber-600",
  },
  rejected: {
    icone: XCircle,
    titulo: "NFC-e rejeitada",
    caixa: "bg-red-50 border-red-200",
    circulo: "bg-red-100",
    texto: "text-red-700",
    detalhe: "text-red-600",
  },
  error: {
    icone: AlertTriangle,
    titulo: "Não foi possível emitir",
    caixa: "bg-red-50 border-red-200",
    circulo: "bg-red-100",
    texto: "text-red-700",
    detalhe: "text-red-600",
  },
};

// Rótulos por ação. "emitir" é o fluxo da finalização; "reconciliar" e "reenviar" vêm do detalhe da
// venda no Gerenciador e usam o MESMO fiscal-emit (ele reconcilia sozinho um documento transmitting).
const TEXTOS_ACAO = {
  emitir: { titulo: "Emitir NFC-e", botao: "Emitir NFC-e", emitindo: "Emitindo...", aviso: null },
  reenviar: {
    titulo: "Reenviar NFC-e",
    botao: "Reenviar",
    emitindo: "Reenviando...",
    aviso: "A tentativa anterior não foi autorizada pela SEFAZ. Uma nova tentativa gera nova numeração.",
  },
  reconciliar: {
    titulo: "Reconciliar NFC-e",
    botao: "Reconciliar",
    emitindo: "Consultando a SEFAZ...",
    aviso: "A SEFAZ é consultada pela chave da nota que ficou em transmissão. Se ela estiver autorizada, o documento é atualizado, sem emitir outra nota.",
  },
};

export default function NfceDialog({ open, onClose, sale, customer, acao = "emitir" }) {
  const textos = TEXTOS_ACAO[acao] || TEXTOS_ACAO.emitir;
  const [emitindo, setEmitindo] = useState(false);
  const [resultado, setResultado] = useState(null);
  // Resultado da checagem de segurança (acoesFiscaisVenda.podeTentarEmitirDeNovo); null = nada a avisar.
  const [bloqueio, setBloqueio] = useState(null);
  // Trava síncrona: dois cliques seguidos chegam antes de `emitindo` re-renderizar e desabilitar o botão.
  const enviando = useRef(false);

  const emitir = async () => {
    if (enviando.current) return;
    // O servidor emite a partir da venda gravada, então precisa do UUID dela.
    // Venda offline ainda não sincronizada não tem.
    if (!sale?.id) {
      toast.error("Esta venda ainda não foi sincronizada. Emita a NFC-e depois que ela sincronizar.");
      return;
    }
    enviando.current = true;
    setEmitindo(true);
    try {
      // Tentativa anterior em estado incerto (a SEFAZ pode ter autorizado): não pede outra emissão ao
      // servidor, que criaria outra nota com outro número. Vale para a primeira emissão e para "Tentar
      // novamente", em qualquer tela que abra este diálogo.
      const seguranca = await podeTentarEmitirDeNovo(api, sale.id);
      if (!seguranca.permitido) {
        setBloqueio(seguranca);
        toast.error(seguranca.mensagem);
        return;
      }
      setBloqueio(null);
      // Série configurada para a NFC-e; o servidor é quem decide, e recusa se divergir.
      const config = await carregarConfigFiscal().catch(() => null);
      const resposta = await emitirDocumento({
        model: "65",
        saleId: sale?.id,
        series: Number(config?.nfce_series) || undefined,
      });
      setResultado(resposta);
      if (resposta?.status === "authorized") {
        toast.success(resposta.number != null ? `NFC-e ${resposta.number} autorizada pela SEFAZ` : "NFC-e autorizada pela SEFAZ");
      } else if (resposta?.status === "pending") {
        toast.info("Autorizador ainda está processando a nota");
      }
    } catch (e) {
      console.error("Falha na emissão da NFC-e:", e);
      const corpo = e.body || {};
      setResultado({
        status: corpo.status === "rejected" ? "rejected" : "error",
        document_id: corpo.document_id,
        code: corpo.code,
        message: e.message,
        details: corpo.details || null,
      });
      toast.error(e.message || "Não foi possível emitir a NFC-e");
      // O erro pode ter vindo depois do envio. Confere o documento gravado: se ficou incerto, o botão
      // de nova tentativa some e a tela mostra a chave para consulta.
      const seguranca = await podeTentarEmitirDeNovo(api, sale.id);
      if (seguranca.motivo === "incerto") setBloqueio(seguranca);
    } finally {
      enviando.current = false;
      setEmitindo(false);
    }
  };

  // O DANFE representa uma nota autorizada. Gerar cupom de documento que a
  // SEFAZ não autorizou entregaria ao cliente um papel sem valor fiscal, então
  // ele só existe depois do protocolo, e os dados vêm do que foi autorizado.
  const imprimirDanfe = async () => {
    try {
      const doc = await api.entities.FiscalDocument.get(resultado.document_id);
      if (doc?.status !== "authorized" || !doc?.xml_authorized) {
        toast.error("Documento autorizado ainda não disponível para o DANFE");
        return;
      }
      const settings = await carregarConfigFiscal();
      await abrirNfceDanfePdf({ document: doc, settings });
    } catch (e) {
      console.error("Falha ao gerar o DANFE:", e);
      toast.error(e.message || "Não foi possível gerar o DANFE");
    }
  };

  // XML autorizado completo (nfeProc) para o cliente e o contador, como <chave>.xml.
  const baixarXml = async () => {
    try {
      const doc = await api.entities.FiscalDocument.get(resultado.document_id);
      if (!xmlDisponivel(doc)) {
        toast.error(MSG_XML_INDISPONIVEL);
        return;
      }
      baixarXmlNfce(doc);
    } catch (e) {
      console.error("Falha ao baixar o XML da NFC-e:", e);
      toast.error(e.message || "Não foi possível baixar o XML");
    }
  };

  const fechar = () => {
    setResultado(null);
    setBloqueio(null);
    onClose();
  };

  const visual = resultado ? APARENCIA[resultado.status] || APARENCIA.error : null;
  const Icone = visual?.icone;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && fechar()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-primary" /> {textos.titulo}
          </DialogTitle>
          <DialogDescription>
            Nota Fiscal de Consumidor Eletrônica para a venda {saleNumberFull(sale)}
          </DialogDescription>
        </DialogHeader>

        {resultado ? (
          <div className="space-y-4">
            <div className={`flex flex-col items-center gap-3 p-6 rounded-lg border ${visual.caixa}`}>
              <div className={`w-14 h-14 rounded-full flex items-center justify-center ${visual.circulo}`}>
                <Icone className={`w-7 h-7 ${visual.detalhe}`} strokeWidth={2.5} />
              </div>
              <div className="text-center">
                <p className={`font-bold ${visual.texto}`}>{visual.titulo}</p>
                {resultado.status === "authorized" && resultado.number != null && (
                  <p className={`text-sm ${visual.detalhe}`}>
                    Nº {resultado.number} · Série {resultado.series}
                  </p>
                )}
                {resultado.code && (
                  <p className={`text-xs mt-1 ${visual.detalhe}`}>
                    Código do autorizador: {resultado.code}
                  </p>
                )}
              </div>
            </div>

            {resultado.status === "authorized" ? (
              <>
                <div className="rounded-lg border p-3 space-y-1.5 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Cliente</span>
                    <span className="font-medium">{customer?.name || "Consumidor final"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Total</span>
                    <span className="font-medium">R$ {(sale?.total || 0).toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between gap-4">
                    <span className="text-muted-foreground shrink-0">Protocolo</span>
                    <span className="font-mono text-xs truncate">{resultado.protocol}</span>
                  </div>
                </div>
                <Button onClick={imprimirDanfe} className="w-full gap-2">
                  <Printer className="w-4 h-4" /> Baixar DANFE NFC-e
                </Button>
                <Button onClick={baixarXml} variant="outline" className="w-full gap-2">
                  <Download className="w-4 h-4" /> Baixar XML
                </Button>
              </>
            ) : (
              <div className="rounded-lg border p-3 text-sm space-y-2">
                <p className="text-muted-foreground">{resultado.message}</p>
                {Array.isArray(resultado.details) && resultado.details.length > 0 && (
                  <ul className="list-disc pl-5 space-y-1 text-xs text-muted-foreground">
                    {resultado.details.map((d, i) => (
                      <li key={i}>{d.message || d.field || JSON.stringify(d)}</li>
                    ))}
                  </ul>
                )}
                <p className="text-xs text-muted-foreground">
                  A venda foi concluída normalmente. A nota não foi emitida e a
                  tentativa ficou registrada na trilha fiscal.
                </p>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-lg border p-4 space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Venda</span>
                <span className="font-medium">{saleNumberLabel(sale)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Cliente</span>
                <span className="font-medium">{customer?.name || "Consumidor final"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Total</span>
                <span className="font-medium">R$ {(sale?.total || 0).toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Itens</span>
                <span className="font-medium">{sale?.items?.length || 0}</span>
              </div>
            </div>

            {textos.aviso && (
              <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-xs text-amber-800">{textos.aviso}</div>
            )}
            <div className="rounded-lg bg-blue-50 border border-blue-200 p-3 text-xs text-blue-700">
              A nota é validada, numerada, assinada e transmitida pelo servidor. O
              resultado mostrado aqui é o que a SEFAZ responder — a nota só consta
              como autorizada com protocolo oficial.
            </div>
          </div>
        )}

        {bloqueio && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800">
            {bloqueio.mensagem}
            {bloqueio.chave && <span className="mt-1 block font-mono break-all select-all">{bloqueio.chave}</span>}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={fechar}>Fechar</Button>
          {(!resultado || resultado.status === "error") && bloqueio?.motivo !== "incerto" && (
            <Button onClick={emitir} disabled={emitindo} className="gap-2">
              {emitindo ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" /> {textos.emitindo}
                </>
              ) : (
                <>
                  <FileText className="w-4 h-4" /> {resultado ? "Tentar novamente" : textos.botao}
                </>
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
