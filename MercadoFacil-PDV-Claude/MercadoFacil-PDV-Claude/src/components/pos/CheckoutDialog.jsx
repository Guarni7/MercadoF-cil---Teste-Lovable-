import React, { useState, useEffect, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Banknote,
  QrCode,
  CreditCard,
  Wallet,
  Users,
  Loader2,
  Copy,
  Check,
  Smartphone,
  User as UserIcon,
  Plus,
  Trash2,
  AlertCircle,
} from "lucide-react";
import CurrencyInput from "@/components/ui/currency-input";
import { api } from "@/api/dataClient";
import { loadCustomers as loadCustomersData } from "@/lib/dataLayer";
import { formatBRL } from "@/lib/format";
import { cn } from "@/lib/utils";
import { generateBRCode, getQrCodeUrl } from "@/lib/pix";
import { getCachedPaymentConfig } from "@/lib/paymentConfig";
import {
  isTefConfigured,
  initiateTefPayment,
  cancelTefPayment,
  consultarTefTransacao,
  createTefTransactionId,
  savePendingTefTransaction,
  clearPendingTefTransaction,
  getPendingTefTransaction,
  TefStatus,
} from "@/lib/tef";
import { toast } from "sonner";
import VendorSelectDialog from "@/components/pos/VendorSelectDialog";
import IdentificacaoCupomDialog from "@/components/pos/IdentificacaoCupomDialog";
import ConnectTefCardPanel from "@/components/pos/ConnectTefCardPanel";
import MaquininhaManualPanel from "@/components/pos/MaquininhaManualPanel";
import { useCanalCartao, useCobrancaTef } from "@/lib/useConnectTef";
import { lancamentoDinheiro, totaisDoRecebimento } from "@/lib/troco";

const paymentMethods = [
  { id: "credito", label: "Crédito", icon: CreditCard, shortcut: "C" },
  { id: "debito", label: "Débito", icon: Wallet, shortcut: "C" },
  { id: "dinheiro", label: "Dinheiro", icon: Banknote, shortcut: "D" },
  { id: "pix", label: "PIX", icon: QrCode, shortcut: "P" },
  { id: "crediario", label: "Crediário", icon: Users, shortcut: "" },
];

const fieldLabel = "text-[10px] font-semibold tracking-wide text-muted-foreground uppercase";

