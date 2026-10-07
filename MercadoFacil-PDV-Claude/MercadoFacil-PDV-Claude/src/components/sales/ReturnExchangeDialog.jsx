import React, { useState, useEffect, useRef } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Undo2, Search, ArrowLeft, Loader2, AlertTriangle } from "lucide-react";
import { api } from "@/api/dataClient";
import { formatBRL, formatDateTime, roundMoney } from "@/lib/format";
import { saleNumberLabel } from "@/lib/saleNumber";
import { logActivity } from "@/lib/activityLog";
import { bloqueioFiscalDaVenda, cancelarDocumento } from "@/lib/fiscalConfig";
import { ACAO_FISCAL, MSG_DEVOLUCAO_BLOQUEADA, MSG_FISCAL_NAO_VERIFICADO, estadoFiscalImpedeDesfazer } from "@/lib/acoesFiscaisVenda";
import { prazoDaNotaFiscal } from "@/lib/saleCancellation";
import { toast } from "sonner";
import { crediarioRestanteDaVenda } from "@/lib/crediario";

const REFUND_METHODS = [
  { value: "dinheiro", label: "Dinheiro" },
  { value: "pix", label: "PIX" },
  { value: "credito", label: "Crédito" },
  { value: "debito", label: "Débito" },
  { value: "crediario", label: "Crediário" },
];

const METHOD_LABELS = {
  dinheiro: "Dinheiro",
  pix: "PIX",
  credito: "Crédito",
  debito: "Débito",
  crediario: "Crediário",
};

/**
 * Métodos sem nenhum estorno automático real (cartão/TEF/PIX não têm
 * integração de estorno implementada) — o sistema só registra que o valor
 * PRECISA ser estornado por fora, nunca finge que aconteceu.
 */
const MANUAL_REFUND_METHODS = new Set(["pix", "credito", "debito"]);

