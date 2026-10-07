import React, { useState, useEffect } from "react";
import { api } from "@/api/dataClient";
import { Receipt, Ban, Eye, Download } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatBRL, formatDateTime } from "@/lib/format";
import { loadSales } from "@/lib/dataLayer";
import { isSaleNumberPending, saleNumberFull, saleNumberLabel } from "@/lib/saleNumber";
import { bloqueioFiscalDaVenda } from "@/lib/fiscalConfig";
import { cancelarVendaCompleta, prazoDaNotaFiscal, vendaTemDevolucao } from "@/lib/saleCancellation";
import { toast } from "sonner";
import { baixarXmlNfce, buscarNfceAutorizadaDaVenda, MSG_XML_INDISPONIVEL, xmlDisponivel } from "@/lib/nfceXml";

const methodLabels = {
  dinheiro: "Dinheiro",
  pix: "PIX",
  credito: "Crédito",
  debito: "Débito",
  crediario: "Crediário",
};

export default function Sales() {
  const [sales, setSales] = useState([]);
  const [loading, setLoading] = useState(true);
  const [viewSale, setViewSale] = useState(null);
  // NFC-e autorizada da venda aberta (null = não tem), para o botão "Baixar XML".
  const [nfceDaVenda, setNfceDaVenda] = useState(null);

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    setNfceDaVenda(null);
    if (!viewSale?.id) return undefined;
    let vivo = true;
    buscarNfceAutorizadaDaVenda(api, viewSale.id)
      .then((doc) => vivo && setNfceDaVenda(doc))
      .catch((e) => console.error("Falha ao consultar a NFC-e da venda:", e));
    return () => {
      vivo = false;
    };
  }, [viewSale?.id]);

  const loadData = async () => {
    try {
      setSales(await loadSales(200));
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = async (sale) => {
    // Venda com devolução registrada não é cancelada por inteiro (ver vendaTemDevolucao). Vem antes
    // de qualquer efeito (nota fiscal, estoque, status).
    try {
      if (await vendaTemDevolucao(sale)) {
        toast.error("Esta venda já tem devolução registrada e não pode ser cancelada por inteiro. Devolva os itens restantes pela tela de devolução.");
        return;
      }
    } catch (e) {
      console.error("Falha ao verificar devoluções da venda:", e);
      toast.error("Não foi possível verificar as devoluções desta venda. Cancelamento não realizado.");
      return;
    }
    if (!confirm(`Cancelar venda ${saleNumberLabel(sale)}?`)) return;
    try {
      // Venda com NFC-e/NF-e autorizada: cancela a nota na SEFAZ primeiro (evento 110111) — cancelar
      // só a venda aqui deixaria o imposto declarado em pé para uma venda que o sistema já trata como
      // desfeita. Só segue para estoque/status se a SEFAZ confirmar o cancelamento. A lógica é a mesma
      // do detalhe da venda no Gerenciador (src/lib/saleCancellation.js).
      const bloqueio = await bloqueioFiscalDaVenda(sale.id);
      let justificativa = null;
      if (bloqueio) {
        // Passou o prazo de cancelamento da nota (NFC-e: 30 min em GO)? Não pede motivo de algo que não cabe.
        const prazo = await prazoDaNotaFiscal(bloqueio);
        if (prazo.expirado) {
          toast.error(prazo.mensagem);
          return;
        }
        justificativa = prompt(
          `${bloqueio.message}

Digite o motivo do cancelamento (mín. 15 caracteres) para cancelar a nota na SEFAZ:`
        );
        if (!justificativa) return;
      }

      const { nota } = await cancelarVendaCompleta(sale, { justificativa, bloqueio });
      if (nota) toast.success(`Nota fiscal cancelada na SEFAZ (protocolo ${nota.protocolo}).`);
      toast.success("Venda cancelada.");
      loadData();
    } catch (e) {
      console.error(e);
      toast.error(e.message || "Erro ao cancelar venda.");
      if (e.notaCancelada) loadData();
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="w-8 h-8 border-4 border-muted border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-4 lg:p-8">
      <div className="mb-6">
        <h1 className="text-2xl lg:text-3xl font-heading font-bold">Vendas</h1>
        <p className="text-muted-foreground text-sm mt-1">Histórico de vendas</p>
      </div>

      {sales.length === 0 ? (
        <Card className="p-12 text-center text-muted-foreground">
          <Receipt className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p>Nenhuma venda registrada.</p>
        </Card>
      ) : (
        <div className="space-y-2">
          {sales.map((sale) => (
            <Card key={sale.id} className="p-4 flex items-center gap-4">
              <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                <Receipt className="w-5 h-5 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold">{saleNumberLabel(sale)}</span>
                  {isSaleNumberPending(sale) && (
                    <Badge variant="outline" className="text-xs">
                      Aguardando sincronizar
                    </Badge>
                  )}
                  <Badge
                    variant={sale.status === "concluida" ? "default" : "destructive"}
                    className="text-xs"
                  >
                    {sale.status === "concluida" ? "Concluída" : "Cancelada"}
                  </Badge>
                </div>
                <div className="text-sm text-muted-foreground truncate">
                  {formatDateTime(sale.created_date)} ·{" "}
                  {sale.customer_name || "Consumidor"} ·{" "}
                  {methodLabels[sale.payment_method] || sale.payment_method}
                </div>
              </div>
              <div className="text-right">
                <div
                  className={`font-bold ${
                    sale.status === "cancelada"
                      ? "line-through text-muted-foreground"
                      : ""
                  }`}
                >
                  {formatBRL(sale.total)}
                </div>
              </div>
              <div className="flex gap-1">
                <button
                  onClick={() => setViewSale(sale)}
                  className="p-2 rounded-md hover:bg-muted"
                >
                  <Eye className="w-4 h-4" />
                </button>
                {sale.status === "concluida" && (
                  <button
                    onClick={() => handleCancel(sale)}
                    className="p-2 rounded-md hover:bg-destructive/10 hover:text-destructive"
                  >
                    <Ban className="w-4 h-4" />
                  </button>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={!!viewSale} onOpenChange={(v) => !v && setViewSale(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Venda {saleNumberFull(viewSale)}</DialogTitle>
          </DialogHeader>
          {viewSale && (
            <div className="space-y-3">
              <div className="text-sm text-muted-foreground">
                {formatDateTime(viewSale.created_date)}
              </div>
              <div className="border rounded-lg divide-y">
                {viewSale.items?.map((item, i) => (
                  <div key={i} className="flex justify-between p-2 text-sm">
                    <span>
                      {item.quantity}x {item.name}
                    </span>
                    <span className="font-medium">{formatBRL(item.total)}</span>
                  </div>
                ))}
              </div>
              <div className="space-y-1 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Subtotal</span>
                  <span>{formatBRL(viewSale.subtotal)}</span>
                </div>
                {viewSale.discount > 0 && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Desconto</span>
                    <span>-{formatBRL(viewSale.discount)}</span>
                  </div>
                )}
                <div className="flex justify-between font-bold text-lg pt-1 border-t">
                  <span>Total</span>
                  <span className="text-primary">{formatBRL(viewSale.total)}</span>
                </div>
              </div>
              <div className="text-sm space-y-1">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Pagamento</span>
                  <span>{methodLabels[viewSale.payment_method]}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Cliente</span>
                  <span>{viewSale.customer_name || "Consumidor"}</span>
                </div>
                {viewSale.change > 0 && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Troco</span>
                    <span>{formatBRL(viewSale.change)}</span>
                  </div>
                )}
              </div>
              {nfceDaVenda && (
                <div className="flex items-center justify-between gap-3 rounded-lg border p-2 text-sm">
                  <span>NFC-e autorizada nº {nfceDaVenda.number}</span>
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-2"
                    disabled={!xmlDisponivel(nfceDaVenda)}
                    title={xmlDisponivel(nfceDaVenda) ? "Baixar o XML autorizado" : MSG_XML_INDISPONIVEL}
                    onClick={() => baixarXmlNfce(nfceDaVenda)}
                  >
                    <Download className="w-4 h-4" /> Baixar XML
                  </Button>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}