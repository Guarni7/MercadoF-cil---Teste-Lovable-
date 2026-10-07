import React, { useEffect, useRef, useState } from "react";
import {
  Calendar,
  User,
  UserCircle,
  Pencil,
  ChevronDown,
  ChevronUp,
  Package,
  Wallet,
  MessageCircle,
  Mail,
  Printer,
  Ban,
  Download,
  RefreshCw,
  Send,
} from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { formatBRL, formatDateTime } from "@/lib/format";
import { saleNumberFull } from "@/lib/saleNumber";
import { toast } from "sonner";
import SendWhatsAppDialog from "@/components/sales/SendWhatsAppDialog";
import SendEmailDialog from "@/components/sales/SendEmailDialog";
import ItemFiscalDialog from "@/components/sales/ItemFiscalDialog";
import CancelSaleDialog from "@/components/sales/CancelSaleDialog";
import { api } from "@/api/dataClient";
import NfceDialog from "@/components/pos/NfceDialog";
import { baixarXmlNfce, MSG_XML_INDISPONIVEL, xmlDisponivel } from "@/lib/nfceXml";
import { ACAO_FISCAL, analisarNfceDaVenda, avisoNfceDaVenda, buscarDocumentosNfceDaVenda, mensagemBloqueioDesfazer, rotuloAcaoFiscal, vendaSincronizada } from "@/lib/acoesFiscaisVenda";
import { abrirNfceDanfePdf } from "@/lib/nfceDanfePdf";
import { printSaleReceipt } from "@/lib/saleReceipt";
import { avisoDaReimpressao, MSG_FALHA_IMPRESSAO } from "@/lib/reimpressaoVenda";
import { carregarConfigFiscal } from "@/lib/fiscalConfig";
import { analisarPrazoCancelamento, dicaPrazoExpirado } from "@/lib/prazoCancelamento";
import { mensagemDeErro } from "@/lib/mensagemErro";

const methodLabels = {
  dinheiro: "Dinheiro",
  pix: "PIX",
  credito: "Crédito",
  debito: "Débito",
  crediario: "Crediário",
};

