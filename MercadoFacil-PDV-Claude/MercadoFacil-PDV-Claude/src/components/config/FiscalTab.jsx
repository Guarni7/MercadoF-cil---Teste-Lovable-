// Configurações → Fiscal.
//
// A versão anterior desta tela gravava CNPJ, IE, série e numeração da NFC-e no
// localStorage do navegador. Isso significava numeração fiscal zerando a cada
// limpeza de cache, dado sem company_id e a mesma configuração vazando entre
// empresas no mesmo terminal.
//
// Agora tudo vem de company_fiscal_settings (com RLS por empresa) e o certificado
// sobe uma única vez para a Edge Function, que valida e guarda em uma tabela que
// o navegador não lê. O que volta para cá é só titular e validade.

import React, { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import TributacaoSection from "@/components/config/TributacaoSection";
import {
  AlertCircle,
  CheckCircle2,
  FileText,
  Loader2,
  RefreshCw,
  Save,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import {
  AMBIENTES,
  CRTS,
  ESCOPOS_MEI,
  REGIMES,
  TIPOS_CONTRIBUINTE,
  carregarConfigFiscal,
  carregarSeries,
  corDoStatus,
  diagnosticoFiscal,
  lerCertificado,
  rotuloDoStatus,
  salvarConfigFiscal,
  salvarNumeracaoNfce,
  testarConfigNfce,
} from "@/lib/fiscalConfig";

const UFS = [
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS",
  "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC",
  "SP", "SE", "TO",
];

/** @type {Record<string, any> & { certificate_pfx?: string, certificate_password?: string }} */
const VAZIO = {
  cnpj: "",
  legal_name: "",
  trade_name: "",
  ie: "",
  ie_isento: false,
  im: "",
  uf: "",
  city_name: "",
  city_ibge_code: "",
  cnae_main: "",
  tax_regime: "simples",
  crt: "1",
  taxpayer_type: "contribuinte",
  mei_scope: "mercadorias",
  environment: "homologacao",
  nfce_enabled: false,
  nfe_enabled: false,
  nfse_enabled: false,
  nfse_special_regime: "",
  nfse_simples_optant: false,
  nfse_issqn_withheld_default: false,
  address: "",
  address_number: "",
  complement: "",
  neighborhood: "",
  cep: "",
  phone: "",
  csc_id_homologacao: "",
  csc_id_producao: "",
};

const MODELOS = { 55: "NF-e", 65: "NFC-e", nfse: "NFS-e" };

function IconeStatus({ status }) {
  if (status === "configurado") return <CheckCircle2 className="w-4 h-4 shrink-0" />;
  if (status === "erro") return <XCircle className="w-4 h-4 shrink-0" />;
  return <AlertCircle className="w-4 h-4 shrink-0" />;
}

/**
 * @param {{ label: React.ReactNode, children?: React.ReactNode, hint?: React.ReactNode, className?: string }} props
 */
function Campo({ label, children, hint, className = "" }) {
  return (
    <div className={className}>
      <Label>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground mt-1">{hint}</p>}
    </div>
  );
}

export default function FiscalTab() {
  const [form, setForm] = useState(VAZIO);
  const [certificado, setCertificado] = useState(null);
  const [series, setSeries] = useState([]);
  const [diagnostico, setDiagnostico] = useState(null);
  const [arquivo, setArquivo] = useState(null);
  const [senha, setSenha] = useState("");
  const [cscHomologacao, setCscHomologacao] = useState("");
  const [cscProducao, setCscProducao] = useState("");
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [diagnosticando, setDiagnosticando] = useState(false);
  const [nfceSerie, setNfceSerie] = useState("1");
  const [nfceProximo, setNfceProximo] = useState("1");
  const [testeNfce, setTesteNfce] = useState(null);
  const [testandoNfce, setTestandoNfce] = useState(false);
  const [salvandoNumeracao, setSalvandoNumeracao] = useState(false);

  const mudar = (campo, valor) => setForm((prev) => ({ ...prev, [campo]: valor }));

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const [config, listaSeries] = await Promise.all([
        carregarConfigFiscal(),
        carregarSeries().catch(() => []),
      ]);
      if (config) {
        setForm({ ...VAZIO, ...Object.fromEntries(
          Object.entries(config).filter(([, v]) => v !== null),
        ) });
        setCertificado(
          config.certificate_subject
            ? { subject: config.certificate_subject, validUntil: config.certificate_valid_until }
            : null,
        );
      }
      setSeries(listaSeries || []);
      const serie = Number(config?.nfce_series || 1);
      const linha = (listaSeries || []).find(
        (x) => x.model === "65" && x.environment === "homologacao" && Number(x.series) === serie,
      );
      setNfceSerie(String(serie));
      setNfceProximo(String(Number(linha?.current_number || 0) + 1));
    } catch (e) {
      console.error("Falha ao carregar a configuração fiscal:", e);
      toast.error(e.message || "Não foi possível carregar a configuração fiscal");
    } finally {
      setCarregando(false);
    }
  }, []);

  const rodarDiagnostico = useCallback(async (silencioso = false) => {
    setDiagnosticando(true);
    try {
      setDiagnostico(await diagnosticoFiscal());
    } catch (e) {
      console.error("Falha no diagnóstico fiscal:", e);
      if (!silencioso) toast.error(e.message || "Não foi possível consultar o status da integração");
      setDiagnostico(null);
    } finally {
      setDiagnosticando(false);
    }
  }, []);

  useEffect(() => {
    carregar();
    rodarDiagnostico(true);
  }, [carregar, rodarDiagnostico]);

  // Regime e CRT andam juntos no leiaute oficial: MEI é sempre CRT 4, Simples é
  // 1 (ou 2 no excesso de sublimite). Mudar o regime já acerta o CRT para o
  // lojista não precisar saber o código de cor.
  const mudarRegime = (regime) => {
    const escolhido = REGIMES.find((r) => r.value === regime);
    setForm((prev) => ({
      ...prev,
      tax_regime: regime,
      crt: prev.tax_regime === regime ? prev.crt : escolhido?.crt || prev.crt,
    }));
  };

  const salvar = async () => {
    setSalvando(true);
    try {
      const payload = { ...form };
      if (payload.tax_regime !== "mei") payload.mei_scope = null;

      if (arquivo) {
        if (!senha) throw new Error("Informe a senha do certificado");
        payload.certificate_pfx = await lerCertificado(arquivo);
        payload.certificate_password = senha;
      }

      // CSC nunca volta do servidor — só é enviado quando o lojista digita um
      // valor novo nesta sessão, para não sobrescrever o já cadastrado com vazio.
      if (cscHomologacao) payload.csc_homologacao = cscHomologacao;
      if (cscProducao) payload.csc_producao = cscProducao;

      const resposta = await salvarConfigFiscal(payload);
      if (resposta?.settings) {
        setForm({ ...VAZIO, ...Object.fromEntries(
          Object.entries(resposta.settings).filter(([, v]) => v !== null),
        ) });
      }
      if (resposta?.certificate) {
        setCertificado({
          subject: resposta.certificate.subject,
          validUntil: resposta.certificate.valid_to,
        });
      } else if (resposta?.settings?.certificate_subject) {
        setCertificado({
          subject: resposta.settings.certificate_subject,
          validUntil: resposta.settings.certificate_valid_until,
        });
      }

      setArquivo(null);
      setSenha("");
      setCscHomologacao("");
      setCscProducao("");
      toast.success("Configuração fiscal salva");
      await Promise.all([carregarSeries().then(setSeries).catch(() => {}), rodarDiagnostico(true)]);
    } catch (e) {
      console.error("Falha ao salvar a configuração fiscal:", e);
      toast.error(e.message || "Não foi possível salvar a configuração fiscal");
    } finally {
      setSalvando(false);
    }
  };

  const testarNfce = async () => {
    setTestandoNfce(true);
    try {
      setTesteNfce(await testarConfigNfce());
    } catch (e) {
      console.error("Falha ao testar a configuração de NFC-e:", e);
      toast.error(e.message || "Não foi possível testar a configuração de NFC-e");
      setTesteNfce(null);
    } finally {
      setTestandoNfce(false);
    }
  };

  const salvarNumeracao = async () => {
    setSalvandoNumeracao(true);
    try {
      await salvarNumeracaoNfce({ series: Number(nfceSerie), nextNumber: Number(nfceProximo) });
      toast.success("Série e próximo número salvos (homologação)");
      carregarSeries().then(setSeries).catch(() => {});
    } catch (e) {
      toast.error(e.message || "Não foi possível salvar a numeração");
    } finally {
      setSalvandoNumeracao(false);
    }
  };

  if (carregando) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground p-6">
        <Loader2 className="w-4 h-4 animate-spin" /> Carregando configuração fiscal...
      </div>
    );
  }

  const ehMei = form.tax_regime === "mei";
  const emProducao = form.environment === "producao";

  return (
    <div className="space-y-6">
      <div className="rounded-lg bg-blue-50 border border-blue-200 p-4 flex gap-3">
        <FileText className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
        <div className="text-sm text-blue-700 space-y-1">
          <p className="font-semibold">Configuração fiscal da empresa</p>
          <p>
            Estes dados alimentam a emissão de NFC-e, NF-e e NFS-e. A numeração,
            o certificado e as regras de tributação ficam no servidor, por empresa.
          </p>
          <p className="text-xs">
            Um documento só aparece como <strong>autorizado</strong> depois do protocolo
            oficial do autorizador. Enquanto o certificado e a homologação não estiverem
            no lugar, a emissão é recusada com o motivo — nunca aprovada por simulação.
          </p>
        </div>
      </div>

      {/* Status da integração, medido no servidor */}
      <Card className="p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="font-heading font-semibold text-lg">Status da integração</h2>
            <p className="text-sm text-muted-foreground">
              Cada item é verificado no servidor no momento do teste
            </p>
          </div>
          <div className="flex items-center gap-2">
            {diagnostico && (
              <Badge className={`border ${corDoStatus(diagnostico.status)}`}>
                {rotuloDoStatus(diagnostico.status)}
              </Badge>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => rodarDiagnostico(false)}
              disabled={diagnosticando}
              className="gap-2"
            >
              {diagnosticando ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <RefreshCw className="w-4 h-4" />
              )}
              Testar conexão
            </Button>
          </div>
        </div>

        {diagnostico?.items?.length ? (
          <div className="space-y-2">
            {diagnostico.items.map((item) => (
              <div
                key={item.id}
                className={`flex items-start gap-3 rounded-lg border p-3 ${corDoStatus(item.status)}`}
              >
                <IconeStatus status={item.status} />
                <div className="min-w-0">
                  <p className="font-medium text-sm">{item.label}</p>
                  <p className="text-xs opacity-90 break-words">{item.detail}</p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Sem diagnóstico ainda. Use "Testar conexão" para verificar certificado,
            suporte a mTLS, autorizadores e regras tributárias vigentes.
          </p>
        )}
      </Card>

      {/* Identificação do emitente */}
      <Card className="p-6">
        <h2 className="font-heading font-semibold text-lg mb-4">Identificação do emitente</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Campo label="CNPJ">
            <Input
              value={form.cnpj}
              onChange={(e) => mudar("cnpj", e.target.value)}
              placeholder="00.000.000/0000-00"
            />
          </Campo>
          <Campo label="Razão social">
            <Input
              value={form.legal_name}
              onChange={(e) => mudar("legal_name", e.target.value)}
            />
          </Campo>
          <Campo label="Nome fantasia">
            <Input
              value={form.trade_name}
              onChange={(e) => mudar("trade_name", e.target.value)}
            />
          </Campo>
          <Campo label="CNAE principal" hint="Somente números, 7 dígitos">
            <Input
              value={form.cnae_main}
              onChange={(e) => mudar("cnae_main", e.target.value)}
              placeholder="4711302"
            />
          </Campo>
          <Campo
            label="Inscrição estadual"
            hint={form.ie_isento ? "Marcada como isenta" : "Obrigatória para NFC-e e NF-e"}
          >
            <Input
              value={form.ie}
              onChange={(e) => mudar("ie", e.target.value)}
              disabled={form.ie_isento}
            />
          </Campo>
          <div className="flex items-end gap-3 pb-1">
            <Switch
              id="ie-isento"
              checked={!!form.ie_isento}
              onCheckedChange={(v) => mudar("ie_isento", v)}
            />
            <Label htmlFor="ie-isento" className="cursor-pointer">
              Isento de inscrição estadual
            </Label>
          </div>
          <Campo label="Inscrição municipal" hint="Necessária para emitir NFS-e">
            <Input value={form.im} onChange={(e) => mudar("im", e.target.value)} />
          </Campo>
          <Campo label="Telefone">
            <Input value={form.phone} onChange={(e) => mudar("phone", e.target.value)} />
          </Campo>
        </div>
      </Card>

      {/* Regime tributário */}
      <Card className="p-6">
        <h2 className="font-heading font-semibold text-lg mb-4">Regime tributário</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Campo label="Regime">
            <Select value={form.tax_regime} onValueChange={mudarRegime}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {REGIMES.map((r) => (
                  <SelectItem key={r.value} value={r.value}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Campo>
          <Campo label="CRT (código de regime tributário)" hint="Vai no XML do documento fiscal">
            <Select value={form.crt} onValueChange={(v) => mudar("crt", v)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CRTS.map((c) => (
                  <SelectItem key={c.value} value={c.value}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Campo>
          <Campo label="Tipo de contribuinte">
            <Select value={form.taxpayer_type} onValueChange={(v) => mudar("taxpayer_type", v)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TIPOS_CONTRIBUINTE.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Campo>
          {ehMei && (
            <Campo
              label="O MEI atua com"
              hint="Mercadoria e serviço usam documentos fiscais diferentes"
            >
              <Select value={form.mei_scope || "mercadorias"} onValueChange={(v) => mudar("mei_scope", v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ESCOPOS_MEI.map((e) => (
                    <SelectItem key={e.value} value={e.value}>
                      {e.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Campo>
          )}
        </div>
      </Card>

      {/* Estabelecimento */}
      <Card className="p-6">
        <h2 className="font-heading font-semibold text-lg mb-4">Endereço do estabelecimento</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Campo label="Logradouro" className="sm:col-span-2">
            <Input value={form.address} onChange={(e) => mudar("address", e.target.value)} />
          </Campo>
          <Campo label="Número">
            <Input
              value={form.address_number}
              onChange={(e) => mudar("address_number", e.target.value)}
            />
          </Campo>
          <Campo label="Complemento">
            <Input value={form.complement} onChange={(e) => mudar("complement", e.target.value)} />
          </Campo>
          <Campo label="Bairro">
            <Input
              value={form.neighborhood}
              onChange={(e) => mudar("neighborhood", e.target.value)}
            />
          </Campo>
          <Campo label="CEP">
            <Input value={form.cep} onChange={(e) => mudar("cep", e.target.value)} />
          </Campo>
          <Campo label="Município">
            <Input value={form.city_name} onChange={(e) => mudar("city_name", e.target.value)} />
          </Campo>
          <Campo label="UF">
            <Select value={form.uf || undefined} onValueChange={(v) => mudar("uf", v)}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione" />
              </SelectTrigger>
              <SelectContent>
                {UFS.map((uf) => (
                  <SelectItem key={uf} value={uf}>
                    {uf}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Campo>
          <Campo
            label="Código IBGE do município"
            hint="7 dígitos, obrigatório no XML"
            className="sm:col-span-2"
          >
            <Input
              value={form.city_ibge_code}
              onChange={(e) => mudar("city_ibge_code", e.target.value)}
              placeholder="3106200"
            />
          </Campo>
        </div>
      </Card>

      {/* Documentos e ambiente */}
      <Card className="p-6">
        <h2 className="font-heading font-semibold text-lg mb-4">Documentos e ambiente</h2>
        <div className="space-y-4">
          {[
            ["nfce_enabled", "NFC-e (modelo 65)", "Venda presencial ao consumidor final"],
            ["nfe_enabled", "NF-e (modelo 55)", "Venda com destinatário identificado"],
            ["nfse_enabled", "NFS-e Nacional", "Prestação de serviço, via Sefin Nacional"],
          ].map(([campo, titulo, descricao]) => (
            <div key={campo} className="flex items-center justify-between gap-4">
              <div>
                <p className="font-medium text-sm">{titulo}</p>
                <p className="text-xs text-muted-foreground">{descricao}</p>
              </div>
              <Switch
                checked={!!form[campo]}
                onCheckedChange={(v) => mudar(campo, v)}
              />
            </div>
          ))}

          <Separator />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Campo
              label="Ambiente de emissão"
              hint="Homologação e produção têm numeração independente"
            >
              <Select value={form.environment} onValueChange={(v) => mudar("environment", v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {AMBIENTES.map((a) => (
                    <SelectItem key={a.value} value={a.value}>
                      {a.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Campo>
          </div>

          {emProducao && (
            <div className="flex gap-2 text-sm rounded-lg border border-amber-200 bg-amber-50 text-amber-800 p-3">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>
                Em produção os documentos valem fiscalmente. O servidor recusa ativar
                produção sem certificado digital válido cadastrado.
              </span>
            </div>
          )}

          {form.nfse_enabled && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
              <Campo
                label="Regime especial de tributação"
                hint="Deixe vazio se não houver"
              >
                <Input
                  value={form.nfse_special_regime}
                  onChange={(e) => mudar("nfse_special_regime", e.target.value)}
                />
              </Campo>
              <div className="flex items-end gap-3 pb-1">
                <Switch
                  id="nfse-simples"
                  checked={!!form.nfse_simples_optant}
                  onCheckedChange={(v) => mudar("nfse_simples_optant", v)}
                />
                <Label htmlFor="nfse-simples" className="cursor-pointer">
                  Optante pelo Simples Nacional
                </Label>
              </div>
              <div className="flex items-center gap-3">
                <Switch
                  id="nfse-retido"
                  checked={!!form.nfse_issqn_withheld_default}
                  onCheckedChange={(v) => mudar("nfse_issqn_withheld_default", v)}
                />
                <Label htmlFor="nfse-retido" className="cursor-pointer">
                  ISSQN retido na fonte por padrão
                </Label>
              </div>
            </div>
          )}
        </div>
      </Card>

      {/* Certificado digital */}
      <Card className="p-6">
        <div className="flex items-start gap-3 mb-4">
          <ShieldCheck className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
          <div>
            <h2 className="font-heading font-semibold text-lg">Certificado digital A1</h2>
            <p className="text-sm text-muted-foreground">
              O arquivo e a senha ficam apenas no servidor. Esta tela nunca recebe
              o certificado de volta — só o titular e a validade.
            </p>
          </div>
        </div>

        {certificado ? (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 mb-4 text-sm text-emerald-800">
            <p className="font-medium">{certificado.subject}</p>
            {certificado.validUntil && (
              <p className="text-xs">
                Válido até {new Date(certificado.validUntil).toLocaleDateString("pt-BR")}
              </p>
            )}
          </div>
        ) : (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 mb-4 text-sm text-amber-800">
            Nenhum certificado cadastrado. Sem ele não há assinatura nem transmissão
            para a SEFAZ ou para a NFS-e Nacional.
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Campo
            label={certificado ? "Substituir certificado (.pfx / .p12)" : "Certificado (.pfx / .p12)"}
          >
            <Input
              type="file"
              accept=".pfx,.p12"
              onChange={(e) => setArquivo(e.target.files?.[0] || null)}
            />
          </Campo>
          <Campo label="Senha do certificado">
            <Input
              type="password"
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              placeholder={arquivo ? "Obrigatória para este arquivo" : "••••••••"}
              autoComplete="new-password"
            />
          </Campo>
        </div>
      </Card>

      {/* CSC / ID CSC — QR Code da NFC-e */}
      <Card className="p-6">
        <div className="flex items-start gap-3 mb-4">
          <ShieldCheck className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
          <div>
            <h2 className="font-heading font-semibold text-lg">CSC / ID CSC (QR Code da NFC-e)</h2>
            <p className="text-sm text-muted-foreground">
              Gerado no portal da SEFAZ do seu estado. O CSC fica só no servidor —
              esta tela nunca mostra o valor de volta. Homologação e produção têm
              um par próprio.
            </p>
            {form.csc_updated_at && (
              <p className="text-xs text-emerald-700 mt-1">
                Último CSC gravado em {new Date(form.csc_updated_at).toLocaleString("pt-BR")}
              </p>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          <div className="space-y-3">
            <p className="text-sm font-medium">Homologação</p>
            <Campo label="ID CSC">
              <Input
                value={form.csc_id_homologacao || ""}
                onChange={(e) => mudar("csc_id_homologacao", e.target.value)}
                placeholder="000001"
              />
            </Campo>
            <Campo label="CSC">
              <Input
                type="password"
                value={cscHomologacao}
                onChange={(e) => setCscHomologacao(e.target.value)}
                placeholder="••••••••••••••••••••"
                autoComplete="new-password"
              />
            </Campo>
          </div>

          <div className="space-y-3">
            <p className="text-sm font-medium">Produção</p>
            <Campo label="ID CSC">
              <Input
                value={form.csc_id_producao || ""}
                onChange={(e) => mudar("csc_id_producao", e.target.value)}
                placeholder="000001"
              />
            </Campo>
            <Campo label="CSC">
              <Input
                type="password"
                value={cscProducao}
                onChange={(e) => setCscProducao(e.target.value)}
                placeholder="••••••••••••••••••••"
                autoComplete="new-password"
              />
            </Campo>
          </div>
        </div>
      </Card>

      {/* NFC-e — SEFAZ-GO, homologação */}
      <Card className="p-6">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <h2 className="font-heading font-semibold text-lg">NFC-e — SEFAZ-GO (homologação)</h2>
            <p className="text-sm text-muted-foreground">
              Série e numeração da NFC-e de testes. CNPJ, IE, regime, ambiente, certificado
              e CSC são os campos acima. O teste não emite nota nem consulta a SEFAZ.
            </p>
          </div>
          <Badge variant="outline" className="shrink-0">Homologação</Badge>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Campo label="Série">
            <Input
              type="number"
              min={1}
              max={999}
              value={nfceSerie}
              onChange={(e) => setNfceSerie(e.target.value)}
            />
          </Campo>
          <Campo label="Próximo número" hint="Precisa ser maior que o último número já registrado">
            <Input
              type="number"
              min={1}
              value={nfceProximo}
              onChange={(e) => setNfceProximo(e.target.value)}
            />
          </Campo>
        </div>
        <div className="flex flex-wrap items-center gap-3 mt-4">
          <Button variant="outline" onClick={salvarNumeracao} disabled={salvandoNumeracao} className="gap-2">
            {salvandoNumeracao ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Salvar numeração
          </Button>
          <Button onClick={testarNfce} disabled={testandoNfce} className="gap-2">
            {testandoNfce ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
            Testar configuração
          </Button>
          {testeNfce && (
            <Badge className={`border ${corDoStatus(testeNfce.status)}`}>{rotuloDoStatus(testeNfce.status)}</Badge>
          )}
        </div>
        {testeNfce?.items?.length ? (
          <div className="space-y-2 mt-4">
            {testeNfce.items.map((item) => (
              <div
                key={item.id}
                className={`flex items-start gap-3 rounded-lg border p-3 ${corDoStatus(item.status)}`}
              >
                <IconeStatus status={item.status} />
                <div className="min-w-0">
                  <p className="font-medium text-sm">{item.label}</p>
                  <p className="text-xs opacity-90 break-words">{item.detail}</p>
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </Card>

      {/* Tributação da NFC-e (regras em tax_rules) */}
      <TributacaoSection crt={form.crt} />

      {/* Séries e numeração */}
      <Card className="p-6">
        <h2 className="font-heading font-semibold text-lg mb-1">Séries e numeração</h2>
        <p className="text-sm text-muted-foreground mb-4">
          A numeração é reservada pelo servidor a cada emissão, por modelo, série e
          ambiente. Não é editável aqui para não quebrar a sequência oficial.
        </p>
        {series.length ? (
          <div className="divide-y rounded-lg border">
            {series.map((s) => (
              <div key={s.id} className="flex items-center justify-between p-3 text-sm">
                <div>
                  <span className="font-medium">{MODELOS[s.model] || s.model}</span>
                  <span className="text-muted-foreground"> · série {s.series}</span>
                  <Badge variant="outline" className="ml-2 text-xs">
                    {s.environment === "producao" ? "Produção" : "Homologação"}
                  </Badge>
                </div>
                <span className="text-muted-foreground">
                  último número emitido: <strong>{s.current_number}</strong>
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Nenhuma série criada ainda. A primeira é aberta automaticamente na
            primeira emissão de cada modelo.
          </p>
        )}
      </Card>

      <div className="flex items-center gap-3">
        <Button onClick={salvar} disabled={salvando} className="gap-2">
          {salvando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Salvar configuração fiscal
        </Button>
        <Button variant="outline" onClick={carregar} disabled={salvando} className="gap-2">
          <RefreshCw className="w-4 h-4" /> Recarregar
        </Button>
      </div>
    </div>
  );
}
