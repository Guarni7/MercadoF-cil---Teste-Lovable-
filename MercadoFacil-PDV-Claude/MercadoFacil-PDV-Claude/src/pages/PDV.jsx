import React, { useState, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { api } from "@/api/dataClient";
import { registrarPagamentoDaMesa, lerConfigMesas, obterCompanyId, carregarVersoesQr, CARTOES_VISIVEIS } from "@/lib/mesasApi";
import { pareceLinkDeMesa, interpretarEntradaMesa } from "@/lib/mesaQr";
import { LerMesaDialog } from "@/components/mesas/MesaQrDialogs";
import { useMesasAcesso } from "@/components/mesas/useMesasAcesso";
import { pareceQrDeCartao, interpretarEntradaCartao } from "@/lib/cartaoQr";
import { LerCartaoDialog } from "@/components/mesas/CartaoDialogs";
import { ShoppingCart } from "lucide-react";
import { formatBRL, roundMoney } from "@/lib/format";
import { saleReceiptMessage } from "@/lib/saleNumber";
import { toast } from "sonner";
import PosLeftPanel from "@/components/pos/PosLeftPanel";
import Cart from "@/components/pos/Cart";
import CheckoutDialog from "@/components/pos/CheckoutDialog";
import ProductConsultDialog from "@/components/pos/ProductConsultDialog";
import SelectCustomerDialog from "@/components/pos/SelectCustomerDialog";
import ProductBrowserDialog from "@/components/pos/ProductBrowserDialog";
import CashDialog from "@/components/cash/CashDialog";
import SangriaDialog from "@/components/cash/SangriaDialog";
import SuprimentoDialog from "@/components/cash/SuprimentoDialog";
import CartItemDialog from "@/components/pos/CartItemDialog";
import SaleCompletedDialog from "@/components/pos/SaleCompletedDialog";
import SalesSummaryDialog from "@/components/sales/SalesSummaryDialog";
import ReturnExchangeDialog from "@/components/sales/ReturnExchangeDialog";
import WeighDialog from "@/components/pos/WeighDialog";
import NfceDialog from "@/components/pos/NfceDialog";
import CustomerDialog from "@/components/customers/CustomerDialog";
import { nfceHabilitada, sincronizarHabilitacaoFiscal } from "@/lib/fiscalConfig";
import { estoqueNegativoPermitido, sincronizarConfigEstoque } from "@/lib/stockConfig";
import { printSaleReceipt, isAutoPrintEnabled } from "@/lib/saleReceipt";
import { logActivity, describeSale } from "@/lib/activityLog";
import { trackPurchase, trackInitiateCheckout, trackAddToCart } from "@/lib/metaPixel";
import { validarPagamentosParaVenda, vincularPagamentosDaVenda } from "@/lib/connectTefCheckout";
import { valorCrediarioDaVenda } from "@/lib/crediario";
import { buscarPagamentoTef, vincularPagamentoTefAVenda } from "@/lib/connectTef";
import { useBarcodeScanner } from "@/hooks/useBarcodeScanner";
import {
  loadProducts,
  loadCategories,
  loadCustomers,
  isOnline,
  createSaleOffline,
  loadOpenCashRegister,
} from "@/lib/dataLayer";

export default function PDV() {
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [customers, setCustomers] = useState([]);
  // Cobrança de mesa/comanda: o atendimento (Mesas) entrega o carrinho pronto; o resto do fluxo é o do PDV.
  const location = useLocation();
  const navigate = useNavigate();
  const mesaInicial = location.state?.mesa || null;
  const [mesaCtx, setMesaCtx] = useState(mesaInicial ? { orderId: mesaInicial.orderId, rotulo: mesaInicial.rotulo, pessoaIds: mesaInicial.pessoaIds, itemIds: mesaInicial.itemIds } : null);
  const [cart, setCart] = useState(mesaInicial?.cart || []);
  const acessoMesas = useMesasAcesso();
  const mesasAtivas = lerConfigMesas().ativo && acessoMesas.liberadas; // Mesas é adicional pago
  const [lerCartaoModo, setLerCartaoModo] = useState(null); // "qr" | "numero" | null
  const [lerMesaModo, setLerMesaModo] = useState(null); // "qr" | "numero" | null
  const [companyIdMesa, setCompanyIdMesa] = useState(null);
  const [versoesMesa, setVersoesMesa] = useState({});
  const [companyIdCartao, setCompanyIdCartao] = useState(null);
  const [search, setSearch] = useState("");
  const [discount, setDiscount] = useState(0);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [mobileCartOpen, setMobileCartOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [selectedCustomer, setSelectedCustomer] = useState(null);

  const [consultOpen, setConsultOpen] = useState(false);
  const [customerOpen, setCustomerOpen] = useState(false);
  const [browserOpen, setBrowserOpen] = useState(false);
  const [cashOpen, setCashOpen] = useState(false);
  const [cashMode, setCashMode] = useState("open");
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [returnOpen, setReturnOpen] = useState(false);
  const [weighOpen, setWeighOpen] = useState(false);
  const [nfceOpen, setNfceOpen] = useState(false);
  const [lastSale, setLastSale] = useState(null);
  const [newCustomerOpen, setNewCustomerOpen] = useState(false);
  const [sangriaOpen, setSangriaOpen] = useState(false);
  const [suprimentoOpen, setSuprimentoOpen] = useState(false);
  const [cashRegister, setCashRegister] = useState(null);
  const [editingItem, setEditingItem] = useState(null);
  const [completedSale, setCompletedSale] = useState(null);

  // O carrinho da mesa vem do state da navegação: consome uma vez (recarregar a página não recria a cobrança).
  useEffect(() => {
    if (!mesaInicial) return;
    navigate(location.pathname, { replace: true, state: null });
    toast.info(`Cobrando ${mesaInicial.rotulo}`);
  }, []);

  useEffect(() => {
    loadData();
    // Atualiza o espelho de habilitação fiscal; se estiver offline, o PDV segue
    // com o último estado conhecido em vez de travar a venda.
    sincronizarHabilitacaoFiscal();
    sincronizarConfigEstoque();
  }, []);

  // Global barcode scanner: detects scanner input even when no input is focused
  // QR do cartão/comanda lido pelo leitor USB (teclas + Enter): localiza o atendimento em Cartões, dentro da empresa
  // da sessão. Venda em andamento não se perde.
  const abrirCartaoPorQr = async (texto) => {
    if (cart.length > 0) {
      toast.error("Finalize ou limpe a venda atual antes de abrir um cartão.");
      return;
    }
    const r = await interpretarEntradaCartao(texto, companyIdCartao || (await obterCompanyId()));
    if (!r.ok) {
      toast.error(r.mensagem);
      return;
    }
    navigate("/cartoes", { state: { abrirCartao: r.numero } });
  };

  // QR/link da mesa lido pelo leitor USB: abre a mesa em Mesas (empresa da sessão). Venda em andamento não se perde.
  const abrirMesaPorQr = async (texto) => {
    if (cart.length > 0) {
      toast.error("Finalize ou limpe a venda atual antes de abrir uma mesa.");
      return;
    }
    const r = await interpretarEntradaMesa(texto, companyIdMesa || (await obterCompanyId()), await carregarVersoesQr());
    if (!r.ok) {
      toast.error(r.mensagem);
      return;
    }
    navigate("/mesas", { state: { abrirMesa: r.numero } });
  };

  useBarcodeScanner((code) => {
    if (mesasAtivas && pareceLinkDeMesa(code)) {
      abrirMesaPorQr(code);
      return;
    }
    if (mesasAtivas && pareceQrDeCartao(code)) {
      abrirCartaoPorQr(code);
      return;
    }
    const match = products.find((p) => p.barcode === code || p.code === code);
    if (match) {
      addToCart(match);
      toast.success(`${match.name} adicionado (código: ${code})`);
    } else {
      toast.error(`Código não encontrado: ${code}`);
    }
  });

  const loadData = async () => {
    try {
      // Offline-first: sem internet os produtos vêm do banco local, senão o
      // caixa abriria o PDV vazio justamente durante a queda.
      const filtered = await loadProducts();
      setProducts(filtered);
      if (filtered.length === 0) {
        toast.error("Nenhum produto encontrado.");
      }
    } catch (e) {
      console.error(e);
      toast.error("Erro ao carregar produtos: " + (e.message || e));
    } finally {
      setLoading(false);
    }
    try {
      const [cats, custs, reg] = await Promise.all([
        loadCategories(),
        loadCustomers(),
        loadOpenCashRegister(),
      ]);
      setCategories(cats);
      setCustomers(custs);
      setCashRegister(reg);
    } catch (e) {
      console.error(e);
    }
  };

  const addToCart = (product) => {
    if ((product.stock || 0) <= 0) {
      toast.error("Produto sem estoque!");
      return;
    }
    trackAddToCart(product.price);
    setCart((prev) => {
      const existing = prev.find((item) => item.product.id === product.id);
      if (existing) {
        if (existing.quantity >= (product.stock || 0)) {
          toast.error("Quantidade maior que estoque!");
          return prev;
        }
        return prev.map((item) =>
          item.product.id === product.id
            ? { ...item, quantity: item.quantity + 1 }
            : item
        );
      }
      return [...prev, { product, quantity: 1 }];
    });
  };

  const addWeightedToCart = (product, weight) => {
    if ((product.stock || 0) <= 0) {
      toast.error("Produto sem estoque!");
      return;
    }
    trackAddToCart(product.price * weight);
    setCart((prev) => {
      const existing = prev.find((item) => item.product.id === product.id);
      if (existing) {
        return prev.map((item) =>
          item.product.id === product.id
            ? { ...item, quantity: item.quantity + weight }
            : item
        );
      }
      return [...prev, { product, quantity: weight }];
    });
    toast.success(`${product.name}: ${weight.toFixed(3).replace(".", ",")} kg adicionado`);
  };

  const updateQuantity = (productId, delta) => {
    setCart((prev) =>
      prev
        .map((item) => {
          if (item.product.id === productId) {
            const newQty = item.quantity + delta;
            if (delta > 0 && newQty > (item.product.stock || 0)) {
              toast.error("Quantidade maior que estoque!");
              return item;
            }
            return { ...item, quantity: newQty };
          }
          return item;
        })
        .filter((item) => item.quantity > 0)
    );
  };

  const removeFromCart = (productId) => {
    setCart((prev) => prev.filter((item) => item.product.id !== productId));
  };

  const updateCartItem = (productId, updates) => {
    setCart((prev) =>
      prev.map((item) =>
        item.product.id === productId ? { ...item, ...updates } : item
      )
    );
  };

  const clearCart = () => {
    setMesaCtx(null);
    setCart([]);
    setDiscount(0);
    setSelectedCustomer(null);
  };

  const subtotal = cart.reduce((sum, item) => {
    const price = item.customPrice || item.product.price;
    const lineTotal = price * item.quantity;
    const itemDiscount = item.itemDiscount || 0;
    // Mesmo arredondamento por linha usado no total gravado (items[].total)
    // — sem isso um item pesável (quantidade fracionária) deixaria o
    // subtotal exibido na tela com mais casas decimais do que o valor que
    // a trigger de integridade (migration 049) realmente vai gravar.
    return sum + roundMoney(Math.max(0, lineTotal - itemDiscount));
  }, 0);
  const total = Math.max(0, subtotal - (discount || 0));

  const handleCheckout = async (paymentData) => {
    const saleTotal = paymentData.total || total;
    trackInitiateCheckout(saleTotal);
    try {
      // Mesa só fecha online: a venda e a baixa da mesa precisam andar juntas (offline a mesa ficaria aberta e
      // seria cobrada de novo).
      if (mesaCtx && !isOnline()) {
        toast.error("Sem internet: a cobrança de mesa precisa de conexão. Aguarde voltar.");
        return false;
      }
      // Estoque insuficiente: valida ANTES de criar a venda, com o nome de
      // cada produto sem saldo — nunca deixa a venda ser criada pela metade
      // pra descobrir no meio do loop de baixa. Online, revalida contra o
      // banco (o carrinho pode ter ficado parado enquanto o cliente decidia,
      // e outro caixa pode ter vendido o mesmo item nesse meio-tempo); offline
      // usa o cache local. O banco (apply_stock_movement, 057) confere de
      // novo na hora de aplicar — esta checagem aqui é só pra dar o aviso
      // certo, não é a única proteção contra corrida entre caixas.
      // Linhas avulsas (almoço por peso de mesa) não são produto: sem estoque para conferir.
      const cartEstoque = cart.filter((item) => !item.product.semEstoque);
      if (!estoqueNegativoPermitido() && cartEstoque.length > 0) {
        let estoques = cartEstoque.map((item) => item.product.stock);
        if (isOnline()) {
          try {
            const frescos = await Promise.all(cartEstoque.map((item) => api.entities.Product.get(item.product.id)));
            estoques = frescos.map((p, i) => (p ? p.stock : cartEstoque[i].product.stock));
          } catch (e) {
            console.error("Falha ao revalidar estoque antes da venda:", e);
          }
        }
        const semSaldo = cartEstoque.filter((item, i) => (Number(estoques[i]) || 0) < item.quantity);
        if (semSaldo.length > 0) {
          toast.error(`Estoque insuficiente: ${semSaldo.map((i) => i.product.name).join(", ")}`);
          return false;
        }
      }

      // Pagamento já aprovado no Smart POS exige conferência/vínculo no servidor:
      // offline não há como fazer, então a venda espera a conexão voltar. Os demais canais de
      // cartão (maquininha manual, TEF pelo agente local) não dependem do servidor e podem ser
      // vendidos offline; o canal escolhido já vem gravado no pagamento (channel).
      const temTef = (paymentData.payments || []).some((p) => p.provider === "connecttef" || p.channel === "smartpos");
      if (temTef && !isOnline()) {
        toast.error("Sem internet: a venda com pagamento do Smart POS só pode ser finalizada online. Aguarde a conexão voltar.");
        return false;
      }

      // === OFFLINE: salva localmente e enfileira para sincronização ===
      if (!isOnline()) {
        const cashRegister = await loadOpenCashRegister();
        const customer = selectedCustomer || customers.find((c) => c.id === paymentData.customerId);

        await createSaleOffline(
          {
            items: cart.map((item) => ({
              // Almoço por peso (mesa): não baixa estoque; leva o produto fiscal da empresa (se houver) só para os dados fiscais.
          product_id: item.product.semEstoque ? item.product.produtoFiscalId || null : item.product.id,
          ...(item.product.origem ? { origem: item.product.origem } : {}),
              name: item.product.name,
              price: item.customPrice || item.product.price,
              quantity: item.quantity,
              total: roundMoney(Math.max(0, (item.customPrice || item.product.price) * item.quantity - (item.itemDiscount || 0))),
              notes: item.notes,
            })),
            subtotal,
            discount: paymentData.discount || discount || 0,
            addition: paymentData.addition || 0,
            total: saleTotal,
            payment_method: paymentData.method,
            amount_received: paymentData.amountReceived || saleTotal,
            change: paymentData.change || 0,
            // pix_payment_id só existe quando o Mercado Pago gerou a cobrança
            // (checkPixPayment confirmou de verdade). PIX de chave fixa
            // confirmado manualmente pelo operador não tem id de gateway —
            // fica null aqui de propósito, para nunca parecer verificado.
            pix_payment_id: paymentData.pixPaymentId || null,
            // Detalhamento de pagamento misto (dinheiro+cartão, etc.) — cada
            // lançamento já vem de CheckoutDialog.jsx com transactionId (TEF)
            // e pixPaymentId próprios, quando existem. Vazio para venda
            // simples continua sendo tratado como antes (trigger no banco
            // não valida array vazio).
            payments: paymentData.payments || [],
            status: "concluida",
            customer_id: paymentData.customerId || "",
            customer_name: paymentData.customerName || "Consumidor",
            customer_document: paymentData.cupomDocument || "",
            created_by_id: paymentData.sellerId || "",
            created_by_name: paymentData.sellerName || "",
            cash_register_id: cashRegister?.id || "",
          },
          cart,
          cashRegister,
          customer
        );

        toast.success(`Venda registrada (offline) — será sincronizada! ${formatBRL(saleTotal)}`);
        // Venda offline ainda não existe no servidor: sem isto o botão de nota
        // reaproveitaria a última venda online (agora com UUID válido).
        setLastSale(null);
        setCompletedSale({ total: saleTotal, number: null });
        clearCart();
        setSelectedCustomer(null);
        setCheckoutOpen(false);
        setMobileCartOpen(false);
        loadData();
        return true;
      }

      // === ONLINE: fluxo normal ===
      // A venda só nasce com pagamento ConnectTEF "aprovado", sem venda e do mesmo
      // valor — conferido de novo no servidor, não só na tela.
      const validacaoTef = await validarPagamentosParaVenda(paymentData.payments, buscarPagamentoTef);
      if (!validacaoTef.ok) {
        toast.error(validacaoTef.erro);
        return false;
      }
      const registers = await api.entities.CashRegister.filter(
        { status: "aberto" },
        "-opened_at",
        1
      );
      const cashRegister = registers[0];

      // O número é atribuído pelo banco (trigger sales_assign_number), senão
      // dois caixas vendendo ao mesmo tempo gerariam o mesmo número.
      const createdSale = await api.entities.Sale.create({
        number: null,
        items: cart.map((item) => ({
          // Almoço por peso (mesa): não baixa estoque; leva o produto fiscal da empresa (se houver) só para os dados fiscais.
          product_id: item.product.semEstoque ? item.product.produtoFiscalId || null : item.product.id,
          ...(item.product.origem ? { origem: item.product.origem } : {}),
          name: item.product.name,
          price: item.customPrice || item.product.price,
          quantity: item.quantity,
          total: roundMoney(Math.max(0, (item.customPrice || item.product.price) * item.quantity - (item.itemDiscount || 0))),
          notes: item.notes,
        })),
        subtotal,
        discount: paymentData.discount || discount || 0,
        addition: paymentData.addition || 0,
        total: saleTotal,
        payment_method: paymentData.method,
        amount_received: paymentData.amountReceived || saleTotal,
        change: paymentData.change || 0,
        // Ver comentário equivalente no bloco offline acima.
        pix_payment_id: paymentData.pixPaymentId || null,
        payments: paymentData.payments || [],
        status: "concluida",
        customer_id: paymentData.customerId || "",
        customer_name: paymentData.customerName || "Consumidor",
        customer_document: paymentData.cupomDocument || "",
        created_by_id: paymentData.sellerId || "",
        created_by_name: paymentData.sellerName || "",
        cash_register_id: cashRegister?.id || "",
      });
      const nextNumber = createdSale?.number ?? null;
      const vinculo = await vincularPagamentosDaVenda(paymentData.payments, createdSale.id, vincularPagamentoTefAVenda);
      if (!vinculo.ok) {
        console.error("Falha ao vincular pagamento do Smart POS à venda", createdSale.id, vinculo.falhas);
        toast.warning("Venda criada, mas não foi possível vincular o pagamento do Smart POS a ela. Avise o suporte.");
      }

      // Mesma rotina do sync offline: baixa e movimentação na mesma transação,
      // para o histórico de estoque cobrir também as vendas feitas online.
      // apply_stock_movement (057) confere o saldo de novo, atomicamente —
      // se outro caixa vendeu o mesmo item entre a checagem acima e aqui
      // (corrida rara, a pré-checagem não é atômica com isto), a baixa deste
      // item é recusada em vez de deixar o estoque ir a negativo; a venda já
      // foi criada, então isto vira aviso pro operador resolver manualmente
      // em vez de fingir que a baixa aconteceu.
      for (const item of cart.filter((i) => !i.product.semEstoque)) {
        const resultado = await api.stock.applyMovement({
          clientId: `${createdSale.id}-${item.product.id}`,
          productId: item.product.id,
          quantity: item.quantity,
          productName: item.product.name,
          type: "saida",
          reason: "venda",
          notes: `Venda${nextNumber ? ` #${nextNumber}` : ""}`,
        });
        if (resultado?.applied === false && resultado.reason === "insufficient_stock") {
          console.error(`Baixa de estoque recusada (saldo insuficiente) para ${item.product.name} na venda ${createdSale.id}`);
          toast.error(`Estoque de "${item.product.name}" ficou negativo por uma venda simultânea — confira manualmente.`);
        }
      }

      // sales_total/sales_count de cash_registers não são mais atualizados
      // aqui: o trigger trg_sales_touch_cash_register (migration 049) já
      // recalcula os dois a partir das vendas reais assim que a venda acima
      // é gravada — evita confiar num total calculado no cliente.

      // Só o que foi lançado como crediário vira dívida (venda mista: não o total).
      const valorCrediario = valorCrediarioDaVenda({ payments: paymentData.payments, payment_method: paymentData.method, total: saleTotal });
      if (valorCrediario > 0 && paymentData.customerId) {
        const customer = await api.entities.Customer.get(paymentData.customerId);
        await api.entities.Customer.update(paymentData.customerId, {
          credit_balance: (customer.credit_balance || 0) + valorCrediario,
        });
      }

      // Registra no log de atividades. PIX confirmado manualmente (chave
      // fixa, sem id de gateway) fica marcado explicitamente aqui — é o
      // registro de auditoria de que ninguém verificou o recebimento além
      // do próprio operador.
      const pixManualNote =
        paymentData.method === "pix" && paymentData.pixConfirmationType === "manual"
          ? "PIX confirmado manualmente pelo operador, sem verificação bancária"
          : null;
      await logActivity({
        type: "venda",
        description: describeSale(
          nextNumber,
          total,
          paymentData.method,
          paymentData.change || 0,
          paymentData.customerName,
          pixManualNote
        ),
        severity: "info",
        amount: saleTotal,
        changeAmount: paymentData.change || 0,
        saleNumber: nextNumber,
        cashRegisterId: cashRegister?.id || "",
        paymentMethod: paymentData.method,
        details: paymentData.customerName
          ? `Cliente: ${paymentData.customerName}`
          : "Consumidor",
      });

      trackPurchase(saleTotal);
      toast.success(
        `Venda ${nextNumber ? `#${nextNumber} ` : ""}concluída! ${formatBRL(saleTotal)}`
      );

      setLastSale({
        // id é o UUID real da venda (o NfceDialog o envia ao fiscal-emit); o
        // número é só o rótulo exibido ao operador.
        id: createdSale?.id ?? null,
        number: nextNumber,
        items: cart.map((item) => ({
          // Almoço por peso (mesa): não baixa estoque; leva o produto fiscal da empresa (se houver) só para os dados fiscais.
          product_id: item.product.semEstoque ? item.product.produtoFiscalId || null : item.product.id,
          ...(item.product.origem ? { origem: item.product.origem } : {}),
          name: item.product.name,
          price: item.customPrice || item.product.price,
          quantity: item.quantity,
          total: roundMoney(Math.max(0, (item.customPrice || item.product.price) * item.quantity - (item.itemDiscount || 0))),
          barcode: item.product.barcode,
          unit: item.product.unit,
        })),
        subtotal,
        discount: paymentData.discount || discount || 0,
        total: saleTotal,
        payment_method: paymentData.method,
        change: paymentData.change || 0,
        amount_received: paymentData.amountReceived || saleTotal,
        customer_name: paymentData.customerName || selectedCustomer?.name || "",
        customer_phone: selectedCustomer?.phone || "",
      });
      setCompletedSale({ total: saleTotal, number: nextNumber });

      if (isAutoPrintEnabled() && !nfceHabilitada()) {
        const receiptSale = {
          number: nextNumber,
          items: cart.map((item) => ({
            name: item.product.name,
            price: item.customPrice || item.product.price,
            quantity: item.quantity,
            total: roundMoney(Math.max(0, (item.customPrice || item.product.price) * item.quantity - (item.itemDiscount || 0))),
            unit: item.product.unit,
          })),
          subtotal,
          discount: paymentData.discount || discount || 0,
          total: saleTotal,
          payment_method: paymentData.method,
          change: paymentData.change || 0,
          payments: paymentData.payments || [],
        };
        const receiptCustomer = selectedCustomer
          ? { name: selectedCustomer.name, phone: selectedCustomer.phone }
          : paymentData.customerName
            ? { name: paymentData.customerName }
            : null;
        setTimeout(() => {
          printSaleReceipt({ sale: receiptSale, customer: receiptCustomer });
        }, 400);
      }

      if (mesaCtx) {
        try {
          await registrarPagamentoDaMesa(mesaCtx.orderId, mesaCtx, createdSale?.id ?? null);
          toast.success(`${mesaCtx.rotulo}: pagamento registrado.`);
        } catch (e) {
          console.error("Falha ao baixar a mesa após a venda", createdSale?.id, e);
          toast.error("Venda criada, mas não foi possível atualizar o atendimento. NÃO cobre de novo: abra Mesas/Cartões e confira.");
        }
      }

      clearCart();
      setSelectedCustomer(null);
      setCheckoutOpen(false);
      setMobileCartOpen(false);
      loadData();
      return true;
    } catch (e) {
      console.error(e);
      toast.error("Erro ao finalizar venda.");
      return false;
    }
  };

  const handleQuickAction = (actionId) => {
    switch (actionId) {
      case "consult":
        setConsultOpen(true);
        break;
      case "customer":
        setCustomerOpen(true);
        break;
      case "cash":
        setCashMode(cashRegister ? "close" : "open");
        setCashOpen(true);
        break;
      case "sangria":
        setSangriaOpen(true);
        break;
      case "suprimento":
        setSuprimentoOpen(true);
        break;
      case "summary":
        setSummaryOpen(true);
        break;
      case "return":
        setReturnOpen(true);
        break;
      case "weigh":
        setWeighOpen(true);
        break;
      case "mesa_qr":
      case "mesa_numero":
        if (cart.length > 0) toast.error("Finalize ou limpe a venda atual antes de abrir uma mesa.");
        else {
          obterCompanyId().then(setCompanyIdMesa).catch(() => {});
          carregarVersoesQr().then(setVersoesMesa);
          setLerMesaModo(actionId === "mesa_qr" ? "qr" : "numero");
        }
        break;
      case "cartao":
      case "cartao_numero":
        if (cart.length > 0) toast.error("Finalize ou limpe a venda atual antes de abrir um cartão.");
        else {
          obterCompanyId().then(setCompanyIdCartao).catch(() => {});
          setLerCartaoModo(actionId === "cartao" ? "qr" : "numero");
        }
        break;
      case "reprint":
        toast.info("Selecione uma venda no Gerenciador para reimprimir.");
        break;
      default:
        break;
    }
  };

  // Keyboard shortcuts
  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === "F1") { e.preventDefault(); setSangriaOpen(true); }
      else if (e.key === "F2") { e.preventDefault(); setSuprimentoOpen(true); }
      else if (e.key === "F4") { e.preventDefault(); setConsultOpen(true); }
      else if (e.key === "F5") { e.preventDefault(); setCustomerOpen(true); }
      else if (e.key === "F6") { e.preventDefault(); setCashMode(cashRegister ? "close" : "open"); setCashOpen(true); }
      else if (e.key === "F7") { e.preventDefault(); setSummaryOpen(true); }
      else if (e.key === "F8") { e.preventDefault(); setWeighOpen(true); }
      else if (e.key === "F9") { e.preventDefault(); toast.info("Selecione uma venda no Gerenciador para reimprimir."); }
      else if (e.key === "F10") { e.preventDefault(); if (cart.length > 0) setCheckoutOpen(true); }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [cart.length]);

  const cartProps = {
    items: cart,
    onUpdateQuantity: updateQuantity,
    onRemove: removeFromCart,
    onClear: clearCart,
    subtotal,
    discount,
    setDiscount,
    total,
    onCheckout: () => setCheckoutOpen(true),
    onEditItem: setEditingItem,
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="w-8 h-8 border-4 border-muted border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex h-full">
      {/* Left panel - Product input + Quick actions */}
      <div className="hidden md:flex w-80 lg:w-96 border-r flex-col shrink-0">
        <PosLeftPanel
          mesasAtivas={mesasAtivas}
          cartoesVisiveis={CARTOES_VISIVEIS}
          products={products}
          search={search}
          setSearch={setSearch}
          onAddToCart={addToCart}
          onQuickAction={handleQuickAction}
          onBrowseProducts={() => setBrowserOpen(true)}
        />
      </div>

      {/* Right panel - Cart / Caixa Livre */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <Cart {...cartProps} selectedCustomer={selectedCustomer} onClearCustomer={() => setSelectedCustomer(null)} />
      </div>

      {/* Mobile cart button */}
      {cart.length > 0 && (
        <button
          onClick={() => setMobileCartOpen(true)}
          className="md:hidden fixed bottom-4 right-4 z-30 bg-primary text-primary-foreground rounded-full px-5 py-3 shadow-lg flex items-center gap-2 font-medium"
        >
          <ShoppingCart className="w-5 h-5" />
          {cart.length} · {formatBRL(total)}
        </button>
      )}

      {/* Mobile cart overlay */}
      {mobileCartOpen && (
        <div className="md:hidden fixed inset-0 z-50 bg-background flex flex-col">
          <Cart {...cartProps} selectedCustomer={selectedCustomer} onClearCustomer={() => setSelectedCustomer(null)} onClose={() => setMobileCartOpen(false)} />
        </div>
      )}

      {/* Dialogs */}
      <CheckoutDialog
        open={checkoutOpen}
        onClose={() => setCheckoutOpen(false)}
        total={total}
        defaultCustomer={selectedCustomer}
        onConfirm={handleCheckout}
      />

      <ProductConsultDialog
        open={consultOpen}
        onClose={() => setConsultOpen(false)}
        products={products}
        onSelect={(product) => {
          addToCart(product);
          toast.success(`${product.name} adicionado`);
        }}
      />

      <SelectCustomerDialog
        open={customerOpen}
        onClose={() => setCustomerOpen(false)}
        customers={customers}
        onSelect={(customer) => {
          setSelectedCustomer(customer);
          if (customer) {
            toast.info(`Cliente: ${customer.name}`);
          }
        }}
        onNewCustomer={() => setNewCustomerOpen(true)}
      />

      <CustomerDialog
        open={newCustomerOpen}
        onClose={() => setNewCustomerOpen(false)}
        onSaved={loadData}
        onSelect={(c) => {
          setSelectedCustomer(c);
          toast.success(`Cliente selecionado: ${c.name}`);
        }}
      />

      <ProductBrowserDialog
        open={browserOpen}
        onClose={() => setBrowserOpen(false)}
        products={products}
        categories={categories}
        onAddToCart={addToCart}
      />

      <CashDialog
        open={cashOpen}
        onClose={() => setCashOpen(false)}
        mode={cashMode}
        register={cashRegister}
        onSaved={loadData}
      />

      <SalesSummaryDialog
        open={summaryOpen}
        onClose={() => setSummaryOpen(false)}
      />

      <ReturnExchangeDialog
        open={returnOpen}
        onClose={() => setReturnOpen(false)}
      />

      <LerMesaDialog
        open={!!lerMesaModo}
        modo={lerMesaModo || "qr"}
        onClose={() => setLerMesaModo(null)}
        companyId={companyIdMesa}
        versoes={versoesMesa}
        onResolvido={(numero) => {
          setLerMesaModo(null);
          navigate("/mesas", { state: { abrirMesa: numero } });
        }}
      />
      <LerCartaoDialog
        open={!!lerCartaoModo}
        modo={lerCartaoModo || "qr"}
        onClose={() => setLerCartaoModo(null)}
        companyId={companyIdCartao}
        onResolvido={(numero) => {
          setLerCartaoModo(null);
          navigate("/cartoes", { state: { abrirCartao: numero } });
        }}
      />
      <WeighDialog
        open={weighOpen}
        onClose={() => setWeighOpen(false)}
        products={products}
        onAddWeighted={addWeightedToCart}
      />

      <NfceDialog
        open={nfceOpen}
        onClose={() => setNfceOpen(false)}
        sale={lastSale}
        customer={selectedCustomer}
      />

      <SangriaDialog
        open={sangriaOpen}
        onClose={() => setSangriaOpen(false)}
        register={cashRegister}
        onSaved={loadData}
      />

      <SuprimentoDialog
        open={suprimentoOpen}
        onClose={() => setSuprimentoOpen(false)}
        register={cashRegister}
        onSaved={loadData}
      />

      <CartItemDialog
        open={!!editingItem}
        onClose={() => setEditingItem(null)}
        item={editingItem}
        onUpdate={updateCartItem}
        onRemove={removeFromCart}
      />

      <SaleCompletedDialog
        open={!!completedSale}
        onClose={() => setCompletedSale(null)}
        total={completedSale?.total || 0}
        onPrint={async () => {
          setCompletedSale(null);
          if (nfceHabilitada()) {
            setNfceOpen(true);
            return;
          }
          if (!lastSale) {
            toast.error("Dados da venda não encontrados para imprimir.");
            return;
          }
          const result = await printSaleReceipt({
            sale: lastSale,
            customer: lastSale.customer_name
              ? { name: lastSale.customer_name, phone: lastSale.customer_phone }
              : null,
          });
          if (result?.ok) {
            if (result.reason === "electron") {
              toast.success("Cupom enviado à impressora.");
            }
            // browser: se tiver --kiosk-printing sai direto; senão o Windows mostra o diálogo
            return;
          }
          toast.error(result?.error || "Falha ao imprimir. Verifique a impressora em Configurações.");
        }}
        onWhatsApp={() => {
          const phone = lastSale?.customer_phone || "";
          const msg = saleReceiptMessage(completedSale, formatBRL(completedSale?.total || 0));
          const url = phone
            ? `https://wa.me/55${phone.replace(/\D/g, "")}?text=${encodeURIComponent(msg)}`
            : `https://wa.me/?text=${encodeURIComponent(msg)}`;
          window.open(url, "_blank");
          setCompletedSale(null);
        }}
      />
    </div>
  );
}