export default function SaleDetailDialog({ open, onClose, sale, customers = [], onCancelled }) {
  const [itemsOpen, setItemsOpen] = useState(true);
  const [whatsappOpen, setWhatsappOpen] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);
  const [fiscalItem, setFiscalItem] = useState(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  // Documentos fiscais (NFC-e) REAIS da venda, em qualquer status: decidem qual ação fiscal aparece.
  // Quando autorizado, o botão diz "Cancelar NFC-e" em vez de "Cancelar venda" e fica desabilitado
  // quando o prazo de cancelamento da nota (30 min em GO) já passou.
  const [fiscalDocs, setFiscalDocs] = useState([]);
  const [nfceAberta, setNfceAberta] = useState(false); // NfceDialog (emitir / reenviar / reconciliar)
  const [imprimindo, setImprimindo] = useState(false);
  const imprimindoRef = useRef(false); // trava síncrona: dois cliques chegam antes do re-render do botão
  const [uf, setUf] = useState(null);
  const [nfceHab, setNfceHab] = useState(false);
  const [configFiscal, setConfigFiscal] = useState(null);
  const [fiscalCarregando, setFiscalCarregando] = useState(true); // documentos e configuração fiscal ainda sendo lidos
  const [configFalhou, setConfigFalhou] = useState(false); // a leitura da configuração fiscal deu erro (≠ NFC-e desligada)
  const [agora, setAgora] = useState(() => Date.now());

  const [recarga, setRecarga] = useState(0);

  useEffect(() => {
    setFiscalDocs([]);
    setUf(null);
    setNfceHab(false);
    setConfigFiscal(null);
    setConfigFalhou(false);
    setFiscalCarregando(true);
    if (!open || !sale?.id) return undefined;
    let vivo = true;
    setAgora(Date.now());
    Promise.all([
      buscarDocumentosNfceDaVenda(api, sale.id),
      carregarConfigFiscal().catch((e) => {
        console.error("Falha ao carregar a configuração fiscal:", e);
        return { __falhou: true };
      }),
    ])
      .then(([docs, config]) => {
        if (!vivo) return;
        const falhou = !!config?.__falhou;
        setFiscalDocs(docs);
        setConfigFalhou(falhou);
        setConfigFiscal(falhou ? null : config);
        setUf(falhou ? null : (config?.uf ?? null));
        setNfceHab(!falhou && !!config?.nfce_enabled);
        setFiscalCarregando(false);
      })
      .catch((e) => {
        console.error("Falha ao consultar a NFC-e da venda:", e);
        if (!vivo) return;
        setConfigFalhou(true); // sem ler os documentos não dá para afirmar nada sobre a NFC-e
        setFiscalCarregando(false);
      });
    return () => {
      vivo = false;
    };
  }, [open, sale?.id, recarga]);

  // Qual ação (e qual documento) vale: olha todas as tentativas, não só a última.
  const analise = analisarNfceDaVenda(fiscalDocs, sale, { nfceHabilitada: nfceHab });
  const avisoFiscal = avisoNfceDaVenda(analise, { sale, config: configFiscal, configFalhou, carregando: fiscalCarregando });
  const emissaoAguardaSync = analise.acao === ACAO_FISCAL.EMITIR && !vendaSincronizada(sale); // não oferece emitir venda que o servidor ainda não conhece
  const fiscalDoc = analise.doc;
  const acaoFiscal = analise.acao;
  const nfceDoc = fiscalDoc?.status === "authorized" ? fiscalDoc : null;
  // NFC-e sem resolução (error incerto, transmitting, em andamento): a SEFAZ pode autorizar. Não cancela venda nem nota.
  const bloqueioFiscal = mensagemBloqueioDesfazer(acaoFiscal);

  // O prazo vence com o diálogo aberto: reavalia a cada 30 s.
  useEffect(() => {
    if (!open || !nfceDoc) return undefined;
    const t = setInterval(() => setAgora(Date.now()), 30_000);
    return () => clearInterval(t);
  }, [open, nfceDoc]);

  if (!sale) return null;

  const prazoNota = nfceDoc
    ? analisarPrazoCancelamento({ uf, model: nfceDoc.model, authorizedAt: nfceDoc.authorized_at, agora: new Date(agora) })
    : null;
  const dicaDoPrazo = prazoNota?.expirado ? dicaPrazoExpirado({ model: nfceDoc.model, limiteMin: prazoNota.limiteMin, authorizedAt: nfceDoc.authorized_at }) : "";

  const items = sale.items || [];
  const customer = sale.customer_name && sale.customer_name !== "Consumidor"
    ? sale.customer_name
    : null;

  const handleWhatsApp = () => setWhatsappOpen(true);
  const handleEmail = () => setEmailOpen(true);
  // Reimprime o cupom da venda com o mesmo printSaleReceipt do PDV (Electron: silencioso, na impressora
  // configurada; navegador: janela de impressão). Só diz que foi enviado quando a impressão confirma;
  // no navegador não há como saber se o operador imprimiu, então avisa apenas que a janela abriu.
  // O DANFE da NFC-e é outro botão (Reimprimir DANFE) e não passa por aqui.
  const handleReprint = async () => {
    if (imprimindoRef.current) return;
    imprimindoRef.current = true;
    setImprimindo(true);
    try {
      const resultado = await printSaleReceipt({ sale, customer: customer ? { name: customer } : null });
      const aviso = avisoDaReimpressao(resultado);
      ({ sucesso: toast.success, info: toast.info, erro: toast.error })[aviso.tipo](aviso.mensagem);
    } catch (e) {
      console.error("Falha ao reimprimir o cupom:", e);
      toast.error(mensagemDeErro(e, "imprimir o cupom", { fallback: MSG_FALHA_IMPRESSAO }));
    } finally {
      imprimindoRef.current = false;
      setImprimindo(false);
    }
  };
  // O cancelamento de verdade (confirmação, motivo, papel de administrador e SEFAZ) fica no CancelSaleDialog.
  const handleCancel = () => setCancelOpen(true);

  const rotuloFiscal = rotuloAcaoFiscal(acaoFiscal);

  // XML autorizado (nfeProc) guardado no documento: o mesmo helper da finalização, sem montar nada aqui.
  const handleBaixarXml = () => {
    try {
      baixarXmlNfce(fiscalDoc);
    } catch (e) {
      toast.error(e.message || MSG_XML_INDISPONIVEL);
    }
  };

  const handleDanfe = async () => {
    try {
      const settings = await carregarConfigFiscal();
      await abrirNfceDanfePdf({ document: fiscalDoc, settings });
    } catch (e) {
      console.error("Falha ao gerar o DANFE:", e);
      toast.error(e.message || "Não foi possível gerar o DANFE");
    }
  };

  const fecharNfce = () => {
    setNfceAberta(false);
    setRecarga((n) => n + 1); // o resultado (autorizada, rejeitada...) muda o botão
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl p-0 overflow-hidden gap-0" style={{ background: "#f8f9fa" }}>
        {/* Header */}
        <div className="px-5 py-4 bg-white border-b">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold text-[#212529]">Venda {saleNumberFull(sale)}</h2>
            {/* O X de fechar é o do próprio DialogContent (canto superior direito); um segundo X aqui ficava por cima dele. */}
          </div>
          <div className="flex items-center gap-4 mt-2 text-sm text-[#212529]">
            <span className="flex items-center gap-1.5">
              <Calendar className="w-4 h-4 text-muted-foreground" /> {formatDateTime(sale.created_date)}
            </span>
            <span className="flex items-center gap-1.5">
              <User className="w-4 h-4 text-muted-foreground" /> {sale.created_by_name || "Vendedor"}
            </span>
          </div>
        </div>

        <div className="px-5 py-4 space-y-4">
          {/* Customer */}
          <div className="bg-white rounded-lg border p-3 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <UserCircle className="w-8 h-8 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium text-[#212529]">{customer || "Consumidor não identificado"}</p>
                <p className="text-xs text-muted-foreground">{sale.customer_document || "Sem CPF/CNPJ"}</p>
              </div>
            </div>
            <button className="text-muted-foreground hover:text-foreground">
              <Pencil className="w-4 h-4" />
            </button>
          </div>

          {/* Items */}
          <div className="bg-white rounded-lg border overflow-hidden">
            <div className="flex items-center justify-between px-3 py-2.5 border-b">
              <h3 className="text-xs font-semibold text-[#212529] tracking-wide flex items-center gap-1.5">
                <Package className="w-3.5 h-3.5" /> ITENS {items.length}
              </h3>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={() => setItemsOpen(!itemsOpen)}
              >
                {itemsOpen ? (
                  <><ChevronUp className="w-3.5 h-3.5" /> Recolher</>
                ) : (
                  <><ChevronDown className="w-3.5 h-3.5" /> Expandir</>
                )}
              </Button>
            </div>
            {itemsOpen && (
              <table className="w-full text-xs">
                <thead className="bg-[#006d77] text-white">
                  <tr>
                    <th className="px-2 py-2 text-left font-medium">CÓDIGO</th>
                    <th className="px-2 py-2 text-left font-medium">PRODUTO</th>
                    <th className="px-2 py-2 text-left font-medium">NCM</th>
                    <th className="px-2 py-2 text-left font-medium">CFOP</th>
                    <th className="px-2 py-2 text-left font-medium">CSOSN</th>
                    <th className="px-2 py-2 text-right font-medium">PR. UNIT</th>
                    <th className="px-2 py-2 text-right font-medium">QTD</th>
                    <th className="px-2 py-2 text-right font-medium">TOTAL</th>
                    <th className="px-1 py-2 w-8"></th>
                  </tr>
                </thead>
                <tbody>
                  {items.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="px-2 py-4 text-center text-muted-foreground bg-[#fdfbf7]">
                        Sem itens
                      </td>
                    </tr>
                  ) : (
                    items.map((item, idx) => (
                      <tr key={idx} className="border-t bg-[#fdfbf7]">
                        <td className="px-2 py-2 text-muted-foreground">{item.code || "—"}</td>
                        <td className="px-2 py-2 font-medium text-[#212529]">{item.name || "—"}</td>
                        <td className="px-2 py-2 text-muted-foreground">{item.ncm || "—"}</td>
                        <td className="px-2 py-2 text-muted-foreground">{item.cfop || "—"}</td>
                        <td className="px-2 py-2 text-muted-foreground">{item.csosn || "—"}</td>
                        <td className="px-2 py-2 text-right">{formatBRL(item.price || 0)}</td>
                        <td className="px-2 py-2 text-right">{item.quantity || 0}</td>
                        <td className="px-2 py-2 text-right font-medium">{formatBRL(item.total || 0)}</td>
                        <td className="px-1 py-2 text-center">
                          <button
                            className="text-muted-foreground hover:text-foreground"
                            onClick={(e) => { e.stopPropagation(); setFiscalItem(item); }}
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            )}
          </div>

          {/* Payment */}
          <div className="bg-white rounded-lg border p-3">
            <h3 className="text-xs font-semibold text-[#212529] tracking-wide flex items-center gap-1.5 mb-2">
              <Wallet className="w-3.5 h-3.5" /> PAGAMENTO
            </h3>
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm text-[#212529]">
                <span className="text-muted-foreground">{methodLabels[sale.payment_method] || sale.payment_method}</span>
                <span>{formatBRL(sale.total)}</span>
              </div>
              <div className="flex items-center justify-between pt-2 border-t">
                <span className="font-semibold text-[#212529]">Total</span>
                <span className="font-bold text-[#006d77] text-lg">{formatBRL(sale.total)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Footer actions */}
        <div className="px-5 py-3 bg-white border-t flex items-center gap-2 flex-wrap">
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 border-green-400 text-green-600 hover:bg-green-50 hover:text-green-600"
            onClick={handleWhatsApp}
          >
            <MessageCircle className="w-4 h-4" /> WhatsApp
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 border-blue-400 text-blue-600 hover:bg-blue-50 hover:text-blue-600"
            onClick={handleEmail}
          >
            <Mail className="w-4 h-4" /> E-mail
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 border-gray-400 text-gray-600 hover:bg-gray-50 hover:text-gray-600"
            onClick={handleReprint}
            disabled={imprimindo}
          >
            <Printer className="w-4 h-4" /> Reimprimir
          </Button>
          {rotuloFiscal && (
            <Button
              size="sm"
              className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white"
              onClick={() => setNfceAberta(true)}
              disabled={emissaoAguardaSync}
              title={emissaoAguardaSync ? avisoFiscal?.mensagem : undefined}
            >
              {acaoFiscal === ACAO_FISCAL.RECONCILIAR ? <RefreshCw className="w-4 h-4" /> : <Send className="w-4 h-4" />} {rotuloFiscal}
            </Button>
          )}
          {avisoFiscal && (
            <div className="basis-full rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800" role="status" data-testid="aviso-nfce">
              {avisoFiscal.mensagem}
              {avisoFiscal.podeTentarDeNovo && (
                <button type="button" className="ml-2 font-medium underline" onClick={() => setRecarga((n) => n + 1)}>
                  Tentar novamente
                </button>
              )}
            </div>
          )}
          {acaoFiscal === ACAO_FISCAL.CONSULTAR && (
            <div className="basis-full rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800">
              Estado fiscal incerto: a tentativa anterior terminou em erro depois do envio e a SEFAZ pode ter autorizado a nota.
              Não reenvie. Consulte a chave no portal da SEFAZ e fale com o suporte.
              {analise.chave && <span className="mt-1 block font-mono break-all select-all">{analise.chave}</span>}
            </div>
          )}
          {acaoFiscal === ACAO_FISCAL.EM_ANDAMENTO && (
            <span className="text-xs text-amber-700 self-center">NFC-e em andamento na SEFAZ. Aguarde a resposta.</span>
          )}
          {acaoFiscal === ACAO_FISCAL.AUTORIZADA && (
            <>
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 border-emerald-500 text-emerald-700 hover:bg-emerald-50 hover:text-emerald-700"
                onClick={handleBaixarXml}
                disabled={!xmlDisponivel(fiscalDoc)}
                title={xmlDisponivel(fiscalDoc) ? "Baixar o XML autorizado (nfeProc)" : MSG_XML_INDISPONIVEL}
              >
                <Download className="w-4 h-4" /> Baixar XML
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 border-gray-400 text-gray-600 hover:bg-gray-50 hover:text-gray-600"
                onClick={handleDanfe}
              >
                <Printer className="w-4 h-4" /> Reimprimir DANFE
              </Button>
            </>
          )}
          {sale.status !== "cancelada" && (
            // Ação fiscal e destrutiva: afastada das demais, em vermelho cheio e com ícone de proibido
            // (não um X, que o usuário confunde com o fechar da janela).
            <Button
              variant="destructive"
              size="sm"
              className="gap-1.5 ml-auto"
              onClick={handleCancel}
              disabled={!!prazoNota?.expirado || !!bloqueioFiscal}
              title={bloqueioFiscal || (prazoNota?.expirado ? dicaDoPrazo : undefined)}
            >
              <Ban className="w-4 h-4" /> {nfceDoc ? "Cancelar NFC-e" : "Cancelar venda"}
            </Button>
          )}
          {sale.status !== "cancelada" && bloqueioFiscal && (
            <span className="basis-full text-right text-xs text-red-600">{bloqueioFiscal}</span>
          )}
          {sale.status !== "cancelada" && prazoNota?.expirado && (
            <span className="basis-full text-right text-xs text-red-600">{dicaDoPrazo}. Fale com o seu contador.</span>
          )}
        </div>
      </DialogContent>

      <SendWhatsAppDialog
        open={whatsappOpen}
        onClose={() => setWhatsappOpen(false)}
        sale={sale}
        customers={customers}
      />
      <SendEmailDialog
        open={emailOpen}
        onClose={() => setEmailOpen(false)}
        sale={sale}
      />
      <ItemFiscalDialog
        open={!!fiscalItem}
        onClose={() => setFiscalItem(null)}
        item={fiscalItem}
      />
      <NfceDialog
        open={nfceAberta}
        onClose={fecharNfce}
        sale={sale}
        customer={null}
        acao={acaoFiscal === ACAO_FISCAL.EMITIR || !rotuloFiscal ? "emitir" : acaoFiscal}
      />
      <CancelSaleDialog
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        sale={sale}
        onCancelled={() => {
          setCancelOpen(false);
          onCancelled?.();
        }}
      />
    </Dialog>
  );
}