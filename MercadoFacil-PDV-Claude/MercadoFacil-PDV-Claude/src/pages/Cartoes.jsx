import React, { useState, useEffect, useMemo, useCallback } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { api } from "@/api/dataClient";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { CreditCard, Loader2, Power, QrCode, Printer, ScanLine, Keyboard, Search, Users, ShoppingBag, Clock } from "lucide-react";
import { toast } from "sonner";
import { formatBRL } from "@/lib/format";
import { mensagemDeErro } from "@/lib/mensagemErro";
import { loadProducts, loadCategories } from "@/lib/dataLayer";
import { totaisDaMesa } from "@/lib/mesas";
import {
  listarCartoes, localizarCartao, abrirAtendimentoDoCartao, interpretarEntradaCartao, pareceQrDeCartao,
  numeroExibicao, rotuloDoCartao, MSG_NAO_ENCONTRADO, MAX_CARTOES,
} from "@/lib/cartaoQr";
import { getCompanyForReceipt } from "@/lib/saleReceipt";
import { useBarcodeScanner } from "@/hooks/useBarcodeScanner";
import {
  lerConfigMesas, salvarConfigMesas, EVENTO_CONFIG_MESAS, listarAtendimentosAbertos, obterCompanyId, storeDeCartoes,
} from "@/lib/mesasApi";
import MesaDialog from "@/components/mesas/MesaDialog";
import { useCobrarAtendimento } from "@/components/mesas/useCobrarAtendimento";
import { QrCartaoDialog, ImprimirCartoesDialog, LerCartaoDialog, AbrirCartaoDialog } from "@/components/mesas/CartaoDialogs";

const tempoDesde = (iso) => {
  if (!iso) return "";
  const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  return `há ${h} h ${String(min % 60).padStart(2, "0")} min`;
};

