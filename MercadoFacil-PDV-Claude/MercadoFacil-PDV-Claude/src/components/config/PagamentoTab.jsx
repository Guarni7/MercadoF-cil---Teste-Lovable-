import React, { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { api } from "@/api/dataClient";
import { getMercadoPagoWebhookUrl } from "@/api/supabaseData";
import { getCachedPaymentConfig, lerPaymentConfigDoServidor, savePaymentConfig } from "@/lib/paymentConfig";
import { estadoDaConfig, podeSalvarPagamento } from "@/lib/pagamentoTabEstado";
import { generateBRCode, getQrCodeUrl } from "@/lib/pix";
import {
  QrCode,
  CreditCard,
  Check,
  AlertCircle,
  ExternalLink,
  Copy,
  Loader2,
  Smartphone,
  Plug,
  Building2,
  Cpu,
  Wifi,
} from "lucide-react";
import { checkTefStatus } from "@/lib/tef";
import { ROTULOS_CANAL } from "@/lib/cardChannel";
import { listarSmartPos } from "@/lib/connectTef";
import SmartPosConnectTef from "@/components/config/SmartPosConnectTef";

const PIX_KEY_TYPES = [
  { id: "email", label: "E-mail" },
  { id: "cpf", label: "CPF" },
  { id: "cnpj", label: "CNPJ" },
  { id: "phone", label: "Telefone" },
  { id: "random", label: "Chave Aleatória" },
];

const CARD_PROVIDERS = [
  { id: "mercadopago", name: "Mercado Pago", models: ["Moderninha Pro 2", "Moderninha Smart", "Moderninha X"] },
  { id: "stone", name: "Stone", models: ["S920", "S800", "A910"] },
  { id: "cielo", name: "Cielo", models: ["LIO V3", "LIO 5", "G700"] },
  { id: "rede", name: "Rede", models: ["Rede Smart", "Rede POS"] },
  { id: "sicredi", name: "Sicredi", models: ["Pinpad", "POS"] },
  { id: "getnet", name: "Getnet", models: ["Getnet One", "POS Getnet"] },
  { id: "pagseguro", name: "PagSeguro", models: ["Moderninha Smart", "Minizinha"] },
  { id: "other", name: "Outra", models: ["Genérica"] },
];

export default function PagamentoTab() {
  // Primeira pintura pelo espelho local, não por valores padrão: sem isso a aba piscava com tudo
  // "desmarcado" até a rede responder. O servidor confirma logo depois (efeito abaixo).
  const [inicial] = useState(() => estadoDaConfig(getCachedPaymentConfig()));
  // Enquanto lê a configuração real (ou se a leitura falhar) NADA pode ser salvo: o formulário
  // ainda não tem o que está gravado, e salvar gravaria valores padrão por cima dele.
  const [carregando, setCarregando] = useState(true);
  const [erroCarga, setErroCarga] = useState(/** @type {string | null} */ (null));
  const [tentativaCarga, setTentativaCarga] = useState(0);
  const bloqueadoSalvar = !podeSalvarPagamento({ carregando, erroCarga });
  const [pixMode, setPixMode] = useState(inicial.pixMode); // "mercadopago" | "manual"
  const [pixToken, setPixToken] = useState("");
  const [pixKey, setPixKey] = useState(inicial.pixKey);
  const [pixKeyType, setPixKeyType] = useState(inicial.pixKeyType);
  const [merchantName, setMerchantName] = useState(inicial.merchantName);
  const [merchantCity, setMerchantCity] = useState(inicial.merchantCity);
  const [pixConfigured, setPixConfigured] = useState(inicial.pixConfigured);
  const [checking, setChecking] = useState(false);
  const [copied, setCopied] = useState(false);
  const [testResult, setTestResult] = useState(null);

  const [cardProvider, setCardProvider] = useState(inicial.cardProvider);
  const [cardModel, setCardModel] = useState(inicial.cardModel);
  const [cardEnabled, setCardEnabled] = useState(inicial.cardEnabled);
  // Canal do cartão (maquininha | tef | smartpos) e se a empresa tem Smart POS vinculado.
  const [cardChannel, setCardChannel] = useState(inicial.cardChannel);
  const [canalSalvo, setCanalSalvo] = useState(inicial.canalSalvo);
  const [temSmartPos, setTemSmartPos] = useState(inicial.temSmartPos);

  // TEF
  const [tefEnabled, setTefEnabled] = useState(inicial.tefEnabled);
  const [tefProvider, setTefProvider] = useState(inicial.tefProvider);
  const [tefAgentUrl, setTefAgentUrl] = useState(inicial.tefAgentUrl);
  const [tefTerminalId, setTefTerminalId] = useState(inicial.tefTerminalId);
  const [tefOnline, setTefOnline] = useState(null); // null = não checou
  const [tefChecking, setTefChecking] = useState(false);

  const [salvando, setSalvando] = useState(false);
  const [tokenHint, setTokenHint] = useState(null);
  const [webhookSecret, setWebhookSecret] = useState("");
  const [webhookSecretSalvo, setWebhookSecretSalvo] = useState(inicial.webhookSecretSalvo);

  useEffect(() => {
    let vivo = true;
    setCarregando(true);
    setErroCarga(null);
    // Leitura ESTRITA do servidor: se qualquer uma das duas falhar (rede, sessão), a aba fica
    // bloqueada para salvar em vez de seguir com o espelho/valores padrão.
    Promise.all([
      lerPaymentConfigDoServidor(),
      listarSmartPos().then((rows) => (rows || []).some((r) => r.status === "vinculado")),
    ])
      .then(([cfg, vinculado]) => {
        if (!vivo) return;
        const e = estadoDaConfig(cfg, { temSmartPos: vinculado });
        setTemSmartPos(e.temSmartPos);
        setCardChannel(e.cardChannel);
        setCanalSalvo(e.canalSalvo);
        setPixMode(e.pixMode);
        setPixKey(e.pixKey);
        setPixKeyType(e.pixKeyType);
        setMerchantName(e.merchantName);
        setMerchantCity(e.merchantCity);
        setTokenHint(e.tokenHint);
        setPixConfigured(e.pixConfigured);
        setWebhookSecretSalvo(e.webhookSecretSalvo);
        setCardProvider(e.cardProvider);
        setCardModel(e.cardModel);
        setCardEnabled(e.cardEnabled);
        setTefEnabled(e.tefEnabled);
        setTefProvider(e.tefProvider);
        setTefAgentUrl(e.tefAgentUrl);
        setTefTerminalId(e.tefTerminalId);
      })
      .catch((e) => {
        if (!vivo) return;
        console.error("Erro ao carregar configuração de pagamento:", e);
        setErroCarga(e?.message || "Falha ao ler a configuração.");
      })
      .finally(() => {
        if (vivo) setCarregando(false);
      });
    return () => {
      vivo = false;
    };
  }, [tentativaCarga]);

  const salvar = async (campos, mensagem) => {
    // Mesma trava dos botões, no ponto único de gravação: nada é salvo sem a configuração real carregada.
    if (bloqueadoSalvar) {
      toast.error(carregando ? "Aguarde a configuração carregar antes de salvar." : "Não foi possível carregar a configuração. Tente de novo antes de salvar.");
      return null;
    }
    setSalvando(true);
    try {
      const cfg = await savePaymentConfig(campos);
      setTokenHint(cfg.mp_token_hint || null);
      // Token cadastrado já conta como configurado; o "Testar" serve para
      // conferir se ele funciona, não para destravar o selo.
      setPixConfigured(!!cfg.mp_token_hint);
      toast.success(mensagem);
      return cfg;
    } catch (e) {
      console.error("Erro ao salvar configuração de pagamento:", e);
      toast.error(e.message || "Erro ao salvar configuração.");
      return null;
    } finally {
      setSalvando(false);
    }
  };

  const checkPixStatus = async () => {
    setChecking(true);
    setTestResult(null);
    try {
      // O token fica no servidor: o teste só dispara a cobrança e vê se a conta
      // da loja respondeu.
      const res = await api.functions.invoke("generatePixPayment", {
        amount: 0.01,
        description: "Teste de configuração Mercado Pago",
      });
      const data = res.data || res;
      if (data.configured && data.qrCode) {
        setPixConfigured(true);
        setTestResult({
          success: true,
          qrCode: data.qrCode,
          qrCodeImage: data.qrCodeImage,
          message: data.sandbox
            ? "Token de teste (TEST-) válido! PIX de R$ 0,01 gerado no sandbox."
            : "Token válido! PIX de R$ 0,01 gerado na sua conta.",
        });
        toast.success("PIX de teste gerado.");
      } else {
        setPixConfigured(false);
        setTestResult({ success: false, message: data.error || "Token inválido ou não configurado." });
        toast.error(data.error || "Token inválido.");
      }
    } catch (e) {
      setPixConfigured(false);
      const errMsg = e?.message || "Erro ao testar token.";
      setTestResult({ success: false, message: errMsg });
      toast.error(errMsg);
    }
    setChecking(false);
  };

  const handleSavePix = async () => {
    if (pixMode === "manual" && !pixKey) {
      toast.error("Informe a chave PIX.");
      return;
    }
    const campos = {
      pix_mode: pixMode,
      pix_key: pixKey,
      pix_key_type: pixKeyType,
      merchant_name: merchantName,
      merchant_city: merchantCity,
    };
    // Campo em branco no modo Mercado Pago mantém o token já gravado; só
    // enviamos quando o lojista digita um novo.
    if (pixMode === "mercadopago" && pixToken.trim()) {
      campos.mp_access_token = pixToken.trim();
    }
    if (pixMode === "mercadopago" && webhookSecret.trim()) {
      campos.mp_webhook_secret = webhookSecret.trim();
    }
    const cfg = await salvar(campos, "Configuração PIX salva!");
    if (cfg) {
      setPixToken("");
      if (webhookSecret.trim()) {
        setWebhookSecret("");
        setWebhookSecretSalvo(true);
      }
    }
  };

  const handleSaveCard = () =>
    salvar({ card_provider: cardProvider, card_model: cardModel }, "Maquininha configurada!");

  const tefTemAgente = !!tefAgentUrl.trim();
  const handleSaveCanal = async () => {
    const campos = { card_channel: cardChannel, card_enabled: cardEnabled };
    // Escolher o TEF liga o TEF e manda o endereço do agente junto (o servidor exige).
    if (cardChannel === "tef") {
      campos.tef_enabled = true;
      campos.tef_agent_url = tefAgentUrl;
    }
    const cfg = await salvar(campos, "Canal do cartão salvo!");
    if (cfg) {
      setCanalSalvo(cfg.card_channel || cardChannel);
      if (cardChannel === "tef") setTefEnabled(true);
    }
  };

  const CANAIS = [
    {
      id: "maquininha",
      icon: CreditCard,
      titulo: ROTULOS_CANAL.maquininha,
      texto: "O operador passa o cartão numa maquininha independente e confirma o pagamento no PDV.",
      disponivel: true,
    },
    {
      id: "tef",
      icon: Cpu,
      titulo: ROTULOS_CANAL.tef,
      texto: "O valor vai direto para o PIN pad pelo agente TEF instalado neste computador.",
      disponivel: tefTemAgente,
      aviso: "Informe o endereço do agente TEF abaixo para usar este canal.",
    },
    {
      id: "smartpos",
      icon: Smartphone,
      titulo: ROTULOS_CANAL.smartpos,
      texto: "A cobrança é enviada ao Smart POS vinculado e só vale com a aprovação confirmada.",
      disponivel: temSmartPos,
      aviso: "Vincule um Smart POS (seção ao final desta página) para usar este canal.",
    },
  ];

  const handleSaveTef = () =>
    salvar(
      {
        tef_enabled: tefEnabled,
        tef_provider: tefProvider,
        tef_agent_url: tefAgentUrl,
        tef_terminal_id: tefTerminalId,
      },
      "Configuração TEF salva!"
    );

  const handleCheckTef = async () => {
    // Salvar antes para o checkTefStatus ler a configuração atual.
    await handleSaveTef();
    setTefChecking(true);
    try {
      const status = await checkTefStatus();
      setTefOnline(status.online);
      if (status.online) {
        toast.success(`TEF online! Terminal: ${status.terminal || "OK"}`);
      } else {
        toast.error("Agente TEF offline. Verifique se está rodando.");
      }
    } catch {
      setTefOnline(false);
      toast.error("Não foi possível conectar ao agente TEF.");
    } finally {
      setTefChecking(false);
    }
  };

  const copyWebhookUrl = () => {
    const url = getMercadoPagoWebhookUrl();
    if (!url) {
      toast.error("VITE_SUPABASE_URL ausente no .env.local");
      return;
    }
    navigator.clipboard?.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const webhookUrl =
    getMercadoPagoWebhookUrl() ||
    "(defina VITE_SUPABASE_URL para exibir a URL do webhook)";

  // Gera preview do QR Code estático para modo manual
  const brCode = pixKey ? generateBRCode(pixKey, null, merchantName || "MERCADO FACIL", merchantCity || "SAO PAULO") : "";
  const qrPreviewUrl = brCode ? getQrCodeUrl(brCode, 200) : "";

  const pixActive = pixMode === "manual" ? !!pixKey : pixConfigured;

  return (
    <div className="space-y-6">
      {carregando && (
        <div role="status" className="flex items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" /> Carregando a configuração de pagamento… Salvar fica bloqueado até terminar.
        </div>
      )}
      {!carregando && erroCarga && (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span className="flex-1">
            Não foi possível carregar a configuração de pagamento ({erroCarga}). Salvar está bloqueado para não gravar valores padrão por cima da configuração real.
          </span>
          <Button size="sm" variant="outline" onClick={() => setTentativaCarga((n) => n + 1)}>
            Tentar de novo
          </Button>
        </div>
      )}
      {/* Canal do cartão: forma de pagamento (crédito/débito) x canal que processa */}
      <Card className="p-6">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-indigo-50 flex items-center justify-center">
              <CreditCard className="w-5 h-5 text-indigo-600" />
            </div>
            <div>
              <h2 className="font-heading font-semibold text-lg">Cartão de crédito e débito</h2>
              <p className="text-xs text-muted-foreground">Escolha por qual equipamento o cartão é processado</p>
            </div>
          </div>
          <Badge variant="outline">Em uso: {ROTULOS_CANAL[canalSalvo]}</Badge>
        </div>

        <div className="space-y-4">
          <div className="flex items-center justify-between p-3 rounded-lg border">
            <div>
              <span className="text-sm font-medium">Exibir crédito e débito no checkout</span>
              <p className="text-xs text-muted-foreground">Desligado, o PDV não oferece cartão</p>
            </div>
            <Button
              variant={cardEnabled ? "default" : "outline"}
              size="sm"
              onClick={() => setCardEnabled(!cardEnabled)}
            >
              {cardEnabled ? "Ativado" : "Ativar"}
            </Button>
          </div>

          <div className="grid gap-3 md:grid-cols-3" role="radiogroup" aria-label="Canal do cartão">
            {CANAIS.map((c) => {
              const Icon = c.icon;
              const marcado = cardChannel === c.id;
              return (
                <button
                  key={c.id}
                  type="button"
                  role="radio"
                  aria-checked={marcado}
                  disabled={!c.disponivel}
                  onClick={() => setCardChannel(c.id)}
                  className={`text-left rounded-lg border-2 p-4 transition-colors ${
                    marcado ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"
                  } ${c.disponivel ? "" : "opacity-60 cursor-not-allowed"}`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <Icon className="w-4 h-4" />
                    <span className="text-sm font-semibold">{c.titulo}</span>
                    {marcado && <Check className="w-4 h-4 text-primary ml-auto" />}
                  </div>
                  <p className="text-xs text-muted-foreground">{c.texto}</p>
                  {!c.disponivel && <p className="text-xs text-amber-700 mt-2">{c.aviso}</p>}
                </button>
              );
            })}
          </div>

          <Button onClick={handleSaveCanal} disabled={salvando || bloqueadoSalvar} className="gap-2">
            {salvando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            Salvar canal do cartão
          </Button>
        </div>
      </Card>

      {/* PIX Configuration */}
      <Card className="p-6">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-emerald-50 flex items-center justify-center">
              <QrCode className="w-5 h-5 text-emerald-600" />
            </div>
            <div>
              <h2 className="font-heading font-semibold text-lg">PIX</h2>
              <p className="text-xs text-muted-foreground">Receba pagamentos via QR Code PIX no PDV</p>
            </div>
          </div>
          {pixActive ? (
            <Badge className="bg-emerald-100 text-emerald-700 gap-1">
              <Check className="w-3 h-3" /> Ativo
            </Badge>
          ) : (
            <Badge variant="outline" className="text-amber-600 gap-1">
              <AlertCircle className="w-3 h-3" /> Não configurado
            </Badge>
          )}
        </div>

        {/* Mode selector */}
        <div className="mb-4">
          <Label className="mb-2 block">Modo do PIX</Label>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setPixMode("manual")}
              className={`flex flex-col items-start gap-1 p-3 rounded-lg border-2 transition-all text-left ${
                pixMode === "manual" ? "border-primary bg-primary/5" : "border-border hover:border-primary/30"
              }`}
            >
              <div className="flex items-center gap-2">
                <Building2 className="w-4 h-4" />
                <span className="text-sm font-medium">Chave PIX Manual</span>
              </div>
              <span className="text-xs text-muted-foreground">Qualquer banco, sem API</span>
            </button>
            <button
              onClick={() => setPixMode("mercadopago")}
              className={`flex flex-col items-start gap-1 p-3 rounded-lg border-2 transition-all text-left ${
                pixMode === "mercadopago" ? "border-primary bg-primary/5" : "border-border hover:border-primary/30"
              }`}
            >
              <div className="flex items-center gap-2">
                <QrCode className="w-4 h-4" />
                <span className="text-sm font-medium">Mercado Pago</span>
              </div>
              <span className="text-xs text-muted-foreground">PIX dinâmico via API</span>
            </button>
          </div>
        </div>

        {/* Manual mode */}
        {pixMode === "manual" && (
          <div className="space-y-4">
            <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-3 text-xs text-emerald-700 flex gap-2">
              <Check className="w-4 h-4 shrink-0 mt-0.5" />
              <span>
                Funciona com <strong>qualquer banco</strong>. O cliente escaneia o QR Code e paga
                para a sua chave PIX. Você confirma o recebimento manualmente no PDV.
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <Label className="mb-1.5 block text-sm">Tipo da Chave</Label>
                <Select value={pixKeyType} onValueChange={setPixKeyType}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PIX_KEY_TYPES.map((t) => (
                      <SelectItem key={t.id} value={t.id}>{t.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="sm:col-span-2">
                <Label className="mb-1.5 block text-sm">Chave PIX</Label>
                <Input
                  value={pixKey}
                  onChange={(e) => setPixKey(e.target.value)}
                  placeholder={
                    pixKeyType === "email" ? "seu@email.com" :
                    pixKeyType === "cpf" ? "12345678901" :
                    pixKeyType === "cnpj" ? "12345678000199" :
                    pixKeyType === "phone" ? "+5511999999999" :
                    "chave-aleatoria-uuid"
                  }
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label className="mb-1.5 block text-sm">Nome do Recebedor</Label>
                <Input
                  value={merchantName}
                  onChange={(e) => setMerchantName(e.target.value)}
                  placeholder="Mercado Facil"
                  maxLength={25}
                />
              </div>
              <div>
                <Label className="mb-1.5 block text-sm">Cidade</Label>
                <Input
                  value={merchantCity}
                  onChange={(e) => setMerchantCity(e.target.value)}
                  placeholder="Sao Paulo"
                  maxLength={15}
                />
              </div>
            </div>

            {/* QR Code Preview */}
            {qrPreviewUrl && (
              <div className="flex flex-col items-center gap-2 p-4 rounded-lg border bg-muted/30">
                <img src={qrPreviewUrl} alt="Preview QR Code PIX" className="w-40 h-40 rounded-lg border bg-white p-2" />
                <div className="text-center">
                  <p className="text-xs font-medium text-muted-foreground">Preview do QR Code</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Este QR Code aparecerá no checkout do PDV</p>
                </div>
              </div>
            )}

            <Button onClick={handleSavePix} disabled={salvando || bloqueadoSalvar} className="gap-2">
              {salvando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              Salvar Chave PIX
            </Button>
          </div>
        )}

        {/* Mercado Pago mode */}
        {pixMode === "mercadopago" && (
          <div className="space-y-4">
            <div className="rounded-lg border-2 border-dashed border-primary/30 bg-primary/5 p-4 space-y-3">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-sm">Mercado Pago Access Token</span>
                {pixConfigured ? (
                  <Badge className="bg-emerald-100 text-emerald-700 text-xs gap-1">
                    <Check className="w-3 h-3" /> Configurado
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-amber-600 text-xs gap-1">
                    <AlertCircle className="w-3 h-3" /> Pendente
                  </Badge>
                )}
              </div>
              <Input
                type="password"
                value={pixToken}
                onChange={(e) => { setPixToken(e.target.value); setTestResult(null); }}
                placeholder={tokenHint ? `Token salvo (${tokenHint}) — digite para substituir` : "APP_USR-xxxx-xxxx-xxxx"}
              />
              {tokenHint && !pixToken && (
                <p className="text-xs text-muted-foreground">
                  Token guardado no servidor. Ele nunca é devolvido para o navegador —
                  para trocar, cole o novo token e salve.
                </p>
              )}
              <div className="text-xs text-muted-foreground space-y-1.5">
                <p><strong>Como ativar o PIX dinâmico:</strong></p>
                <ol className="list-decimal list-inside space-y-1 ml-1">
                  <li>
                    Crie sua conta no{" "}
                    <a href="https://www.mercadopago.com.br/developers/panel" target="_blank" rel="noopener noreferrer" className="text-primary underline inline-flex items-center gap-0.5">
                      Mercado Pago Developers <ExternalLink className="w-3 h-3" />
                    </a>
                  </li>
                  <li>Copie o <strong>Access Token</strong> da sua conta (<code className="bg-muted px-1 rounded">APP_USR-</code> para receber de verdade, <code className="bg-muted px-1 rounded">TEST-</code> para testar)</li>
                  <li>Cole acima e clique em <strong>Salvar</strong> — o token fica no servidor, vale para todos os caixas da loja</li>
                  <li>Clique em <strong>Testar</strong> para gerar um PIX de R$ 0,01 e conferir</li>
                </ol>
                <p className="pt-1">O dinheiro cai direto na sua conta Mercado Pago.</p>
              </div>

              <div>
                <Label className="mb-1.5 block text-xs">URL de Webhook (para confirmação automática)</Label>
                <div className="flex items-center gap-2">
                  <Input readOnly value={webhookUrl} className="text-xs font-mono" />
                  <Button variant="outline" size="icon" onClick={copyWebhookUrl} className="shrink-0">
                    {copied ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Opcional: cadastre esta URL no Mercado Pago para receber confirmações automáticas de pagamento.
                  Sem o webhook, o operador confirma o pagamento manualmente no PDV.
                </p>
              </div>

              <div>
                <Label className="mb-1.5 block text-xs">Chave secreta do webhook</Label>
                <Input
                  type="password"
                  value={webhookSecret}
                  onChange={(e) => setWebhookSecret(e.target.value)}
                  placeholder={webhookSecretSalvo ? "Chave salva — digite para substituir" : "Cole a chave gerada pelo Mercado Pago"}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  O Mercado Pago mostra essa chave ao cadastrar a URL acima. Sem ela, as
                  notificações automáticas são recusadas — é o que impede alguém de
                  fingir um pagamento aprovado.
                </p>
              </div>
            </div>

            {/* Test result */}
            {testResult && (
              <div className={`rounded-lg p-4 ${testResult.success ? "bg-emerald-50 border border-emerald-200" : "bg-red-50 border border-red-200"}`}>
                <div className="flex items-start gap-3">
                  {testResult.success ? (
                    <Check className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                  ) : (
                    <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
                  )}
                  <div className="flex-1">
                    <p className={`text-sm font-medium ${testResult.success ? "text-emerald-700" : "text-red-700"}`}>
                      {testResult.success ? "Token válido!" : "Falha no teste"}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">{testResult.message}</p>
                    {testResult.success && testResult.qrCodeImage && (
                      <img src={`data:image/png;base64,${testResult.qrCodeImage}`} alt="PIX Teste" className="w-32 h-32 mt-3 rounded-lg border bg-white p-2" />
                    )}
                    {testResult.success && testResult.qrCode && !testResult.qrCodeImage && (
                      <div className="mt-3">
                        <img src={getQrCodeUrl(testResult.qrCode, 160)} alt="PIX Teste" className="w-40 h-40 rounded-lg border bg-white p-2" />
                        <p className="text-xs font-mono mt-2 break-all bg-muted p-2 rounded">{testResult.qrCode}</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            <div className="flex gap-2">
              <Button onClick={handleSavePix} disabled={salvando || bloqueadoSalvar} className="gap-2">
                {salvando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                Salvar
              </Button>
              <Button variant="outline" onClick={checkPixStatus} disabled={checking} className="gap-2">
                {checking ? <Loader2 className="w-4 h-4 animate-spin" /> : <QrCode className="w-4 h-4" />}
                Testar
              </Button>
            </div>
          </div>
        )}
      </Card>

      {/* Card Machine Configuration */}
      <Card className="p-6">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center">
              <CreditCard className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <h2 className="font-heading font-semibold text-lg">Maquininha de Cartão</h2>
              <p className="text-xs text-muted-foreground">Plug and play — basta plugar e usar</p>
            </div>
          </div>
          {canalSalvo === "maquininha" ? (
            <Badge className="bg-emerald-100 text-emerald-700 gap-1">
              <Check className="w-3 h-3" /> Em uso
            </Badge>
          ) : (
            <Badge variant="outline">Disponível</Badge>
          )}
        </div>

        <div className="space-y-4">
          {/* Plug and play info */}
          <div className="rounded-lg bg-blue-50 border border-blue-200 p-4 flex gap-3">
            <Plug className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
            <div className="text-xs text-blue-700 space-y-1">
              <p className="font-semibold">Funciona sem configuração</p>
              <p>
                A maquininha é independente — basta plugar na tomada, conectar o Wi-Fi e usar.
                No PDV, o operador digita o valor, passa o cartão na maquininha e confirma o
                pagamento quando for aprovado. Não precisa de API nem integração.
              </p>
            </div>
          </div>

          <div>
            <Label className="mb-1.5 block">Provedor da Maquininha</Label>
            <Select value={cardProvider} onValueChange={(v) => {
              setCardProvider(v);
              const provider = CARD_PROVIDERS.find(p => p.id === v);
              if (provider) setCardModel(provider.models[0]);
            }}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CARD_PROVIDERS.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="mb-1.5 block">Modelo</Label>
            <Select value={cardModel} onValueChange={setCardModel}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(CARD_PROVIDERS.find(p => p.id === cardProvider)?.models || []).map((m) => (
                  <SelectItem key={m} value={m}>{m}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Button onClick={handleSaveCard} disabled={salvando || bloqueadoSalvar} className="gap-2">
            {salvando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            Salvar
          </Button>
        </div>
      </Card>

      {/* TEF Configuration */}
      <Card className="p-6">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-violet-50 flex items-center justify-center">
              <Cpu className="w-5 h-5 text-violet-600" />
            </div>
            <div>
              <h2 className="font-heading font-semibold text-lg">TEF (PIN pad integrado)</h2>
              <p className="text-xs text-muted-foreground">Envia o valor direto para o PIN pad — sem digitar na maquininha</p>
            </div>
          </div>
          {canalSalvo === "tef" ? (
            <Badge className="bg-emerald-100 text-emerald-700 gap-1">
              <Check className="w-3 h-3" /> Em uso
            </Badge>
          ) : tefEnabled ? (
            <Badge variant="outline">Configurado</Badge>
          ) : (
            <Badge variant="outline">Inativo</Badge>
          )}
        </div>

        <div className="space-y-4">
          <div className="rounded-lg bg-violet-50 border border-violet-200 p-4 flex gap-3">
            <Cpu className="w-5 h-5 text-violet-600 shrink-0 mt-0.5" />
            <div className="text-xs text-violet-700 space-y-1">
              <p className="font-semibold">Como funciona o TEF</p>
              <p>
                O TEF envia o valor da venda direto para o PIN pad conectado ao computador.
                O cliente passa o cartão, digita a senha e o resultado volta automaticamente para o PDV.
                Não precisa digitar o valor na maquininha.
              </p>
              <p className="mt-1">
                Requer um <strong>agente TEF local</strong> instalado no computador do caixa
                (ex: SiTef, PayGo, ou o software do seu provedor). O agente faz a ponte entre o
                navegador e o PIN pad.
              </p>
            </div>
          </div>

          <div className="flex items-center justify-between p-3 rounded-lg border">
            <div>
              <span className="text-sm font-medium">Ativar TEF no checkout</span>
              <p className="text-xs text-muted-foreground">Substitui a confirmação manual de cartão</p>
            </div>
            <Button
              variant={tefEnabled ? "default" : "outline"}
              size="sm"
              onClick={() => setTefEnabled(!tefEnabled)}
            >
              {tefEnabled ? "Ativado" : "Ativar"}
            </Button>
          </div>

          {tefEnabled && (
            <>
              <div>
                <Label className="mb-1.5 block">Provedor TEF</Label>
                <Select value={tefProvider} onValueChange={setTefProvider}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="sitef">SiTef (Software Express)</SelectItem>
                    <SelectItem value="paygo">PayGo</SelectItem>
                    <SelectItem value="stone">Stone TEF</SelectItem>
                    <SelectItem value="cielo">Cielo TEF</SelectItem>
                    <SelectItem value="rede">Rede TEF</SelectItem>
                    <SelectItem value="sicredi">Sicredi TEF</SelectItem>
                    <SelectItem value="getnet">Getnet TEF</SelectItem>
                    <SelectItem value="other">Outro</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label className="mb-1.5 block">URL do Agente TEF (local)</Label>
                <Input
                  value={tefAgentUrl}
                  onChange={(e) => setTefAgentUrl(e.target.value)}
                  placeholder="http://localhost:8080"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Endereço do agente TEF rodando neste computador. Padrão: http://localhost:8080
                </p>
              </div>

              <div>
                <Label className="mb-1.5 block">ID do Terminal (opcional)</Label>
                <Input
                  value={tefTerminalId}
                  onChange={(e) => setTefTerminalId(e.target.value)}
                  placeholder="Ex: 00000001"
                />
              </div>

              {/* Status indicator */}
              {tefOnline !== null && (
                <div className={`flex items-center gap-2 p-3 rounded-lg text-sm ${
                  tefOnline
                    ? "bg-emerald-50 text-emerald-700"
                    : "bg-red-50 text-red-700"
                }`}>
                  <Wifi className="w-4 h-4" />
                  {tefOnline ? "Agente TEF online e pronto" : "Agente TEF offline — verifique se está rodando"}
                </div>
              )}

              <div className="flex gap-2">
                <Button onClick={handleSaveTef} disabled={salvando || bloqueadoSalvar} className="gap-2">
                  {salvando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                  Salvar
                </Button>
                <Button variant="outline" onClick={handleCheckTef} disabled={tefChecking} className="gap-2">
                  {tefChecking ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wifi className="w-4 h-4" />}
                  Testar Conexão
                </Button>
              </div>
            </>
          )}
        </div>
      </Card>

      {/* Smart POS do ConnectTEF (só pareamento) */}
      <SmartPosConnectTef />
    </div>
  );
}