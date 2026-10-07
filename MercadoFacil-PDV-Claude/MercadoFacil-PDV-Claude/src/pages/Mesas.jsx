import React, { useState, useEffect, useMemo, useCallback } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { api } from "@/api/dataClient";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import CurrencyInput from "@/components/ui/currency-input";
import { UtensilsCrossed, Loader2, Users, ShoppingBag, Clock, Power, QrCode, Printer, ScanLine, Keyboard, RefreshCw, Settings, Plus } from "lucide-react";
import { toast } from "sonner";
import { formatBRL } from "@/lib/format";
import { mensagemDeErro } from "@/lib/mensagemErro";
import { loadProducts, loadCategories } from "@/lib/dataLayer";
import { totaisDaMesa, statusDaMesa, abrirOuVerAtendimento, mesasParaExibir, resumoDasMesas, codigoDoAtendimento, tempoEStatusDaMesa } from "@/lib/mesas";
import { interpretarEntradaMesa, pareceLinkDeMesa } from "@/lib/mesaQr";
import { getCompanyForReceipt } from "@/lib/saleReceipt";
import { useBarcodeScanner } from "@/hooks/useBarcodeScanner";
import {
  lerConfigMesas, salvarConfigMesas, EVENTO_CONFIG_MESAS,
  listarAtendimentosAbertos, storeDeAtendimentos, obterCompanyId, carregarVersoesQr, invalidarQrDaMesa, listarMesasCadastradas,
} from "@/lib/mesasApi";
import MesaDialog from "@/components/mesas/MesaDialog";
import GerenciarMesasDialog from "@/components/mesas/GerenciarMesasDialog";
import AtivarMesasDialog from "@/components/mesas/AtivarMesasDialog";
import { useMesasAcesso } from "@/components/mesas/useMesasAcesso";
import { formatAddonPrice, ADDONS } from "@/lib/plans";
import { useCobrarAtendimento } from "@/components/mesas/useCobrarAtendimento";
import { QrMesaDialog, LerMesaDialog, ConfirmarAberturaDialog, imprimirQrDasMesas } from "@/components/mesas/MesaQrDialogs";