export default function CheckoutDialog({ open, onClose, total, onConfirm, defaultCustomer }) {
  const [method, setMethod] = useState("dinheiro");
  const [amountReceived, setAmountReceived] = useState(0);
  const [discount, setDiscount] = useState(0);
  const [addition, setAddition] = useState(0);
  const [customers, setCustomers] = useState([]);
  const [selectedCustomer, setSelectedCustomer] = useState("");
  const [processing, setProcessing] = useState(false);
  const [pixPaid, setPixPaid] = useState(false);
  // Como o PIX foi confirmado: "gateway" (Mercado Pago disse que aprovou,
  // via checkPixPayment) ou "manual" (o operador declarou ter recebido, sem
  // nenhuma verificação do sistema — chave PIX fixa não tem como o sistema
  // saber se o dinheiro entrou). pixPaid sozinho não diz qual dos dois foi.
  const [pixConfirmationType, setPixConfirmationType] = useState(null);
  const [pixVerifying, setPixVerifying] = useState(false);
  // Estado da transação de cartão (TEF). cardAmount é o valor que foi de fato
  // enviado/aprovado na maquininha — nunca o `remaining` recalculado na hora
  // de lançar o pagamento, senão um desconto aplicado depois da aprovação
  // faria o lançamento divergir do que foi cobrado de verdade no cartão.
  const [cardStatus, setCardStatus] = useState(/** @type {string} */ (TefStatus.IDLE));
  const [cardTransactionId, setCardTransactionId] = useState(null);
  const [cardAmount, setCardAmount] = useState(0);
  const [cardProcessing, setCardProcessing] = useState(false);
  // NSU/autorização que o operador digitou ao confirmar o cartão na maquininha independente.
  const [maqNsu, setMaqNsu] = useState("");
  // Transação TEF que ficou pendente numa sessão anterior (F5, queda do app
  // no meio de uma cobrança). Bloqueia nova cobrança até resolver, para não
  // cobrar duas vezes o mesmo cliente.
  const [pendingRecovery, setPendingRecovery] = useState(null);
  // Canal do cartão (maquininha | tef | smartpos): configuração da empresa, CONGELADA ao abrir o
  // checkout (ver useCanalCartao). Crédito e débito só andam pelo canal escolhido; se ele não
  // puder cobrar (Smart POS sem resposta/offline, TEF sem agente), o cartão fica bloqueado com o
  // motivo — nunca cai em outro canal e nunca aprova sozinho:
  //   smartpos   → só "aprovado" confirmado pelo webhook do ConnectTEF conta como pago;
  //   tef        → só aprovação devolvida pelo agente/PIN pad;
  //   maquininha → só depois da confirmação explícita do operador (confirmação manual).
  const [ctef, cobrancaTef] = useCobrancaTef(open);
  const { resolucao, canal: canalCartao, estadoSmartPos: ctefEstado, recarregar: recarregarCtef } = useCanalCartao(open);
  const ehCartao = method === "credito" || method === "debito";
  const cartaoOk = ehCartao && resolucao.liberado;
  const usaCtef = cartaoOk && canalCartao === "smartpos";
  const usaTef = cartaoOk && canalCartao === "tef";
  const usaMaq = cartaoOk && canalCartao === "maquininha";
  const cartaoBloqueado = ehCartao && resolucao.habilitado && !resolucao.liberado;
  const ctefBloqueado = usaCtef && (cobrancaTef.emAndamento || ctef.fase === "aprovado");
  const cardApproved = usaCtef ? ctef.fase === "aprovado" : (usaTef || usaMaq) && cardStatus === TefStatus.APPROVED;
  const cardAmountAtual = usaCtef ? ctef.valorCentavos / 100 : cardAmount;
  // card_enabled desligado: o PDV não oferece Crédito nem Débito.
  const metodosVisiveis = paymentMethods.filter((pm) => resolucao.habilitado || (pm.id !== "credito" && pm.id !== "debito"));
  const confirmandoRef = useRef(false);
  const [installments, setInstallments] = useState("1");
  const [copied, setCopied] = useState(false);
  const [pixData, setPixData] = useState(null);
  const [pixLoading, setPixLoading] = useState(false);
  const [pixConfigured, setPixConfigured] = useState(false);
  const [pixErro, setPixErro] = useState("");
  const [payments, setPayments] = useState([]);
  const [vendorName, setVendorName] = useState("");
  const [vendorId, setVendorId] = useState("");
  const [vendorOpen, setVendorOpen] = useState(false);
  const [identificacaoOpen, setIdentificacaoOpen] = useState(false);
  const [cupomDocument, setCupomDocument] = useState("");

  const subtotal = total;
  const adjustedTotal = Math.max(0, subtotal - (discount || 0) + (addition || 0));
  const totalPaid = payments.reduce((sum, p) => sum + p.amount, 0);
  const remaining = Math.max(0, adjustedTotal - totalPaid);
  // Dinheiro: o único campo "Valor Recebido" (amountReceived) alimenta troco/falta em tempo real,
  // contra o que ainda falta pagar. Demais formas: troco só do que já foi lançado.
  const recebidoDinheiro = method === "dinheiro" && amountReceived > 0 ? amountReceived : 0;
  const change = recebidoDinheiro > 0
    ? lancamentoDinheiro(recebidoDinheiro, remaining).change
    : Math.max(0, totalPaid - adjustedTotal);
  const falta = recebidoDinheiro > 0 ? Math.max(0, Math.round((remaining - recebidoDinheiro) * 100) / 100) : 0;
  const customerName =
    customers.find((c) => c.id === selectedCustomer)?.name || defaultCustomer?.name;

  useEffect(() => {
    if (open) {
      setSelectedCustomer(defaultCustomer ? defaultCustomer.id : "");
      setPixPaid(false);
      setPixConfirmationType(null);
      setPixVerifying(false);
      setCardStatus(TefStatus.IDLE);
      setCardTransactionId(null);
      setCardAmount(0);
      setMaqNsu("");
      setCardProcessing(false);
      setInstallments("1");
      setCopied(false);
      setPixData(null);
      setPixConfigured(false);
      setDiscount(0);
      setAddition(0);
      setAmountReceived(0);
      setPayments([]);
      setMethod("dinheiro");
      setCupomDocument("");
      // Uma transação TEF que ficou sem desfecho registrado (app fechado
      // entre iniciar e aprovar/recusar) precisa ser resolvida antes de
      // cobrar de novo — senão o mesmo cartão pode ser cobrado duas vezes.
      setPendingRecovery(getPendingTefTransaction());
      api.auth
        .me()
        .then((u) => {
          setVendorName(u?.full_name || u?.email || "Vendedor");
          setVendorId(u?.id || "");
        })
        .catch(() => setVendorName("Vendedor"));
      loadCustomers();
    }
  }, [open, defaultCustomer]);

  useEffect(() => {
    if (open && method === "pix" && !pixData && !pixLoading) {
      generatePix();
    }
  }, [open, method]);

  useEffect(() => {
    if (!resolucao.habilitado && ehCartao) setMethod("dinheiro");
  }, [resolucao.habilitado, ehCartao]);

  // Trocar de forma de pagamento descarta uma aprovação de cartão anterior:
  // sem isto, aprovar no crédito e depois clicar em débito reaproveitaria o
  // status "aprovado" para um método que nunca foi autorizado na maquininha.
  useEffect(() => {
    setCardStatus(TefStatus.IDLE);
    setCardTransactionId(null);
    setCardAmount(0);
      setMaqNsu("");
  }, [method]);

  const generatePix = async () => {
    setPixLoading(true);
    setPixErro("");
    try {
      const config = getCachedPaymentConfig();
      if (config.pix_mode === "manual" && config.pix_key) {
        const brCode = generateBRCode(
          config.pix_key,
          remaining || total,
          config.merchant_name || "MERCADO FACIL",
          config.merchant_city || "SAO PAULO",
          `PDV${Date.now()}`
        );
        setPixConfigured(true);
        setPixData({ qrCode: brCode, qrCodeUrl: getQrCodeUrl(brCode, 300), paymentId: null });
        setPixLoading(false);
        return;
      }
      // O token do Mercado Pago fica no servidor, resolvido pela empresa.
      const res = await api.functions.invoke("generatePixPayment", {
        amount: remaining || total,
        description: "Venda PDV MercadoFácil",
      });
      const data = res.data || res;
      if (data.configured && data.qrCode) {
        setPixConfigured(true);
        setPixData({ qrCode: data.qrCode, qrCodeImage: data.qrCodeImage, paymentId: data.paymentId });
      } else {
        setPixConfigured(false);
        setPixErro(data.error || "PIX não configurado nesta loja.");
      }
    } catch (e) {
      console.error("Erro ao gerar PIX:", e);
      setPixConfigured(false);
      setPixErro(e.message || "Não foi possível gerar o PIX.");
    }
    setPixLoading(false);
  };

  // Só o Mercado Pago diz se entrou dinheiro de verdade — mesmo padrão já
  // usado em PlanPaymentDialog.jsx para a assinatura da plataforma. Sem
  // paymentId (PIX de chave fixa) não há o que consultar: não existe API
  // nenhuma que diga se uma chave PIX qualquer recebeu um pagamento.
  const verificarPixPagamento = async () => {
    if (!pixData?.paymentId) return;
    setPixVerifying(true);
    try {
      const res = await api.functions.invoke("checkPixPayment", { paymentId: pixData.paymentId });
      const data = res?.data || res;
      if (data.approved) {
        setPixPaid(true);
        setPixConfirmationType("gateway");
        toast.success("Pagamento confirmado pelo Mercado Pago!");
      } else {
        toast.message(
          data.status
            ? `Ainda não identificamos o pagamento (${data.status}).`
            : "Ainda não identificamos o pagamento."
        );
      }
    } catch (e) {
      console.error("Erro ao verificar PIX:", e);
      toast.error(e.message || "Falha ao verificar o pagamento.");
    } finally {
      setPixVerifying(false);
    }
  };

  // PIX de chave fixa (pix_mode "manual") não tem gateway nenhum consultando
  // nada — isto é o operador declarando, sob a própria responsabilidade, que
  // viu o dinheiro entrar no aplicativo do banco. O sistema nunca chama isto
  // de "aprovado" ou "confirmado" sozinho: o rótulo e o registro da venda
  // deixam explícito que foi uma confirmação manual, não uma verificação.
  const confirmarPixManual = () => {
    setPixPaid(true);
    setPixConfirmationType("manual");
  };

  const loadCustomers = async () => {
    try {
      const data = await loadCustomersData();
      setCustomers(data);
    } catch (e) {
      console.error(e);
    }
  };

  const copyPixKey = () => {
    const key = pixConfigured && pixData?.qrCode ? pixData.qrCode : "mercadofacil@pdv.com.br";
    navigator.clipboard?.writeText(key);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const startCardPayment = async () => {
    if (!usaTef) return; // defesa: só o canal TEF, liberado, envia ao agente
    if (pendingRecovery) {
      toast.error("Resolva a transação TEF pendente da sessão anterior antes de cobrar de novo.");
      return;
    }
    if (!isTefConfigured()) {
      toast.error("TEF não configurado. Vá em Configurações → Pagamento → TEF.");
      return;
    }
    setCardProcessing(true);
    setCardStatus(TefStatus.INITIATING);
    try {
      if (isTefConfigured()) {
        const txId = createTefTransactionId();
        const chargeAmount = remaining || total;
        setCardTransactionId(txId);
        setCardAmount(chargeAmount);
        // Guardado antes da chamada: se o app cair entre enviar e receber a
        // resposta, o próximo open() encontra isto e não deixa cobrar de novo
        // sem antes consultar o que aconteceu com esta transação.
        savePendingTefTransaction({ transactionId: txId, amount: chargeAmount, type: method, startedAt: Date.now() });
        setCardStatus(TefStatus.PENDING);

        const result = await initiateTefPayment({ amount: chargeAmount, type: method, installments, transactionId: txId });
        setCardStatus(result.status);
        if (result.status === TefStatus.APPROVED) {
          clearPendingTefTransaction();
          toast.success(`TEF aprovado! NSU: ${result.nsu}`);
        } else if (result.status === TefStatus.TIMEOUT) {
          // Fica pendente até o operador consultar — timeout não é recusa.
          toast.error(result.message || "Sem resposta do TEF.");
        } else {
          clearPendingTefTransaction();
          toast.error(result.message || "Transação TEF não aprovada.");
        }
      }
    } catch (e) {
      setCardStatus(TefStatus.ERROR);
      toast.error(e.message || "Erro ao processar pagamento TEF.");
    } finally {
      setCardProcessing(false);
    }
  };

  /** Maquininha independente: o sistema não enxerga a maquininha — só vale após a confirmação do operador. */
  const confirmarMaquininha = ({ nsu }) => {
    if (!usaMaq) return;
    if (cardStatus === TefStatus.APPROVED) return; // duplo clique: já está aprovado
    setCardAmount(remaining || total);
    setCardTransactionId(null);
    setMaqNsu(nsu || "");
    setCardStatus(TefStatus.APPROVED);
  };
  const desfazerMaquininha = () => {
    setCardStatus(TefStatus.IDLE);
    setCardAmount(0);
    setMaqNsu("");
  };

  /** Resolve timeout/erro consultando o desfecho real, sem reenviar a cobrança. */
  const consultarCardPayment = async () => {
    if (!cardTransactionId) return;
    setCardProcessing(true);
    try {
      const result = await consultarTefTransacao(cardTransactionId);
      setCardStatus(result.status);
      clearPendingTefTransaction();
      if (result.status === TefStatus.APPROVED) {
        toast.success("Transação confirmada como aprovada.");
      } else {
        toast.info(result.message || "Transação não está aprovada.");
      }
    } catch (e) {
      toast.error(e.message || "Não foi possível consultar a transação.");
    } finally {
      setCardProcessing(false);
    }
  };

  const handleConsultarPendente = async () => {
    if (!pendingRecovery?.transactionId) return;
    const result = await consultarTefTransacao(pendingRecovery.transactionId);
    if (result.status === TefStatus.APPROVED) {
      toast.error("Essa transação FOI aprovada na maquininha. Confira com o cliente antes de vender de novo.");
    } else {
      toast.success("Transação anterior não está aprovada — pode prosseguir.");
      clearPendingTefTransaction();
      setPendingRecovery(null);
    }
  };

  const handleDescartarPendente = () => {
    clearPendingTefTransaction();
    setPendingRecovery(null);
  };

  /** Monta 1 lançamento com o método atual (dinheiro vazio = valor restante). */
  const buildCurrentPayment = (silent = false) => {
    if (remaining <= 0) return null;
    let amt = remaining;
    let label = "";
    let dinheiro = null;
    if (method === "dinheiro") {
      dinheiro = lancamentoDinheiro(amountReceived, remaining);
      amt = dinheiro.amount;
      label = "Dinheiro";
    } else if (method === "pix") {
      if (!pixPaid || !pixConfirmationType) {
        if (!silent) toast.error("Confirme o recebimento do PIX primeiro.");
        return null;
      }
      // O rótulo já denuncia quando não houve verificação real, tanto na
      // lista de pagamentos lançados quanto em qualquer relatório que use
      // esse texto depois — nunca aparece só "PIX" como se fosse igual ao
      // fluxo com gateway.
      label = pixConfirmationType === "gateway" ? "PIX" : "PIX (confirmação manual)";
    } else if (method === "credito" || method === "debito") {
      if (!cardApproved) {
        if (!silent) {
          toast.error(
            cartaoBloqueado ? resolucao.motivo
              : usaCtef ? "Aguarde a aprovação no Smart POS."
              : usaTef ? "Envie para o PIN pad e aguarde a aprovação."
              : "Confirme o pagamento da maquininha primeiro."
          );
        }
        return null;
      }
      // O valor lançado é sempre o que foi autorizado na maquininha, nunca o
      // `remaining` recalculado agora — se o total mudou depois da aprovação
      // (desconto/acréscimo lançado no meio do caminho), a aprovação não vale
      // mais para este valor e precisa ser refeita.
      if (Math.abs(cardAmountAtual - remaining) > 0.009) {
        if (!silent) {
          toast.error(usaCtef
            ? "O valor mudou desde a aprovação no Smart POS. Volte o total ao valor cobrado (a cobrança não pode ser cancelada pelo sistema)."
            : usaMaq
            ? "O valor mudou depois da confirmação. Desfaça a confirmação e confirme de novo no valor atual."
            : "O valor mudou desde a aprovação do TEF. Cancele e refaça o pagamento neste valor.");
        }
        return null;
      }
      amt = cardAmountAtual;
      label = method === "credito" ? "Crédito" : "Débito";
    } else if (method === "crediario") {
      if (!selectedCustomer) {
        if (!silent) toast.error("Selecione um cliente primeiro.");
        return null;
      }
      label = "Crediário";
    } else {
      return null;
    }
    const transactionId = method === "credito" || method === "debito" ? cardTransactionId : null;
    const pixMeta =
      method === "pix"
        ? { pixConfirmationType, pixPaymentId: pixData?.paymentId || null }
        : {};
    if (usaCtef) {
      // transactionId fica nulo de propósito: os caminhos de cancelamento do TEF antigo não valem aqui.
      return {
        method, amount: amt, label, transactionId: null,
        provider: "connecttef", connectTefPaymentId: ctef.op.id, connectTefReferencia: ctef.op.referencia || null,
        channel: "smartpos",
      };
    }
    if (usaTef) return { method, amount: amt, label, transactionId, channel: "tef" };
    if (usaMaq) {
      return {
        method, amount: amt, label, transactionId: null,
        channel: "maquininha", confirmationType: "manual", ...(maqNsu ? { nsu: maqNsu } : {}),
      };
    }
    // Dinheiro: amount = valor aplicado à venda; received/change = o que o cliente entregou e o troco.
    if (dinheiro) return { method, amount: amt, label, transactionId, received: dinheiro.received, change: dinheiro.change };
    return { method, amount: amt, label, transactionId, ...pixMeta };
  };

  const addPayment = () => {
    if (remaining <= 0) {
      toast.error("Total já atingido.");
      return;
    }
    const entry = buildCurrentPayment(false);
    if (!entry) return;
    setPayments([...payments, entry]);
    cobrancaTef.reset();
    setAmountReceived(0);
    setPixPaid(false);
    setPixConfirmationType(null);
    setCardStatus(TefStatus.IDLE);
    setCardTransactionId(null);
    setCardAmount(0);
      setMaqNsu("");
    setPixData(null);
    setMethod("dinheiro");
    toast.success(`${entry.label} de ${formatBRL(entry.amount)} adicionado!`);
  };

  // Um pagamento de cartão já lançado tem uma cobrança real feita na
  // maquininha. Removê-lo do lançamento sem cancelar lá deixaria o dinheiro
  // cobrado do cliente sem constar na venda — por isso cancela antes de tirar
  // da lista, mesmo que o cancelamento em si ainda não fale com um SDK real.
  const removePayment = async (index) => {
    const entry = payments[index];
    if (entry?.provider === "connecttef") {
      toast.error("Pagamento já cobrado no Smart POS: o estorno ainda não está disponível pelo sistema. Faça o estorno no Smart POS.");
      return;
    }
    if (entry?.channel === "maquininha") {
      toast.warning("Pagamento retirado da venda. Se o cartão já foi cobrado, cancele a transação na maquininha.");
    }
    if (entry?.transactionId) {
      const result = await cancelTefPayment(entry.transactionId);
      if (result.status === TefStatus.CANCELLED) {
        toast.success("Pagamento cancelado na maquininha.");
      } else {
        toast.error("Não foi possível confirmar o cancelamento na maquininha. Confira com o cliente antes de remover.");
      }
    }
    setPayments((prev) => prev.filter((_, i) => i !== index));
  };

  // Dinheiro sem valor informado = paga o restante; cartão/PIX prontos também contam
  const pendingPayment = totalPaid < adjustedTotal ? buildCurrentPayment(true) : null;
  const projectedPaid = totalPaid + (pendingPayment?.amount || 0);
  const canFinalize = adjustedTotal > 0 && projectedPaid >= adjustedTotal;

  const resolvePaymentsForFinalize = () => {
    if (totalPaid >= adjustedTotal) return payments;
    const entry = buildCurrentPayment(false);
    if (!entry) return null;
    return [...payments, entry];
  };

  const handleConfirm = async (docOverride) => {
    if (confirmandoRef.current) return;
    const finalPayments = resolvePaymentsForFinalize();
    if (!finalPayments || finalPayments.length === 0) return;
    const paid = finalPayments.reduce((sum, p) => sum + p.amount, 0);
    if (paid < adjustedTotal || adjustedTotal <= 0) return;

    if (finalPayments !== payments) {
      setPayments(finalPayments);
    }

    confirmandoRef.current = true;
    setProcessing(true);
    const customer =
      customers.find((c) => c.id === selectedCustomer) || defaultCustomer;
    const primaryPayment = finalPayments[0] || { method, amount: adjustedTotal };
    const pixEntry = finalPayments.find((p) => p.method === "pix");
    const { change: changeAmount, amountReceived: recebidoTotal } = totaisDoRecebimento(finalPayments);
    const result = await onConfirm({
      method: primaryPayment.method,
      amountReceived: recebidoTotal,
      change: changeAmount,
      total: adjustedTotal,
      discount: discount || 0,
      addition: addition || 0,
      customerId: selectedCustomer || defaultCustomer?.id || "",
      customerName: customer?.name || defaultCustomer?.name,
      sellerId: vendorId,
      sellerName: vendorName,
      installments:
        finalPayments.some((p) => p.method === "credito") ? parseInt(installments) : undefined,
      payments: finalPayments,
      // pixPaymentId só existe quando o Mercado Pago gerou a cobrança; PIX de
      // chave fixa nunca tem id de gateway. pixConfirmationType é o que
      // distingue, na venda gravada, "o Mercado Pago aprovou" de "o operador
      // declarou ter recebido" — nunca fica implícito.
      pixPaymentId: pixEntry?.pixPaymentId || null,
      pixConfirmationType: pixEntry?.pixConfirmationType || null,
      cupomDocument: docOverride !== undefined ? docOverride : cupomDocument,
    });
    setProcessing(false);
    confirmandoRef.current = false;
    if (result) {
      cobrancaTef.reset();
      setMethod("dinheiro");
      setAmountReceived(0);
      setSelectedCustomer("");
      setPixPaid(false);
      setPixConfirmationType(null);
      setCardStatus(TefStatus.IDLE);
      setCardTransactionId(null);
      setCardAmount(0);
      setMaqNsu("");
      setCardProcessing(false);
      setInstallments("1");
      setDiscount(0);
      setAddition(0);
      setPayments([]);
      setCupomDocument("");
    }
  };

  // Fechar sem finalizar com uma cobrança de cartão em aberto (lançada na
  // lista, ou aprovada mas ainda não lançada) precisa cancelar cada uma na
  // maquininha antes — senão o cliente foi cobrado e a venda nunca existiu.
  const handleClose = async () => {
    if (processing) return;
    if (ctefBloqueado || payments.some((p) => p.provider === "connecttef")) {
      toast.error("Há pagamento no Smart POS em andamento ou já aprovado. Conclua a venda ou aguarde o resultado antes de fechar.");
      return;
    }
    const aCancelar = payments.filter((p) => p.transactionId).map((p) => p.transactionId);
    if (cardApproved && cardTransactionId && !aCancelar.includes(cardTransactionId)) {
      aCancelar.push(cardTransactionId);
    }
    for (const transactionId of aCancelar) {
      await cancelTefPayment(transactionId);
    }
    if (aCancelar.length) toast.info("Pagamento(s) na maquininha cancelado(s).");
    if (payments.some((p) => p.channel === "maquininha") || (usaMaq && cardApproved)) {
      toast.warning("Havia pagamento de cartão confirmado na maquininha e a venda não foi finalizada: cancele a transação na maquininha.");
    }
    onClose();
  };

  // Keyboard shortcuts
  useEffect(() => {
    if (!open) return;
    const handleKey = (e) => {
      // Não intercepta teclas quando um sub-modal (identificação/vendedor) está aberto
      if (identificacaoOpen || vendorOpen) return;
      if (e.key === "Enter" && !processing) {
        e.preventDefault();
        addPayment();
      } else if (e.key === "F9") {
        e.preventDefault();
        setIdentificacaoOpen(true);
      } else if (e.key === "F10") {
        e.preventDefault();
        if (canFinalize) handleConfirm();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open, processing, payments, method, amountReceived, pixPaid, cardApproved, selectedCustomer, discount, addition, identificacaoOpen, vendorOpen]);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="max-w-4xl p-0 gap-0 overflow-hidden">
        {/* Header */}
        <DialogHeader className="p-4 flex flex-row items-center justify-between space-y-0 border-b">
          <div>
            <DialogTitle className="text-base font-bold">Finalizar Venda</DialogTitle>
            <p className="text-xs text-muted-foreground mt-0.5">
              Vendedor: <span className="font-medium text-foreground">{vendorName}</span>{" "}
              <button
                onClick={() => setVendorOpen(true)}
                className="text-primary hover:underline ml-1"
              >
                Alterar
              </button>
            </p>
          </div>
        </DialogHeader>

        {/* Customer bar */}
        <div className="px-4 py-2 border-b">
          <button
            onClick={() => setIdentificacaoOpen(true)}
            className="w-full flex items-center gap-2 p-2.5 rounded-lg border hover:bg-muted transition-colors"
          >
            <UserIcon className="w-4 h-4 text-muted-foreground" />
            <span className="text-sm text-muted-foreground flex-1 text-left">
              {cupomDocument
                ? `Doc: ${cupomDocument}`
                : customerName
                ? customerName
                : "Sem cliente"}{" "}
              · F9 · opcional NFC-e
            </span>
            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
              F9
            </span>
          </button>
        </div>

        {pendingRecovery && (
          <div className="mx-4 mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 space-y-2">
            <p className="font-medium flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              Transação TEF pendente de uma sessão anterior
            </p>
            <p className="text-xs">
              Valor {formatBRL(pendingRecovery.amount || 0)} · ID {String(pendingRecovery.transactionId || "").slice(0, 8)}…
              Consulte antes de cobrar de novo, para não cobrar duas vezes do mesmo cliente.
            </p>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={handleConsultarPendente}>
                Consultar status
              </Button>
              <Button size="sm" variant="outline" onClick={handleDescartarPendente}>
                Descartar (já resolvido)
              </Button>
            </div>
          </div>
        )}

        {/* Two-column body */}
        <div className="grid grid-cols-1 lg:grid-cols-12 max-h-[62vh] overflow-y-auto">
          {/* Left column */}
          <div className="lg:col-span-7 p-4 space-y-4 lg:border-r">
            {/* Payment methods */}
            <div>
              <Label className={cn(fieldLabel, "mb-2 block")}>Forma de Pagamento</Label>
              <div className={cn("grid gap-2", metodosVisiveis.length >= 5 ? "grid-cols-5" : "grid-cols-3")}>
                {metodosVisiveis.map((pm) => {
                  const Icon = pm.icon;
                  return (
                    <button
                      key={pm.id}
                      onClick={() => {
                        if (pm.id !== method && ctefBloqueado) {
                          toast.error("Há cobrança no Smart POS em andamento ou aprovada. Conclua esse pagamento antes de trocar a forma.");
                          return;
                        }
                        setMethod(pm.id);
                      }}
                      className={cn(
                        "relative flex flex-col items-center gap-1 p-3 rounded-lg border-2 transition-all",
                        method === pm.id
                          ? "border-primary bg-primary/5"
                          : "border-border hover:border-primary/30"
                      )}
                    >
                      <Icon className="w-5 h-5" />
                      <span className="text-xs font-medium">{pm.label}</span>
                      {pm.shortcut && (
                        <span className="absolute top-1 right-1 w-4 h-4 rounded-full bg-primary text-primary-foreground text-[9px] font-bold flex items-center justify-center">
                          {pm.shortcut}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Method-specific content */}
            {method === "dinheiro" && (
              <div>
                <Label className={cn(fieldLabel, "mb-1 block")}>Valor Recebido</Label>
                <CurrencyInput
                  value={amountReceived}
                  onChange={setAmountReceived}
                  className="text-lg font-semibold border-primary"
                />
              </div>
            )}

            {method === "pix" && (
              <div className="space-y-3">
                <div className="flex flex-col items-center gap-3 p-4 rounded-lg border-2 border-dashed border-primary/30 bg-primary/5">
                  {pixLoading ? (
                    <div className="w-40 h-40 flex items-center justify-center">
                      <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
                    </div>
                  ) : pixConfigured && (pixData?.qrCodeImage || pixData?.qrCodeUrl) ? (
                    <div className="w-40 h-40 bg-white rounded-lg border border-border p-2 flex items-center justify-center relative">
                      <img
                        src={
                          pixData.qrCodeImage
                            ? `data:image/png;base64,${pixData.qrCodeImage}`
                            : pixData.qrCodeUrl
                        }
                        alt="QR Code PIX"
                        className="w-full h-full object-contain"
                      />
                      {pixPaid && (
                        <div className="absolute inset-0 bg-white/90 rounded-lg flex items-center justify-center">
                          <div className="flex flex-col items-center gap-1 text-emerald-600">
                            <Check className="w-10 h-10" strokeWidth={3} />
                            <span className="text-xs font-bold text-center px-2">
                              {pixConfirmationType === "gateway" ? "Pago" : "Confirmado manualmente"}
                            </span>
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    // Sem QR real não existe cobrança: mostrar um código
                    // decorativo faria o operador aceitar um pagamento que
                    // nunca foi feito.
                    <div className="w-40 h-40 rounded-lg border border-dashed border-amber-300 bg-amber-50 p-3 flex flex-col items-center justify-center text-center gap-2">
                      <AlertCircle className="w-7 h-7 text-amber-500" />
                      <span className="text-xs text-amber-700 leading-tight">
                        PIX não configurado
                      </span>
                    </div>
                  )}
                  <div className="text-center">
                    <p className="text-sm font-medium">
                      {pixPaid
                        ? pixConfirmationType === "gateway"
                          ? "Pagamento confirmado pelo Mercado Pago!"
                          : "Confirmado manualmente pelo operador"
                        : pixConfigured
                        ? "Aguardando pagamento PIX..."
                        : "PIX indisponível"}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Valor: {formatBRL(remaining || total)}
                    </p>
                    {!pixConfigured && !pixLoading && (
                      <p className="text-xs text-amber-700 mt-2 max-w-[260px]">
                        {pixErro ||
                          "Cadastre a chave PIX ou o Access Token em Configurações → Pagamento."}
                      </p>
                    )}
                    {/* Chave fixa: o sistema não tem como saber se o PIX caiu —
                        só o extrato bancário diz isso. Aviso fica visível o
                        tempo todo, não só antes de confirmar, porque mesmo
                        depois de "confirmado manualmente" isso continua
                        sendo uma declaração do operador, não uma verificação. */}
                    {pixConfigured && !pixData?.paymentId && (
                      <p className="text-xs text-amber-700 mt-2 max-w-[260px]">
                        Chave PIX fixa: o sistema não verifica o recebimento automaticamente.
                        Confira no aplicativo do banco antes de confirmar.
                      </p>
                    )}
                  </div>
                </div>
                {pixConfigured && pixData?.qrCode && (
                  <button
                    onClick={copyPixKey}
                    className="w-full flex items-center justify-center gap-2 p-2 rounded-lg bg-muted hover:bg-muted/70 text-sm transition-colors"
                  >
                    {copied ? (
                      <>
                        <Check className="w-4 h-4 text-emerald-600" />
                        <span className="text-emerald-600 font-medium">Copiado!</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-4 h-4" />
                        <span className="truncate max-w-[260px]">{pixData.qrCode}</span>
                      </>
                    )}
                  </button>
                )}
                {!pixPaid && pixConfigured && pixData?.paymentId && (
                  // PIX gerado pelo Mercado Pago: o botão consulta o gateway
                  // (checkPixPayment) em vez de aceitar o clique como prova —
                  // mesmo fluxo já usado em PlanPaymentDialog.jsx.
                  <Button
                    variant="outline"
                    className="w-full gap-2"
                    disabled={pixVerifying}
                    onClick={verificarPixPagamento}
                  >
                    {pixVerifying ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Verificando...
                      </>
                    ) : (
                      <>
                        <Check className="w-4 h-4" />
                        Verificar pagamento
                      </>
                    )}
                  </Button>
                )}
                {!pixPaid && pixConfigured && !pixData?.paymentId && (
                  // Chave fixa: não existe gateway para consultar. O botão é
                  // uma declaração explícita do operador, rotulada como tal —
                  // nunca aparece como "verificado" ou "aprovado".
                  <Button
                    variant="outline"
                    className="w-full gap-2 border-amber-300 text-amber-800 hover:bg-amber-50"
                    onClick={confirmarPixManual}
                  >
                    <AlertCircle className="w-4 h-4" />
                    Confirmar recebimento manualmente (não verificado)
                  </Button>
                )}
              </div>
            )}

            {usaCtef && (
              <ConnectTefCardPanel
                estado={ctef}
                cobranca={cobrancaTef}
                valor={remaining || total}
                method={method}
                installments={installments}
                onInstallments={setInstallments}
              />
            )}

            {usaMaq && (
              <MaquininhaManualPanel
                valor={remaining || total}
                method={method}
                installments={installments}
                onInstallments={setInstallments}
                aprovado={cardApproved}
                nsu={maqNsu}
                onNsu={setMaqNsu}
                onConfirmar={confirmarMaquininha}
                onDesfazer={desfazerMaquininha}
              />
            )}

            {cartaoBloqueado && (
              <div className="space-y-3 p-4 rounded-lg border-2 border-dashed border-amber-300 bg-amber-50 text-center">
                <p className="text-sm font-medium text-amber-900">{resolucao.motivo}</p>
                {!resolucao.verificando && (canalCartao === "smartpos" || canalCartao === null) && (
                  <Button variant="outline" className="w-full" onClick={recarregarCtef}>Verificar novamente</Button>
                )}
              </div>
            )}

            {usaTef && (
              <div className="space-y-3">
                <div className="flex flex-col items-center gap-3 p-4 rounded-lg border-2 border-dashed border-primary/30 bg-primary/5">
                  <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
                    <Smartphone className="w-8 h-8 text-primary" />
                  </div>
                  <div className="text-center">
                    <p className="text-sm font-medium">
                      {cardStatus === TefStatus.APPROVED
                        ? "Pagamento aprovado!"
                        : cardStatus === TefStatus.DECLINED
                        ? "Pagamento recusado."
                        : cardStatus === TefStatus.TIMEOUT
                        ? "Sem resposta do PIN pad."
                        : cardStatus === TefStatus.ERROR
                        ? "Erro ao processar."
                        : cardProcessing
                        ? "Processando no PIN pad..."
                        : "Envie a cobrança para o PIN pad"}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Valor: {formatBRL(remaining || total)}
                    </p>
                  </div>
                  {cardApproved && (
                    <div className="flex items-center gap-2 text-emerald-600">
                      <Check className="w-5 h-5" strokeWidth={3} />
                      <span className="text-sm font-bold">Aprovado</span>
                    </div>
                  )}
                </div>
                {method === "credito" && (
                  <div>
                    <Label className="mb-2 block">Parcelas</Label>
                    <Select value={installments} onValueChange={setInstallments}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Array.from({ length: 12 }).map((_, i) => {
                          const n = i + 1;
                          const installmentValue = (remaining || total) / n;
                          return (
                            <SelectItem key={n} value={String(n)}>
                              {n}x de {formatBRL(installmentValue)}
                              {n === 1 ? " (à vista)" : ""}
                            </SelectItem>
                          );
                        })}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                {!cardApproved && (cardStatus === TefStatus.TIMEOUT || cardStatus === TefStatus.ERROR) ? (
                  <Button
                    variant="outline"
                    className="w-full gap-2"
                    onClick={consultarCardPayment}
                    disabled={cardProcessing}
                  >
                    {cardProcessing ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Consultando...
                      </>
                    ) : (
                      <>
                        <AlertCircle className="w-4 h-4" />
                        Consultar transação (não reenvia a cobrança)
                      </>
                    )}
                  </Button>
                ) : (
                  !cardApproved && (
                    <Button
                      variant="outline"
                      className="w-full gap-2"
                      onClick={startCardPayment}
                      disabled={cardProcessing || !!pendingRecovery}
                    >
                      {cardProcessing ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Processando...
                        </>
                      ) : (
                        <>
                          <CreditCard className="w-4 h-4" />
                          Enviar para o PIN pad
                        </>
                      )}
                    </Button>
                  )
                )}
              </div>
            )}

            {method === "crediario" && (
              <div>
                <Label className="mb-2 block">Selecionar Cliente</Label>
                <Select
                  value={selectedCustomer || undefined}
                  onValueChange={setSelectedCustomer}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Escolha o cliente..." />
                  </SelectTrigger>
                  <SelectContent>
                    {customers.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                        {c.credit_balance ? ` · Devendo ${formatBRL(c.credit_balance)}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {customers.length === 0 && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Nenhum cliente cadastrado. Cadastre em Clientes.
                  </p>
                )}
              </div>
            )}

            {/* Modifiers */}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className={cn(fieldLabel, "mb-1 block text-red-500")}>Desconto (R$) ↓</Label>
                <CurrencyInput value={discount} onChange={setDiscount} className="h-9" />
              </div>
              <div>
                <Label className={cn(fieldLabel, "mb-1 block text-emerald-600")}>Acréscimo (R$) ↑</Label>
                <CurrencyInput value={addition} onChange={setAddition} className="h-9" />
              </div>
            </div>
            <p className="text-[10px] text-muted-foreground">
              Setas ↑/↓ focam acréscimo/desconto e alternam % ↔ R$ — Enter volta ao valor recebido
            </p>

            {/* Add payment button */}
            <Button
              className="w-full gap-2 bg-sky-100 text-sky-700 hover:bg-sky-200 border border-sky-200"
              onClick={addPayment}
              disabled={remaining <= 0}
            >
              <Plus className="w-4 h-4" />
              Adicionar pagamento (Enter)
            </Button>

            {/* Payments list */}
            {payments.length > 0 && (
              <div>
                <Label className={cn(fieldLabel, "mb-2 block")}>Pagamentos Lançados</Label>
                <div className="space-y-1.5">
                  {payments.map((p, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between p-2 rounded-lg border bg-muted/50"
                    >
                      <span className="text-sm font-medium">{p.label}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold">{formatBRL(p.amount)}</span>
                        <button
                          onClick={() => removePayment(i)}
                          className="text-muted-foreground hover:text-destructive"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Right column */}
          <div className="lg:col-span-5 p-4 space-y-4 bg-muted/30">
            {/* Total to pay */}
            <div className="rounded-lg border p-3">
              <Label className={cn(fieldLabel, "block")}>Total a Pagar</Label>
              <p className="text-2xl font-bold text-primary mt-1">{formatBRL(adjustedTotal)}</p>
            </div>

            {/* Summary */}
            <div className="space-y-1.5 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Subtotal</span>
                <span className="font-medium">{formatBRL(subtotal)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Desconto</span>
                <span className="font-medium text-orange-600">-{formatBRL(discount || 0)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Acréscimo</span>
                <span className="font-medium text-emerald-600">+{formatBRL(addition || 0)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">
                  Pago ({payments.length} {payments.length === 1 ? "forma" : "formas"})
                </span>
                <span className="font-medium">{formatBRL(totalPaid)}</span>
              </div>
            </div>

            {/* Change */}
            <div className="rounded-lg border-2 border-primary/30 p-3 bg-primary/5">
              <Label className={cn(fieldLabel, "block")}>{falta > 0 ? "Falta" : "Troco"}</Label>
              <p className="text-3xl font-bold text-primary mt-1">{formatBRL(falta > 0 ? falta : change)}</p>
            </div>

            {/* Action buttons */}
            <div className="space-y-2">
              <Button
                onClick={() => handleConfirm()}
                disabled={!canFinalize || processing}
                className="w-full h-12 text-base font-bold gap-2"
              >
                {processing && <Loader2 className="w-4 h-4 animate-spin" />}
                FINALIZAR - F10
              </Button>
              <Button
                variant="outline"
                onClick={handleClose}
                disabled={processing}
                className="w-full h-10 gap-2"
              >
                Cancelar - ESC
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>

      <VendorSelectDialog
        open={vendorOpen}
        onClose={() => setVendorOpen(false)}
        currentVendorId={vendorId}
        onSelect={(u) => {
          setVendorName(u?.full_name || u?.email || "Vendedor");
          setVendorId(u?.id || "");
        }}
      />

      <IdentificacaoCupomDialog
        open={identificacaoOpen}
        onClose={() => setIdentificacaoOpen(false)}
        customer={customers.find((c) => c.id === selectedCustomer) || defaultCustomer}
        onConfirm={(doc) => setCupomDocument(doc)}
      />
    </Dialog>
  );
}