export default function ReturnExchangeDialog({ open, onClose }) {
  const [customerName, setCustomerName] = useState("");
  const [saleNumber, setSaleNumber] = useState("");
  const [startDate, setStartDate] = useState(new Date().toISOString().split("T")[0]);
  const [endDate, setEndDate] = useState(new Date().toISOString().split("T")[0]);
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  // Etapa 2: itens da venda selecionada, disponíveis para devolução.
  const [selectedSale, setSelectedSale] = useState(null);
  const [loadingSale, setLoadingSale] = useState(false);
  const [balances, setBalances] = useState({}); // product_id -> { name, unitNet, sold, returned, available }
  const [selection, setSelection] = useState({}); // product_id -> quantity a devolver
  const [priorReturns, setPriorReturns] = useState([]); // devoluções já registradas desta venda
  const [fiscalBlock, setFiscalBlock] = useState(null); // { document, message } quando há NFC-e/NF-e autorizada
  // NFC-e sem resolução (incerta, em transmissão ou em andamento) ou status fiscal não verificado: { mensagem, chave }.
  const [estadoFiscal, setEstadoFiscal] = useState(null);
  const submetendo = useRef(false);

  // Confere o estado fiscal REAL da venda. Sem conseguir ler, bloqueia: devolver devolve estoque e dinheiro.
  const conferirEstadoFiscal = async (saleId) => {
    try {
      const r = await estadoFiscalImpedeDesfazer(api, saleId);
      // O texto do estado incerto fala em "cancelar esta venda"; aqui a operação é devolver ou trocar.
      const mensagem = r.acao === ACAO_FISCAL.CONSULTAR ? MSG_DEVOLUCAO_BLOQUEADA : r.mensagem;
      const bloqueio = r.bloqueado ? { mensagem, chave: r.chave } : null;
      setEstadoFiscal(bloqueio);
      return bloqueio;
    } catch (e) {
      console.error("Falha ao verificar o status fiscal da venda:", e);
      const bloqueio = { mensagem: MSG_FISCAL_NAO_VERIFICADO, chave: null };
      setEstadoFiscal(bloqueio);
      return bloqueio;
    }
  };
  const [reason, setReason] = useState("");
  const [refundMethod, setRefundMethod] = useState("dinheiro");
  const [submitting, setSubmitting] = useState(false);

  const handleSearch = async () => {
    setLoading(true);
    try {
      const data = await api.entities.Sale.list("-created_date", 500);
      const start = new Date(startDate + "T00:00:00").getTime();
      const end = new Date(endDate + "T23:59:59").getTime();
      let filtered = data.filter((s) => {
        const t = new Date(s.created_date).getTime();
        return t >= start && t <= end && s.status === "concluida";
      });
      if (customerName) {
        filtered = filtered.filter((s) =>
          (s.customer_name || "").toLowerCase().includes(customerName.toLowerCase())
        );
      }
      if (saleNumber) {
        filtered = filtered.filter((s) => String(s.number) === saleNumber);
      }
      setResults(filtered);
      setSearched(true);
    } catch (e) {
      console.error(e);
      toast.error("Erro ao buscar vendas.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) {
      setResults([]);
      setSearched(false);
      setSelectedSale(null);
      setSelection({});
      setPriorReturns([]);
      setFiscalBlock(null);
      setEstadoFiscal(null);
      setReason("");
      setRefundMethod("dinheiro");
    }
  }, [open]);

  /**
   * O saldo disponível por produto (vendido - já devolvido) é calculado aqui
   * a partir das devoluções já registradas, só para guiar a tela — o banco
   * (trigger sale_returns_validate) confere a mesma conta de novo na hora de
   * gravar, então um saldo desatualizado nesta tela nunca deixa devolver a
   * mais, só mostra o erro do servidor.
   */
  const selectSale = async (sale) => {
    setLoadingSale(true);
    setSelectedSale(sale);
    try {
      // Venda com NFC-e/NF-e autorizada: a nota precisa ser cancelada na
      // SEFAZ (evento 110111) antes da devolução valer — guardado aqui para
      // avisar cedo e para handleSubmit cancelar a nota antes de mexer em
      // estoque/financeiro. Item de devolução continua sendo escolhido
      // normalmente; o motivo digitado abaixo (reason) também serve de
      // justificativa do cancelamento fiscal.
      setFiscalBlock(await bloqueioFiscalDaVenda(sale.id));
      await conferirEstadoFiscal(sale.id);

      const returns = await api.entities.SaleReturn.filter({ sale_id: sale.id }, "-created_date", 200);
      setPriorReturns(returns);
      const returnedByProduct = {};
      for (const ret of returns) {
        for (const item of ret.items || []) {
          const pid = item.product_id;
          if (!pid) continue;
          returnedByProduct[pid] = (returnedByProduct[pid] || 0) + Number(item.quantity || 0);
        }
      }

      const nextBalances = {};
      for (const item of sale.items || []) {
        // sem product_id (ex. avulso) não tem como restaurar estoque; almoço por peso (mesa) leva o produto fiscal só para a nota
        if (!item.product_id || item.origem === "almoco_peso") continue;
        const sold = Number(item.quantity || 0);
        const alreadyReturned = returnedByProduct[item.product_id] || 0;
        const unitNet = sold > 0 ? Number(item.total || 0) / sold : 0;
        nextBalances[item.product_id] = {
          name: item.name,
          unitNet,
          sold,
          returned: alreadyReturned,
          available: Math.max(0, sold - alreadyReturned),
        };
      }
      setBalances(nextBalances);
      setSelection({});
      // Pré-seleciona a forma de estorno com o método da venda original —
      // não é uma suposição arriscada: é só o valor inicial do campo, o
      // operador escolhe livremente antes de confirmar.
      setRefundMethod(sale.payment_method || "dinheiro");
    } catch (e) {
      console.error(e);
      toast.error("Erro ao carregar itens da venda.");
      setSelectedSale(null);
    } finally {
      setLoadingSale(false);
    }
  };

  const backToSearch = () => {
    setSelectedSale(null);
    setBalances({});
    setSelection({});
    setPriorReturns([]);
    setFiscalBlock(null);
    setEstadoFiscal(null);
  };

  const setQuantity = (productId, qty) => {
    const balance = balances[productId];
    if (!balance) return;
    const clamped = Math.max(0, Math.min(qty, balance.available));
    setSelection((prev) => ({ ...prev, [productId]: clamped }));
  };

  const returnEntries = Object.entries(selection).filter(([, qty]) => qty > 0);
  const returnTotal = roundMoney(
    returnEntries.reduce((sum, [pid, qty]) => sum + (balances[pid]?.unitNet || 0) * qty, 0)
  );

  const handleSubmit = async () => {
    if (!selectedSale || returnEntries.length === 0) {
      toast.error("Selecione ao menos um item e quantidade para devolver.");
      return;
    }
    if (submetendo.current) return;
    // De novo na hora de gravar: o estado fiscal pode ter mudado desde que a venda foi aberta.
    // Bloqueado: nada é criado, devolvido ao estoque, estornado nem cancelado na SEFAZ.
    submetendo.current = true;
    try {
      const bloqueio = await conferirEstadoFiscal(selectedSale.id);
      if (bloqueio) {
        toast.error(bloqueio.mensagem);
        return;
      }
      await registrarDevolucao();
    } finally {
      submetendo.current = false;
    }
  };

  const registrarDevolucao = async () => {
    if (fiscalBlock && reason.trim().length < 15) {
      toast.error("Esta venda tem nota fiscal autorizada — digite um motivo com pelo menos 15 caracteres (é a justificativa do cancelamento na SEFAZ).");
      return;
    }
    if (fiscalBlock) {
      // Fora do prazo de cancelamento da nota (NFC-e: 30 min em GO) a SEFAZ recusaria: avisa antes.
      const prazo = await prazoDaNotaFiscal(fiscalBlock);
      if (prazo.expirado) {
        toast.error(prazo.mensagem);
        return;
      }
    }
    setSubmitting(true);
    try {
      // Nota fiscal cancelada na SEFAZ primeiro: se a SEFAZ recusar (fora do
      // prazo, motivo curto, etc.), nada é registrado — nem devolução, nem
      // estoque, nem financeiro.
      if (fiscalBlock) {
        try {
          await cancelarDocumento({ documentId: fiscalBlock.document.id, justificativa: reason });
        } catch (e) {
          console.error("Falha ao cancelar nota fiscal:", e);
          toast.error(e.message || "Não foi possível cancelar a nota fiscal na SEFAZ. Devolução não foi registrada.");
          setSubmitting(false);
          return;
        }
      }

      const user = await api.auth.me().catch(() => null);
      const clientId = crypto.randomUUID();

      const items = returnEntries.map(([productId, qty]) => {
        const b = balances[productId];
        return {
          product_id: productId,
          name: b?.name || "",
          quantity: qty,
          unit_price: roundMoney(b?.unitNet || 0),
          total: roundMoney((b?.unitNet || 0) * qty),
        };
      });

      // Registro formal primeiro: se o banco recusar (saldo insuficiente,
      // venda de outra empresa, etc.), nada é restaurado no estoque nem no
      // financeiro. refund_amount que volta aqui é o valor recalculado pelo
      // servidor a partir do preço da venda original — não o que a tela
      // somou, mesmo que dê o mesmo número.
      const devolucao = await api.entities.SaleReturn.create({
        sale_id: selectedSale.id,
        client_id: clientId,
        items,
        reason: reason || null,
        refund_method: refundMethod,
        created_by: user?.id || null,
        created_by_name: user?.full_name || user?.email || null,
      });
      const refundAmount = Number(devolucao?.refund_amount ?? returnTotal);

      // Estoque via apply_stock_movement (mesmo caminho atômico/idempotente
      // de toda entrada/saída) — nunca leitura-e-escrita direta.
      for (const item of items) {
        await api.stock.applyMovement({
          clientId: `${clientId}-${item.product_id}`,
          productId: item.product_id,
          quantity: item.quantity,
          productName: item.name,
          type: "entrada",
          reason: "devolucao",
          notes: `Devolução da venda ${saleNumberLabel(selectedSale)}`,
        });
      }

      // Impacto financeiro. Dinheiro sai fisicamente do caixa: reduz o
      // esperado em gaveta, mesmo raciocínio de sangria (withdrawals_total),
      // mas em coluna própria para não misturar os dois motivos no relatório.
      if (refundMethod === "dinheiro") {
        try {
          const registers = await api.entities.CashRegister.filter({ status: "aberto" }, "-opened_at", 1);
          const register = registers?.[0];
          if (register) {
            await api.entities.CashRegister.update(register.id, {
              returns_total: (register.returns_total || 0) + refundAmount,
            });
          }
          await logActivity({
            type: "devolucao",
            description: `Devolução ${saleNumberLabel(selectedSale)} — ${formatBRL(refundAmount)} em dinheiro`,
            amount: refundAmount,
            saleNumber: selectedSale.number,
            cashRegisterId: register?.id || "",
            paymentMethod: "dinheiro",
            details: register ? "Caixa aberto — valor descontado do esperado em gaveta" : "Sem caixa aberto no momento — impacto de caixa não lançado",
            severity: register ? "info" : "warning",
          });
        } catch (e) {
          console.error("Falha ao lançar devolução no caixa:", e);
        }
      } else if (refundMethod === "crediario" && selectedSale.customer_id) {
        // Venda em crediário aumentou o quanto o cliente devia; devolução
        // reduz essa dívida — mesmo ajuste que o cancelamento de venda
        // inteira já faz em Sales.jsx.
        try {
          // Venda mista: só o crediário que a venda deixou (menos o que devoluções
          // anteriores já abateram) pode ser abatido, não o valor inteiro da devolução.
          const abatimento = Math.min(refundAmount, crediarioRestanteDaVenda(selectedSale, priorReturns));
          const customer = await api.entities.Customer.get(selectedSale.customer_id);
          await api.entities.Customer.update(selectedSale.customer_id, {
            credit_balance: Math.max(0, (customer.credit_balance || 0) - abatimento),
          });
          await logActivity({
            type: "devolucao",
            description: `Devolução ${saleNumberLabel(selectedSale)} — ${formatBRL(abatimento)} abatido do crediário`,
            amount: abatimento,
            saleNumber: selectedSale.number,
            paymentMethod: "crediario",
            details: `Cliente: ${selectedSale.customer_name || selectedSale.customer_id}`,
          });
        } catch (e) {
          console.error("Falha ao abater crediário da devolução:", e);
        }
      } else if (MANUAL_REFUND_METHODS.has(refundMethod)) {
        // PIX/cartão/TEF não têm estorno automático — só o registro de que
        // precisa ser feito por fora, nunca uma simulação de sucesso.
        await logActivity({
          type: "devolucao",
          description: `Devolução ${saleNumberLabel(selectedSale)} — ${formatBRL(refundAmount)} a estornar em ${METHOD_LABELS[refundMethod] || refundMethod} (fora do sistema)`,
          amount: refundAmount,
          saleNumber: selectedSale.number,
          paymentMethod: refundMethod,
          details: "Estorno externo — sistema não integra estorno automático deste método",
          severity: "warning",
        });
      }

      toast.success(`Devolução registrada — ${formatBRL(refundAmount)} a estornar em ${METHOD_LABELS[refundMethod] || refundMethod}.`);
      backToSearch();
      handleSearch();
    } catch (e) {
      console.error(e);
      toast.error(e.message || "Erro ao registrar devolução.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl p-8 max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2.5 text-lg">
            <Undo2 className="w-6 h-6 text-primary" />
            {selectedSale ? `Devolução — ${saleNumberLabel(selectedSale)}` : "Devolução / Troca — Buscar venda"}
          </DialogTitle>
        </DialogHeader>

        {!selectedSale ? (
          <>
            <div className="space-y-4">
              <div>
                <Label className="mb-1.5 block">Nome do cliente</Label>
                <Input value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="Opcional" />
              </div>
              <div>
                <Label className="mb-1.5 block">Nº da venda</Label>
                <Input value={saleNumber} onChange={(e) => setSaleNumber(e.target.value)} placeholder="Ex: 1523" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="mb-1.5 block">Data inicial</Label>
                  <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                </div>
                <div>
                  <Label className="mb-1.5 block">Data final</Label>
                  <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
                </div>
              </div>
              <Button onClick={handleSearch} disabled={loading} className="w-full gap-2 h-10">
                <Search className="w-4 h-4" /> Buscar
              </Button>
            </div>

            {searched && (
              <div className="mt-4 space-y-2 max-h-[300px] overflow-y-auto">
                {results.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-6">
                    Nenhuma venda encontrada.
                  </p>
                ) : (
                  results.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => selectSale(s)}
                      className="w-full flex items-center justify-between p-3 rounded-lg border hover:border-primary hover:bg-primary/5 transition-colors text-left"
                    >
                      <div>
                        <div className="text-sm font-medium">{saleNumberLabel(s)} · {s.customer_name || "Consumidor"}</div>
                        <div className="text-xs text-muted-foreground">{formatDateTime(s.created_date)}</div>
                      </div>
                      <span className="font-semibold text-sm">{formatBRL(s.total)}</span>
                    </button>
                  ))
                )}
              </div>
            )}
          </>
        ) : (
          <div className="space-y-4">
            <button
              onClick={backToSearch}
              className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="w-3.5 h-3.5" /> Voltar à busca
            </button>

            {loadingSale ? (
              <div className="flex items-center justify-center py-10">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <>
                {estadoFiscal && (
                  <div className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800 flex gap-3">
                    <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
                    <div>
                      <p className="font-semibold mb-1">Devolução bloqueada: status fiscal sem resolução</p>
                      <p>{estadoFiscal.mensagem}</p>
                      {estadoFiscal.chave && <p className="mt-1 font-mono text-xs break-all select-all">{estadoFiscal.chave}</p>}
                    </div>
                  </div>
                )}
                {fiscalBlock && (
                  <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 flex gap-3">
                    <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
                    <div>
                      <p className="font-semibold mb-1">Nota fiscal será cancelada na SEFAZ</p>
                      <p>{fiscalBlock.message} O motivo abaixo também serve de justificativa do cancelamento (mín. 15 caracteres).</p>
                    </div>
                  </div>
                )}
                {/* Pagamento original — só leitura. Venda com split-payment
                    mostra o detalhamento; o sistema nunca escolhe sozinho
                    qual meio foi estornado, quem decide é o operador no
                    campo "Forma a estornar" abaixo. */}
                <div className="rounded-lg border p-3 bg-muted/30 text-sm">
                  <p className="font-medium mb-1">Pagamento original</p>
                  {Array.isArray(selectedSale.payments) && selectedSale.payments.length > 0 ? (
                    <div className="space-y-0.5">
                      {selectedSale.payments.map((p, i) => (
                        <div key={i} className="flex justify-between text-xs text-muted-foreground">
                          <span>{METHOD_LABELS[p.method] || p.method}</span>
                          <span>{formatBRL(p.amount)}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      {METHOD_LABELS[selectedSale.payment_method] || selectedSale.payment_method} · {formatBRL(selectedSale.total)}
                    </p>
                  )}
                  {priorReturns.length > 0 && (
                    <p className="text-xs text-amber-700 mt-2">
                      {priorReturns.length} devolução(ões) anterior(es) desta venda —{" "}
                      {formatBRL(priorReturns.reduce((sum, r) => sum + (r.refund_amount || 0), 0))} já estornado.
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label className={"block"}>Itens da venda</Label>
                  {Object.keys(balances).length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      Esta venda não tem itens com produto vinculado — nada disponível para devolução automática de estoque.
                    </p>
                  ) : (
                    Object.entries(balances).map(([productId, b]) => (
                      <div key={productId} className="flex items-center gap-3 p-3 rounded-lg border">
                        <Checkbox
                          checked={(selection[productId] || 0) > 0}
                          disabled={b.available <= 0}
                          onCheckedChange={(checked) => setQuantity(productId, checked ? b.available : 0)}
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{b.name}</p>
                          <p className="text-xs text-muted-foreground">
                            Vendido: {b.sold} · Já devolvido: {b.returned} · Disponível: {b.available}
                          </p>
                        </div>
                        <Input
                          type="number"
                          min={0}
                          max={b.available}
                          step="0.001"
                          value={selection[productId] || 0}
                          disabled={b.available <= 0}
                          onChange={(e) => setQuantity(productId, Number(e.target.value) || 0)}
                          className="w-24"
                        />
                      </div>
                    ))
                  )}
                </div>

                <div>
                  <Label className="mb-1.5 block">Motivo</Label>
                  <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Opcional" rows={2} />
                </div>

                <div>
                  <Label className="mb-1.5 block">Forma a estornar</Label>
                  <Select value={refundMethod} onValueChange={setRefundMethod}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {REFUND_METHODS.map((m) => (
                        <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground mt-1">
                    Isto só registra o que precisa ser estornado. Cartão/TEF/PIX não são estornados
                    automaticamente pelo sistema — o estorno de verdade é feito à parte, fora daqui.
                  </p>
                </div>

                <div className="flex items-center justify-between p-3 rounded-lg border-2 border-primary/30 bg-primary/5">
                  <span className="text-sm font-medium">Total a devolver</span>
                  <span className="text-xl font-bold text-primary">{formatBRL(returnTotal)}</span>
                </div>

                <Button
                  onClick={handleSubmit}
                  disabled={submitting || returnEntries.length === 0 || !!estadoFiscal}
                  className="w-full gap-2 h-11"
                >
                  {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
                  Registrar devolução
                </Button>
              </>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
