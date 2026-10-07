import React, { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { abaDaUrl, paramsComAba } from "@/lib/abasConfiguracoes";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { toast } from "sonner";
import { Save, Loader2, Trash2, Smartphone, Monitor, Apple, Building2, CreditCard, ShoppingCart, FileText, Palette, Headphones, Settings } from "lucide-react";
import AparenciaTab from "@/components/config/AparenciaTab";
import SuporteTab from "@/components/config/SuporteTab";
import PagamentoTab from "@/components/config/PagamentoTab";
import BalancaTab from "@/components/config/BalancaTab";
import EtiquetaTab from "@/components/config/EtiquetaTab";
import FiscalTab from "@/components/config/FiscalTab";
import VendasTab from "@/components/config/VendasTab";
import ImpressoraTab from "@/components/config/ImpressoraTab";
import ExtrasSection from "@/components/config/ExtrasSection";
import FinanceiroSection from "@/components/config/FinanceiroSection";
import { api } from "@/api/dataClient";
import { getCachedCompany, syncCompanyCache } from "@/lib/companyCache";
import { mensagemDeErro } from "@/lib/mensagemErro";

const FLOAT_TITLES = {
  extras: "Extras",
  balanca: "Balança",
  etiqueta: "Balança de Etiqueta",
  impressora: "Impressora",
  financeiro: "Financeiro",
};

export default function Configuracoes() {
  const [form, setForm] = useState(/** @type {Record<string, any>} */ ({}));
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  // A aba ativa vive na URL (?aba=pagamento): sobrevive ao F5 e o link leva direto à aba. Valor
  // desconhecido cai em "empresa"; trocar de aba substitui a entrada do histórico (sem empilhar).
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = abaDaUrl(searchParams.get("aba"));
  const setActiveTab = (aba) => setSearchParams((atuais) => paramsComAba(atuais, aba), { replace: true });
  const [floatPanel, setFloatPanel] = useState(null);

  useEffect(() => {
    // O cadastro vive no banco: lendo só do localStorage, outro terminal abria
    // a tela em branco (e imprimia cupom sem os dados da empresa).
    const local = getCachedCompany();
    setForm(local);
    syncCompanyCache()
      .then(({ dados }) => setForm((prev) => ({ ...prev, ...dados })))
      .finally(() => setLoading(false));
  }, []);

  const handleChange = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      // Grava no banco primeiro: o localStorage é só cache para uso offline.
      const res = await api.functions.invoke("registerCompany", {
        trade_name: form.trade_name,
        legal_name: form.legal_name || form.trade_name,
        document: form.document,
        phone: form.phone,
        email: form.email,
        cep: form.cep,
        address: form.address,
        address_number: form.address_number,
        complement: form.complement,
        neighborhood: form.neighborhood,
        city: form.city,
        state: form.state,
        instagram: form.instagram,
      });
      const data = res?.data || res;
      if (data?.error) throw new Error(data.error);
      await syncCompanyCache();
      toast.success("Dados da empresa salvos!");
    } catch (e) {
      console.error("Erro ao salvar dados da empresa:", e);
      toast.error(mensagemDeErro(e, "salvar os dados da empresa"));
    } finally {
      setSaving(false);
    }
  };

  const openFloat = (key) => setFloatPanel(key);
  const closeFloat = () => setFloatPanel(null);

  const handleVendasNavigate = (target) => {
    if (
      target === "extras" ||
      target === "balanca" ||
      target === "etiqueta" ||
      target === "impressora" ||
      target === "financeiro"
    ) {
      openFloat(target);
      return;
    }
    setActiveTab(target);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="w-8 h-8 border-4 border-muted border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-4 lg:p-6">
      <h1 className="text-2xl font-heading font-bold mb-6">Configurações</h1>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="mb-6 h-auto w-full flex-nowrap overflow-x-auto rounded-full bg-[#e8edef] border border-slate-300/60 p-1.5 gap-1">
          <TabsTrigger value="empresa" className="flex-1 rounded-full gap-1.5 px-2 text-xs text-[#596f75] data-[state=active]:bg-[#006d77] data-[state=active]:text-white data-[state=active]:shadow-none whitespace-nowrap">
            <Building2 className="w-3.5 h-3.5" /> Empresa
          </TabsTrigger>
          <TabsTrigger value="pagamento" className="flex-1 rounded-full gap-1.5 px-2 text-xs text-[#596f75] data-[state=active]:bg-[#006d77] data-[state=active]:text-white data-[state=active]:shadow-none whitespace-nowrap">
            <CreditCard className="w-3.5 h-3.5" /> Pagamento
          </TabsTrigger>
          <TabsTrigger value="vendas" className="flex-1 rounded-full gap-1.5 px-2 text-xs text-[#596f75] data-[state=active]:bg-[#006d77] data-[state=active]:text-white data-[state=active]:shadow-none whitespace-nowrap">
            <ShoppingCart className="w-3.5 h-3.5" /> Vendas
          </TabsTrigger>
          <TabsTrigger value="fiscal" className="flex-1 rounded-full gap-1.5 px-2 text-xs text-[#596f75] data-[state=active]:bg-[#006d77] data-[state=active]:text-white data-[state=active]:shadow-none whitespace-nowrap">
            <FileText className="w-3.5 h-3.5" /> Fiscal
          </TabsTrigger>
          <TabsTrigger value="aparencia" className="flex-1 rounded-full gap-1.5 px-2 text-xs text-[#596f75] data-[state=active]:bg-[#006d77] data-[state=active]:text-white data-[state=active]:shadow-none whitespace-nowrap">
            <Palette className="w-3.5 h-3.5" /> Aparência
          </TabsTrigger>
          <TabsTrigger value="suporte" className="flex-1 rounded-full gap-1.5 px-2 text-xs text-[#596f75] data-[state=active]:bg-[#006d77] data-[state=active]:text-white data-[state=active]:shadow-none whitespace-nowrap">
            <Headphones className="w-3.5 h-3.5" /> Suporte
          </TabsTrigger>
        </TabsList>

        <TabsContent value="empresa" className="space-y-6">
          <Card className="p-6">
            <h2 className="font-heading font-semibold text-lg mb-4">Dados da Empresa</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                <Label>Nome da Empresa</Label>
                <Input value={form.trade_name || ""} onChange={(e) => handleChange("trade_name", e.target.value)} placeholder="Nome do minimercado" />
              </div>
              <div>
                <Label>CNPJ</Label>
                <Input value={form.document || ""} onChange={(e) => handleChange("document", e.target.value)} placeholder="00.000.000/0000-00" />
              </div>
              <div>
                <Label>CEP</Label>
                <Input value={form.cep || ""} onChange={(e) => handleChange("cep", e.target.value)} placeholder="00000-000" />
              </div>
              <div className="sm:col-span-2">
                <Label>Logradouro</Label>
                <Input value={form.address || ""} onChange={(e) => handleChange("address", e.target.value)} placeholder="Rua, Avenida..." />
              </div>
              <div>
                <Label>Número</Label>
                <Input value={form.address_number || ""} onChange={(e) => handleChange("address_number", e.target.value)} placeholder="123" />
              </div>
              <div>
                <Label>Complemento</Label>
                <Input value={form.complement || ""} onChange={(e) => handleChange("complement", e.target.value)} placeholder="Sala, Bloco..." />
              </div>
              <div>
                <Label>Bairro</Label>
                <Input value={form.neighborhood || ""} onChange={(e) => handleChange("neighborhood", e.target.value)} placeholder="Centro" />
              </div>
              <div>
                <Label>Cidade</Label>
                <Input value={form.city || ""} onChange={(e) => handleChange("city", e.target.value)} />
              </div>
              <div>
                <Label>UF</Label>
                <Input value={form.state || ""} onChange={(e) => handleChange("state", e.target.value)} placeholder="MG" maxLength={2} />
              </div>
              <div>
                <Label>Telefone / WhatsApp</Label>
                <Input value={form.phone || ""} onChange={(e) => handleChange("phone", e.target.value)} placeholder="(00) 00000-0000" />
              </div>
              <div>
                <Label>E-mail</Label>
                <Input type="email" value={form.email || ""} onChange={(e) => handleChange("email", e.target.value)} />
              </div>
              <div className="sm:col-span-2">
                <Label>Instagram</Label>
                <Input value={form.instagram || ""} onChange={(e) => handleChange("instagram", e.target.value)} placeholder="@seu_minimercado" />
              </div>
            </div>
            <Button onClick={handleSave} disabled={saving} className="mt-5 gap-2">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Salvar Dados da Empresa
            </Button>
          </Card>

          <Card className="p-6">
            <h2 className="font-heading font-semibold text-lg mb-2">Instalar Aplicativo</h2>
            <p className="text-sm text-muted-foreground mb-4">
              Instale o app na tela inicial do seu dispositivo para acesso rápido.
            </p>
            <div className="space-y-3">
              <div className="flex items-center gap-3 p-3 rounded-lg border">
                <Smartphone className="w-5 h-5 text-muted-foreground shrink-0" />
                <div>
                  <div className="text-sm font-medium">Android / Chrome</div>
                  <div className="text-xs text-muted-foreground">Adicionar App na Tela Inicial</div>
                </div>
              </div>
              <div className="flex items-center gap-3 p-3 rounded-lg border">
                <Apple className="w-5 h-5 text-muted-foreground shrink-0" />
                <div>
                  <div className="text-sm font-medium">iPhone / Safari</div>
                  <div className="text-xs text-muted-foreground">Botão Compartilhar → Adicionar à Tela de Início</div>
                </div>
              </div>
              <div className="flex items-center gap-3 p-3 rounded-lg border">
                <Monitor className="w-5 h-5 text-muted-foreground shrink-0" />
                <div>
                  <div className="text-sm font-medium">Desktop</div>
                  <div className="text-xs text-muted-foreground">Ícone de instalação na barra de endereços</div>
                </div>
              </div>
            </div>
          </Card>

          <Card className="p-6 border-destructive/30">
            <h2 className="font-heading font-semibold text-lg mb-2 text-destructive">Excluir Conta</h2>
            <p className="text-sm text-muted-foreground mb-4">
              Ao excluir sua conta, todos os seus dados serão permanentemente removidos, incluindo vendas,
              clientes e configurações. Esta ação não pode ser revertida.
            </p>
            <Button variant="destructive" className="gap-2">
              <Trash2 className="w-4 h-4" /> Excluir Minha Conta
            </Button>
          </Card>
        </TabsContent>

        <TabsContent value="pagamento">
          <PagamentoTab />
        </TabsContent>
        <TabsContent value="vendas">
          <VendasTab onNavigate={handleVendasNavigate} />
        </TabsContent>
        <TabsContent value="fiscal">
          <FiscalTab />
        </TabsContent>
        <TabsContent value="aparencia">
          <AparenciaTab />
        </TabsContent>
        <TabsContent value="suporte">
          <SuporteTab />
        </TabsContent>
      </Tabs>

      <Sheet open={!!floatPanel} onOpenChange={(open) => !open && closeFloat()}>
        <SheetContent
          side="right"
          className="w-full sm:max-w-xl p-0 flex flex-col gap-0 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right duration-300"
        >
          <SheetHeader className="px-5 pt-5 pb-3 border-b text-left space-y-0 shrink-0">
            <div className="flex items-center gap-2 pr-8">
              <Settings className="w-4 h-4 text-primary" />
              <SheetTitle className="text-base">
                {FLOAT_TITLES[floatPanel] || "Configurações"}
              </SheetTitle>
            </div>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto px-5 py-4">
            {floatPanel === "extras" && <ExtrasSection onBack={closeFloat} />}
            {floatPanel === "balanca" && <BalancaTab onBack={closeFloat} />}
            {floatPanel === "etiqueta" && <EtiquetaTab onBack={closeFloat} />}
            {floatPanel === "impressora" && <ImpressoraTab onBack={closeFloat} />}
            {floatPanel === "financeiro" && <FinanceiroSection onBack={closeFloat} />}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