/** Cartões/comandas físicos reutilizáveis: o cartão identifica o atendimento; a mesa é opcional. */
export default function Cartoes() {
  const navigate = useNavigate();
  const location = useLocation();
  const [config, setConfig] = useState(lerConfigMesas());
  const [orders, setOrders] = useState([]);
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [companyId, setCompanyId] = useState(null);
  const [empresa, setEmpresa] = useState("");
  const [aberto, setAberto] = useState(null); // número do cartão no diálogo de atendimento
  const [disponivel, setDisponivel] = useState(null); // cartão disponível aguardando "abrir atendimento"
  const [abrindo, setAbrindo] = useState(false);
  const [qrCartao, setQrCartao] = useState(null);
  const [imprimirAberto, setImprimirAberto] = useState(false);
  const [lerModo, setLerModo] = useState(null); // "qr" | "numero" | null
  const [busca, setBusca] = useState("");
  const { cobrar } = useCobrarAtendimento({ products, config });
  const faixa = { inicial: config.cartaoInicial, final: config.cartaoFinal };

  useEffect(() => {
    const sync = () => setConfig(lerConfigMesas());
    window.addEventListener(EVENTO_CONFIG_MESAS, sync);
    return () => window.removeEventListener(EVENTO_CONFIG_MESAS, sync);
  }, []);

  const carregar = useCallback(async () => {
    setLoading(true);
    try {
      setOrders(((await listarAtendimentosAbertos()) || []).filter((o) => o.card_number));
    } catch (e) {
      toast.error(mensagemDeErro(e, "carregar os cartões"));
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!config.ativo) {
      setLoading(false);
      return;
    }
    carregar();
    loadProducts().then(setProducts).catch(() => {});
    loadCategories().then(setCategories).catch(() => {});
    obterCompanyId().then(setCompanyId).catch(() => {});
    setEmpresa(getCompanyForReceipt().name);
  }, [config.ativo, carregar]);

  const cartoes = useMemo(() => listarCartoes(faixa, orders), [config.cartaoInicial, config.cartaoFinal, orders]); // eslint-disable-line react-hooks/exhaustive-deps
  const porCartao = useMemo(() => Object.fromEntries(orders.map((o) => [String(o.card_number), o])), [orders]);
  const emUso = cartoes.filter((c) => c.estado === "em_uso").length;
  const q = busca.trim();
  const visiveis = q ? cartoes.filter((c) => numeroExibicao(c.numero).includes(q) || c.numero === q.replace(/^0+/, "")) : cartoes;

  // Ponto único de localização do cartão (QR, leitor USB, câmera ou número): sempre na empresa da sessão.
  const tratarCartao = useCallback(async (numero) => {
    try {
      const me = await api.auth.me().catch(() => null);
      const store = storeDeCartoes(me?.full_name || me?.name || null);
      const r = await localizarCartao(store, numero, { inicial: config.cartaoInicial, final: config.cartaoFinal });
      if (r.estado === "em_uso") {
        setOrders((prev) => [...prev.filter((o) => o.id !== r.order.id), r.order]);
        setAberto(String(numero));
      } else if (r.estado === "disponivel") {
        setDisponivel(String(numero));
      } else {
        toast.error(MSG_NAO_ENCONTRADO);
      }
    } catch (e) {
      toast.error(mensagemDeErro(e, "localizar o cartão"));
    }
  }, [config.cartaoInicial, config.cartaoFinal]);

  const abrirAtendimento = async (mesa) => {
    setAbrindo(true);
    try {
      const me = await api.auth.me().catch(() => null);
      const { acao, order } = await abrirAtendimentoDoCartao(storeDeCartoes(me?.full_name || me?.name || null), disponivel, { mesa });
      setOrders((prev) => [...prev.filter((o) => o.id !== order.id), order]);
      setAberto(String(order.card_number));
      setDisponivel(null);
      if (acao === "ver") toast.info(`${rotuloDoCartao(order.card_number)} já estava em uso: atendimento aberto.`);
    } catch (e) {
      toast.error(mensagemDeErro(e, "abrir o atendimento do cartão"));
      carregar();
    }
    setAbrindo(false);
  };

  // QR do leitor USB (teclas + Enter) com a tela aberta: códigos de barras de produto são ignorados.
  useBarcodeScanner(async (codigo) => {
    if (!config.ativo || !pareceQrDeCartao(codigo)) return;
    const r = await interpretarEntradaCartao(codigo, companyId || (await obterCompanyId()));
    if (!r.ok) toast.error(r.mensagem);
    else tratarCartao(r.numero);
  });

  // Vindo do caixa (PDV): o cartão já foi resolvido lá; aqui só se localiza dentro da empresa da sessão.
  useEffect(() => {
    const numero = location.state?.abrirCartao;
    if (!numero || !config.ativo) return;
    navigate(location.pathname, { replace: true, state: null });
    tratarCartao(String(numero));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state, config.ativo]);

  const mudou = (novo) => {
    // fechada/cancelada: o cartão volta a DISPONÍVEL (o histórico do atendimento fica no banco)
    setOrders((prev) => (novo.status !== "aberta" ? prev.filter((o) => o.id !== novo.id) : prev.map((o) => (o.id === novo.id ? novo : o))));
  };

  const atual = aberto ? porCartao[aberto] : null;

  if (!config.ativo) {
    return (
      <div className="p-4 md:p-6 max-w-xl mx-auto">
        <Card className="p-8 text-center space-y-4">
          <CreditCard className="w-12 h-12 text-primary/50 mx-auto" />
          <div>
            <h1 className="text-xl font-heading font-bold">Cartões / comandas</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Opcional, para restaurantes: cartões numerados com QR, reutilizáveis. A venda rápida continua como está.
            </p>
          </div>
          <Button className="gap-2" onClick={() => salvarConfigMesas({ ativo: true })}>
            <Power className="w-4 h-4" /> Ativar mesas e cartões neste caixa
          </Button>
        </Card>
      </div>
    );
  }

  const limite = (v) => Math.max(1, Math.min(MAX_CARTOES, Number(v) || 1));
  return (
    <div className="p-4 md:p-6 space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-primary/10 flex items-center justify-center">
            <CreditCard className="w-6 h-6 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-heading font-bold">Cartões</h1>
            <p className="text-sm text-muted-foreground">{emUso} em uso · {cartoes.length - emUso} disponíveis</p>
          </div>
        </div>
        <div className="flex items-end gap-3 flex-wrap">
          <div>
            <Label className="text-[10px] uppercase text-muted-foreground">Cartão inicial</Label>
            <Input type="number" min={1} max={MAX_CARTOES} className="h-9 w-24" value={config.cartaoInicial}
              onChange={(e) => setConfig(salvarConfigMesas({ cartaoInicial: limite(e.target.value) }))} />
          </div>
          <div>
            <Label className="text-[10px] uppercase text-muted-foreground">Cartão final</Label>
            <Input type="number" min={1} max={MAX_CARTOES} className="h-9 w-24" value={config.cartaoFinal}
              onChange={(e) => setConfig(salvarConfigMesas({ cartaoFinal: limite(e.target.value) }))} />
          </div>
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setLerModo("qr")}>
            <ScanLine className="w-4 h-4" /> Ler cartão
          </Button>
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setLerModo("numero")}>
            <Keyboard className="w-4 h-4" /> Informar número
          </Button>
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setImprimirAberto(true)} disabled={!companyId}>
            <Printer className="w-4 h-4" /> Imprimir cartões/comandas
          </Button>
        </div>
      </div>

      <div className="rounded-xl border border-primary/30 bg-primary/5 px-4 py-3">
        <p className="text-sm font-semibold text-primary">Como funciona o cartão</p>
        <ol className="mt-1 grid gap-1 sm:grid-cols-3 text-xs text-muted-foreground">
          <li><strong className="text-foreground">1. Imprima os cartões</strong> — cada um com seu número e QR; recorte e plastifique.</li>
          <li><strong className="text-foreground">2. Entregue ao cliente</strong> — o consumo é lançado no cartão (qualquer mesa, ou nenhuma).</li>
          <li><strong className="text-foreground">3. No caixa</strong> — leia o QR ou digite o número e a comanda do cartão abre.</li>
        </ol>
        <p className="mt-1 text-[11px] text-muted-foreground">O cliente não precisa de celular. O QR do cartão não é um link: só funciona no MercadoFácil desta empresa. (QR de mesa é outro recurso e não aparece aqui.)</p>
      </div>

      <div className="relative max-w-xs">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input placeholder="Localizar cartão pelo número..." value={busca} onChange={(e) => setBusca(e.target.value)} className="pl-9"
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              interpretarEntradaCartao(busca, companyId).then((r) => {
                if (r.ok) tratarCartao(r.numero);
                else toast.error(r.mensagem);
              });
            }
          }} />
      </div>

      {loading ? (
        <div className="flex justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3">
          {visiveis.map((c) => {
            const uso = c.estado === "em_uso";
            const t = totaisDaMesa(c.order);
            return (
              <Card key={c.numero} className={`p-3 space-y-2 transition-shadow hover:shadow-md ${uso ? "border-amber-300 bg-amber-50/40" : ""}`}>
                <div className="flex items-start justify-between gap-1">
                  <p className="text-xl font-heading font-bold leading-none">{numeroExibicao(c.numero)}</p>
                  <Button size="sm" variant="ghost" className="h-7 px-2 -mt-1 shrink-0 gap-1 text-xs text-primary" onClick={() => setQrCartao(c.numero)} disabled={!companyId} aria-label={`Ver QR do cartão ${numeroExibicao(c.numero)}`} title="Ver / imprimir o QR deste cartão">
                    <QrCode className="w-4 h-4" /> Ver QR
                  </Button>
                </div>
                <Badge variant="outline" className={uso ? "bg-amber-100 text-amber-700 border-amber-200" : "bg-emerald-100 text-emerald-700 border-emerald-200"}>
                  {uso ? "EM USO" : "DISPONÍVEL"}
                </Badge>
                {uso ? (
                  <>
                    <p className="text-lg font-bold text-primary">{formatBRL(t.total)}</p>
                    <div className="text-[11px] text-muted-foreground space-y-0.5">
                      <p>{c.mesa ? `Mesa ${c.mesa}` : "Sem mesa"}</p>
                      <p className="flex items-center gap-1"><Users className="w-3 h-3" /> {t.qtdPessoas} · <ShoppingBag className="w-3 h-3" /> {t.qtdItens} · <Clock className="w-3 h-3" /> {tempoDesde(c.order.updated_at || c.order.created_at)}</p>
                    </div>
                    <Button className="w-full h-8" variant="outline" size="sm" onClick={() => setAberto(c.numero)}>Ver atendimento</Button>
                  </>
                ) : (
                  <Button className="w-full h-8" size="sm" onClick={() => setDisponivel(c.numero)}>Abrir atendimento</Button>
                )}
              </Card>
            );
          })}
        </div>
      )}

      <MesaDialog
        open={!!atual}
        order={atual}
        config={config}
        products={products}
        categories={categories}
        onClose={() => setAberto(null)}
        onChanged={mudou}
        onCharge={(sel) => cobrar(atual, sel)}
      />
      <AbrirCartaoDialog open={!!disponivel} numero={disponivel} abrindo={abrindo} onClose={() => setDisponivel(null)} onAbrir={abrirAtendimento} />
      <QrCartaoDialog open={!!qrCartao} onClose={() => setQrCartao(null)} numero={qrCartao} companyId={companyId} empresa={empresa} />
      <ImprimirCartoesDialog open={imprimirAberto} onClose={() => setImprimirAberto(false)} inicial={config.cartaoInicial} final={config.cartaoFinal} companyId={companyId} empresa={empresa} />
      <LerCartaoDialog open={!!lerModo} modo={lerModo || "qr"} onClose={() => setLerModo(null)} companyId={companyId}
        onResolvido={(numero) => { setLerModo(null); tratarCartao(numero); }} />
    </div>
  );
}