export default function Mesas() {
  const [config, setConfig] = useState(lerConfigMesas());
  const [orders, setOrders] = useState([]);
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [opening, setOpening] = useState(null);
  const [aberta, setAberta] = useState(null); // número da mesa no diálogo
  const [companyId, setCompanyId] = useState(null);
  const [versoes, setVersoes] = useState({}); // versão do QR por mesa (invalidação)
  const [empresa, setEmpresa] = useState("");
  const [qrMesa, setQrMesa] = useState(null); // mesa cujo QR/link está aberto
  const [confirmar, setConfirmar] = useState(null); // mesa LIVRE aguardando "Confirmar abertura"
  const [lerModo, setLerModo] = useState(null); // "qr" | "numero" | null
  const [cadastradas, setCadastradas] = useState(null); // mesas cadastradas (null = cadastro indisponível: usa 1..quantidade)
  const [gerenciar, setGerenciar] = useState(false);
  const [ativarAberto, setAtivarAberto] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { cobrar, faltaFiscal, usaFiscal } = useCobrarAtendimento({ products, config });
  const acesso = useMesasAcesso(config);
  // Mesas é adicional pago: ativar pede o aceite do reajuste (no teste) ou a contratação (plano ativo/vencido).
  const ativar = () => (acesso.precisaAceite ? setAtivarAberto(true) : salvarConfigMesas({ ativo: true }));
  const dialogoAtivar = <AtivarMesasDialog open={ativarAberto} onClose={() => setAtivarAberto(false)} acesso={acesso} />;

  useEffect(() => {
    const sync = () => setConfig(lerConfigMesas());
    window.addEventListener(EVENTO_CONFIG_MESAS, sync);
    return () => window.removeEventListener(EVENTO_CONFIG_MESAS, sync);
  }, []);

  const carregar = useCallback(async () => {
    setLoading(true);
    try {
      // Mesas = atendimentos de mesa (sem cartão). Os atendimentos de cartão/comanda ficam em Cartões.
      setOrders(((await listarAtendimentosAbertos()) || []).filter((o) => !o.card_number));
      setCadastradas(await listarMesasCadastradas());
    } catch (e) {
      toast.error(mensagemDeErro(e, "carregar as mesas"));
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
  }, [config.ativo, carregar]);

  const porMesa = useMemo(() => Object.fromEntries(orders.map((o) => [String(o.table_number), o])), [orders]);
  // Mesas cadastradas + qualquer mesa com atendimento aberto (nunca some uma mesa em uso). Sem cadastro: 1..quantidade.
  const numeros = useMemo(() => mesasParaExibir(cadastradas, orders.map((o) => o.table_number), config.quantidade), [cadastradas, orders, config.quantidade]);
  const resumo = useMemo(() => resumoDasMesas(numeros, orders.map((o) => o.table_number)), [numeros, orders]);

  useEffect(() => {
    if (!config.ativo) return;
    obterCompanyId().then(setCompanyId).catch(() => {});
    carregarVersoesQr().then(setVersoes);
    setEmpresa(getCompanyForReceipt().name);
  }, [config.ativo]);

  // Invalida o QR da mesa: a versão sobe no banco e o QR antigo para de resolver em todos os caixas.
  const invalidarQr = async (numero) => {
    const nova = await invalidarQrDaMesa(numero);
    setVersoes((v) => ({ ...v, [String(numero)]: nova }));
  };

  // Mesa LIVRE: abre. Mesa OCUPADA: abre o atendimento que já existe — nunca cria um segundo (o banco também recusa).
  const abrirMesa = async (numero) => {
    setOpening(numero);
    try {
      const me = await api.auth.me().catch(() => null);
      const { acao, order } = await abrirOuVerAtendimento(storeDeAtendimentos(me?.full_name || me?.name || null), String(numero));
      setOrders((prev) => [...prev.filter((o) => o.id !== order.id && String(o.table_number) !== String(numero)), order]);
      setAberta(String(numero));
      if (acao === "ver") toast.info(`Mesa ${numero} já está ocupada: atendimento aberto.`);
    } catch (e) {
      toast.error(mensagemDeErro(e, "abrir a mesa"));
      carregar();
    }
    setOpening(null);
    setConfirmar(null);
  };

  // Entrada da mesa (clique, QR, link ou número): ocupada abre o atendimento; livre pede confirmação antes de ocupar.
  const entrarNaMesa = (numero) => {
    const n = String(numero);
    if (porMesa[n]) setAberta(n);
    else setConfirmar(n);
  };

  // QR/link da mesa lido pelo leitor USB com a tela aberta: resolve na empresa da sessão. Código de barras de produto é ignorado.
  useBarcodeScanner(async (codigo) => {
    if (!config.ativo || !pareceLinkDeMesa(codigo)) return;
    const r = await interpretarEntradaMesa(codigo, companyId || (await obterCompanyId()), await carregarVersoesQr());
    if (!r.ok) toast.error(r.mensagem);
    else entrarNaMesa(r.numero);
  });

  // Vindo do caixa (PDV) ou do link /m/<token>: a mesa já foi resolvida na empresa da sessão.
  useEffect(() => {
    const numero = location.state?.abrirMesa;
    if (!numero || !config.ativo || loading) return;
    navigate(location.pathname, { replace: true, state: null });
    entrarNaMesa(numero);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state, config.ativo, loading]);

  const mudou = (novo) => {
    // fechada/cancelada: a mesa volta a LIVRE
    setOrders((prev) => (novo.status !== "aberta" ? prev.filter((o) => o.id !== novo.id) : prev.map((o) => (o.id === novo.id ? novo : o))));
  };

  const atual = aberta ? porMesa[aberta] : null;
  const BotaoQr = (n) => (
    <Button className="w-full gap-1.5" variant="outline" size="sm" disabled={!companyId} onClick={() => setQrMesa(n)} aria-label={`Ver QR / link da mesa ${n}`}>
      <QrCode className="w-4 h-4" /> Ver QR / link
    </Button>
  );

  if (!config.ativo) {
    return (
      <div className="p-4 md:p-6 max-w-xl mx-auto">
        <Card className="p-8 text-center space-y-4">
          <UtensilsCrossed className="w-12 h-12 text-primary/50 mx-auto" />
          <div>
            <h1 className="text-xl font-heading font-bold">Atendimento por mesa e cartão</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Opcional, para restaurantes: mesas e cartões/comandas com várias pessoas e almoço por peso. A venda rápida continua como está.
            </p>
          </div>
          <p className="text-xs text-muted-foreground">Adicional: {formatAddonPrice(ADDONS.find((a) => a.id === "mesas"))}</p>
          <Button className="gap-2" onClick={ativar}>
            <Power className="w-4 h-4" /> Ativar Mesas
          </Button>
        </Card>
        {dialogoAtivar}
      </div>
    );
  }

  // Mesas é adicional pago: sem direito de uso (teste vencido, plano ativo sem o adicional) a tela pede "Ativar Mesas".
  if (!acesso.liberadas) {
    return (
      <div className="p-4 md:p-6 max-w-xl mx-auto">
        <Card className="p-8 text-center space-y-4">
          <UtensilsCrossed className="w-12 h-12 text-primary/50 mx-auto" />
          <div>
            <h1 className="text-xl font-heading font-bold">Mesas é um adicional</h1>
            <p className="text-sm text-muted-foreground mt-1">Mapa do salão, QR de cada mesa e almoço por peso. Contrate o adicional para voltar a usar.</p>
          </div>
          <p className="text-sm font-semibold text-primary">{formatAddonPrice(ADDONS.find((a) => a.id === "mesas"))}</p>
          <Button className="gap-2" onClick={() => setAtivarAberto(true)}>
            <Power className="w-4 h-4" /> Ativar Mesas
          </Button>
        </Card>
        {dialogoAtivar}
      </div>
    );
  }

  const semMesas = cadastradas !== null && numeros.length === 0;
  const cabecalhoBtn = "h-9 gap-1.5 text-primary-foreground hover:bg-white/15 hover:text-primary-foreground";

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="rounded-xl bg-primary text-primary-foreground px-4 py-3 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <UtensilsCrossed className="w-5 h-5" />
            <h1 className="text-lg font-heading font-bold">Mesas</h1>
          </div>
          <div className="flex flex-wrap items-center gap-1">
            <Button variant="ghost" size="sm" className={cabecalhoBtn} onClick={() => setLerModo("qr")}>
              <ScanLine className="w-4 h-4" /> Ler QR
            </Button>
            <Button variant="ghost" size="sm" className={cabecalhoBtn} onClick={() => setLerModo("numero")}>
              <Keyboard className="w-4 h-4" /> Nº
            </Button>
            <Button variant="ghost" size="sm" className={cabecalhoBtn} disabled={!companyId || semMesas} onClick={() => imprimirQrDasMesas(companyId, numeros.filter((n) => /^\d+$/.test(n)), empresa, versoes)}>
              <Printer className="w-4 h-4" /> Imprimir QR das mesas
            </Button>
            <Button variant="ghost" size="icon" className={cabecalhoBtn} onClick={carregar} aria-label="Atualizar mesas" title="Atualizar">
              <RefreshCw className="w-4 h-4" />
            </Button>
            <Button variant="ghost" size="icon" className={cabecalhoBtn} onClick={() => setGerenciar(true)} disabled={cadastradas === null} aria-label="Gerenciar mesas" title={cadastradas === null ? "Cadastro de mesas indisponível (migration 083 pendente)" : "Gerenciar mesas"}>
              <Settings className="w-4 h-4" />
            </Button>
          </div>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs font-medium">
          <span className="rounded-full bg-white/15 px-2.5 py-0.5">{resumo.total} total</span>
          <span className="rounded-full bg-white/15 px-2.5 py-0.5">{resumo.livres} livres</span>
          <span className="rounded-full bg-white/15 px-2.5 py-0.5">{resumo.ocupadas} ocup.</span>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-lg border bg-card px-3 py-2">
        <div>
          <Label className="text-[10px] uppercase text-muted-foreground">Preço/kg padrão (almoço por peso)</Label>
          <CurrencyInput className="h-9 w-32" value={config.precoKg} onChange={(v) => setConfig(salvarConfigMesas({ precoKg: v }))} />
        </div>
        <div>
          <Label className="text-[10px] uppercase text-muted-foreground">Produto fiscal do almoço</Label>
          <select
            className="h-9 w-56 rounded-md border border-input bg-background px-2 text-sm"
            value={config.produtoFiscalId || ""}
            onChange={(e) => setConfig(salvarConfigMesas({ produtoFiscalId: e.target.value }))}
          >
            <option value="">Nenhum (sem NFC-e do almoço)</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
        <Button variant="ghost" size="sm" className="ml-auto text-muted-foreground" onClick={() => salvarConfigMesas({ ativo: false })}>
          Desativar
        </Button>
      </div>

      {usaFiscal && (!config.produtoFiscalId || faltaFiscal.length > 0) && (
        <p className="text-xs rounded-md border border-amber-300 bg-amber-50 text-amber-800 px-3 py-2">
          {!config.produtoFiscalId
            ? "Almoço por peso sem produto fiscal: a venda funciona, mas a NFC-e dessas linhas não será emitida. Cadastre o produto \"Almoço por quilo\" (NCM, CFOP, unidade e origem) e selecione-o acima."
            : `O produto fiscal escolhido está incompleto (falta: ${faltaFiscal.join(", ")}). Complete o cadastro em Produtos.`}
        </p>
      )}

      {semMesas && !loading && (
        <div className="rounded-xl border-2 border-dashed border-primary/40 px-6 py-12 text-center space-y-3">
          <UtensilsCrossed className="w-10 h-10 text-primary mx-auto" />
          <p className="text-base font-semibold">Nenhuma mesa cadastrada</p>
          <p className="text-sm text-muted-foreground">Crie a faixa 1–10 e imprima o QR de cada card.</p>
          <Button className="gap-2" onClick={() => setGerenciar(true)}>
            <Plus className="w-4 h-4" /> Criar mesas
          </Button>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>
      ) : semMesas ? null : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {numeros.map((n) => {
            const o = porMesa[n];
            const ocupada = statusDaMesa(o) === "ocupada";
            const t = totaisDaMesa(o);
            return (
              <Card key={n} className={`p-4 space-y-3 transition-shadow hover:shadow-md ${ocupada ? "border-amber-300 bg-amber-50/40" : ""}`}>
                <div className="flex items-start justify-between">
                  <p className="text-lg font-heading font-bold leading-none">Mesa {n}</p>
                  <Badge variant="outline" className={ocupada ? "bg-amber-100 text-amber-700 border-amber-200" : "bg-emerald-100 text-emerald-700 border-emerald-200"}>
                    {ocupada ? "OCUPADA" : "LIVRE"}
                  </Badge>
                </div>
                {ocupada ? (
                  <>
                    <p className="text-2xl font-bold text-primary">{formatBRL(t.total)}</p>
                    <p className="flex items-center gap-1 text-xs text-muted-foreground"><Clock className="w-3 h-3" /> {tempoEStatusDaMesa(o)}</p>
                    <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                      <span className="rounded border border-primary/30 bg-primary/5 px-1.5 py-0.5 font-mono font-semibold text-primary" title="Código do atendimento">Cód. {codigoDoAtendimento(o)}</span>
                      {t.qtdPessoas > 0 && <span className="flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-muted-foreground"><Users className="w-3 h-3" /> {t.qtdPessoas} {t.qtdPessoas === 1 ? "pessoa" : "pessoas"}</span>}
                      {t.qtdItens > 0 && <span className="flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-muted-foreground"><ShoppingBag className="w-3 h-3" /> {t.qtdItens} {t.qtdItens === 1 ? "item" : "itens"}</span>}
                    </div>
                    <Button className="w-full" variant="outline" onClick={() => setAberta(n)}>Ver atendimento</Button>
                    {BotaoQr(n)}
                  </>
                ) : (
                  <>
                    <p className="text-sm text-muted-foreground">Toque para abrir atendimento</p>
                    <Button className="w-full" onClick={() => setConfirmar(n)} disabled={opening === n}>
                      {opening === n ? <Loader2 className="w-4 h-4 animate-spin" /> : "Abrir atendimento"}
                    </Button>
                    {BotaoQr(n)}
                  </>
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
        onClose={() => setAberta(null)}
        onChanged={mudou}
        onCharge={(sel) => cobrar(atual, sel)}
      />
      {dialogoAtivar}
      <GerenciarMesasDialog open={gerenciar} onClose={() => setGerenciar(false)} cadastradas={cadastradas || []} ocupadas={orders.map((o) => o.table_number)} onAtualizado={carregar} />
      <QrMesaDialog open={!!qrMesa} onClose={() => setQrMesa(null)} numero={qrMesa} companyId={companyId} empresa={empresa} versoes={versoes} onInvalidar={invalidarQr} />
      <ConfirmarAberturaDialog open={!!confirmar} numero={confirmar} abrindo={opening === confirmar} onCancelar={() => setConfirmar(null)} onConfirmar={() => abrirMesa(confirmar)} />
      <LerMesaDialog open={!!lerModo} modo={lerModo || "qr"} companyId={companyId} versoes={versoes} onClose={() => setLerModo(null)} onResolvido={(numero) => { setLerModo(null); entrarNaMesa(numero); }} />
    </div>
  );
}
