import React, { useState } from "react";
import AddonCard from "@/components/plans/AddonCard";
import { Link } from "react-router-dom";
import { ArrowLeft, Sparkles, Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { startTrial } from "@/api/supabaseData";
import { useAuth } from "@/lib/AuthContext";
import PlanPaymentDialog from "@/components/plans/PlanPaymentDialog";
import { mensagemDeErro } from "@/lib/mensagemErro";
import {
  PLANS,
  ADDONS,
  PAYMENT_ADDONS,
  EXTRA_ADDONS,
  TRIAL_DAYS,
  formatMonthlyPrice,
  formatAddonPrice,
  getPlanById,
  getMonthlyTotal,
  isAddonIncluded,
} from "@/lib/plans";

const GREEN = "#2D6A4F";

export default function PlanSelection() {
  const { user, checkUserAuth } = useAuth();
  const params = new URLSearchParams(window.location.search);
  const fromUpgrade = params.get("from") === "upgrade";
  // Quem já teve trial ou plano (inclusive vencido) não ganha outro teste
  // grátis: vai direto pro pagamento. Só empresa que nunca teve plano começa
  // pelo trial. A decisão final de acesso continua no servidor — isto só
  // decide qual fluxo a tela oferece.
  const jaTevePlano =
    !!user?.trial_started_at || ["trial", "active", "expired", "canceled"].includes(user?.plan_status);
  const modoPagamento = fromUpgrade || jaTevePlano;
  // Plano/addons pré-escolhidos vindos de /plano (validados contra o catálogo;
  // o backend recalcula e revalida tudo de qualquer jeito).
  // Sem parâmetro (ex.: plano vencido caiu aqui pelo PlanRoute), parte do plano
  // e dos complementos que a empresa já tem — renovar não pode virar downgrade.
  const planoParam = params.get("plan");
  const planoInicial = PLANS.some((p) => p.id === planoParam)
    ? planoParam
    : PLANS.some((p) => p.id === user?.plan)
      ? user.plan
      : "mei";
  const addonsParam = params.get("addons");
  const addonsIniciais = (addonsParam !== null ? addonsParam.split(",") : user?.plan_addons || []).filter((id) =>
    ADDONS.some((a) => a.id === id)
  );
  const [needNota, setNeedNota] = useState(false);
  const [selected, setSelected] = useState(planoInicial);
  const [selectedAddons, setSelectedAddons] = useState(addonsIniciais);
  const [saving, setSaving] = useState(false);
  const [showPayment, setShowPayment] = useState(false);

  const handleNotaChange = (checked) => {
    setNeedNota(checked);
    if (checked) setSelected("simples");
  };

  const toggleAddon = (id) => {
    setSelectedAddons((prev) => (prev.includes(id) ? prev.filter((a) => a !== id) : [...prev, id]));
  };

  const selectedPlan = getPlanById(selected);
  const chosenAddons = ADDONS.filter((a) => selectedAddons.includes(a.id) || isAddonIncluded(a.id, selected));
  const monthlyTotal = getMonthlyTotal(selected, selectedAddons);

  const handleConfirm = async () => {
    if (modoPagamento) {
      // Plano/addons escolhidos aqui só viram realidade quando o pagamento é
      // confirmado (ver handlePaymentConfirmed) — nada é gravado antes disso.
      setShowPayment(true);
      return;
    }

    setSaving(true);
    try {
      await startTrial(selected);
      await checkUserAuth?.();
      toast.success(`Teste grátis de ${TRIAL_DAYS} dias ativado!`);
      window.location.href = "/";
    } catch (e) {
      console.error("Erro ao iniciar o teste grátis:", e);
      toast.error(mensagemDeErro(e, "iniciar o teste grátis"));
      setSaving(false);
    }
  };

  const handlePaymentConfirmed = async () => {
    // generate-pix-payment/check-pix-payment já ativaram o plano no banco
    // (companies.plan_status/plan_expires_at/plan_addons) — só precisa
    // atualizar o usuário em memória e deixar o PlanRoute reavaliar.
    await checkUserAuth?.();
    toast.success(`Plano ${selectedPlan.name} ativado!`);
    window.location.href = "/";
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-slate-100">
      <div className="px-4 py-4">
        <Link
          to={modoPagamento ? "/plano" : "/register"}
          className="inline-flex items-center gap-2 text-gray-800 font-medium text-sm hover:opacity-70"
        >
          <ArrowLeft className="w-4 h-4" />
          {modoPagamento ? "Voltar" : "Criar Conta Grátis"}
        </Link>
      </div>

      <div className="max-w-5xl mx-auto px-4 py-6">
        <div className="text-center mb-8">
          <div
            className="inline-flex items-center justify-center w-14 h-14 rounded-2xl mb-4"
            style={{ backgroundColor: GREEN }}
          >
            <Sparkles className="w-7 h-7 text-white" />
          </div>
          <h1 className="text-3xl font-bold text-gray-800 mb-2">Monte o seu plano</h1>
          <p className="text-gray-700">
            {modoPagamento ? (
              <>Escolha o plano e os complementos e pague via PIX para ativar a assinatura.</>
            ) : (
              <>
                Teste grátis por <strong>{TRIAL_DAYS} dias</strong>, sem cartão. Você ativa o pagamento depois.
              </>
            )}
          </p>
        </div>

        {/* 1. Base */}
        <div className="mb-10">
          <h2 className="text-lg font-bold text-gray-800 mb-4">1. Base</h2>

          <div className="mb-6 max-w-2xl">
            <label className="flex items-start gap-3 p-4 bg-white rounded-xl border border-slate-200 shadow-sm cursor-pointer">
              <Checkbox checked={needNota} onCheckedChange={handleNotaChange} />
              <span className="text-sm text-gray-800">
                Preciso emitir nota fiscal (NFC-e / NF-e). O plano MEI não emite nota — ao marcar,
                selecionamos o Simples Nacional.
              </span>
            </label>
          </div>

          <div className="grid sm:grid-cols-2 gap-4 max-w-3xl">
            {PLANS.map((plan) => {
              const isSelected = selected === plan.id;
              const isDisabled = needNota && plan.id === "mei";
              return (
                <div
                  key={plan.id}
                  onClick={() => !isDisabled && setSelected(plan.id)}
                  className={`relative p-6 rounded-2xl transition-all ${
                    isDisabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"
                  }`}
                  style={{
                    backgroundColor: "#FFFFFF",
                    border: `2px solid ${isSelected ? GREEN : "#E2E8F0"}`,
                    boxShadow: isSelected ? "0 4px 20px rgba(45, 106, 79, 0.12)" : "0 1px 3px rgba(0,0,0,0.04)",
                  }}
                >
                  {plan.highlighted && !isDisabled && (
                    <div
                      className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full text-xs font-medium text-white"
                      style={{ backgroundColor: GREEN }}
                    >
                      Recomendado
                    </div>
                  )}
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <h3 className="font-bold text-lg text-gray-800">{plan.name}</h3>
                      <p className="text-gray-600 font-medium mt-1">{formatMonthlyPrice(plan.monthlyPrice)}</p>
                    </div>
                    {isSelected && (
                      <div
                        className="w-6 h-6 rounded-full flex items-center justify-center shrink-0"
                        style={{ backgroundColor: GREEN }}
                      >
                        <Check className="w-4 h-4 text-white" />
                      </div>
                    )}
                  </div>
                  <p className="text-sm text-gray-600 mb-4">{plan.subtitle}</p>
                  <div className="space-y-2">
                    {plan.features.map((f, i) => (
                      <div key={i} className="flex items-start gap-2 text-sm text-gray-700">
                        <Check className="w-4 h-4 shrink-0 mt-0.5" style={{ color: GREEN }} />
                        {f}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* 2. Pagamentos integrados */}
        <div className="mb-10">
          <h2 className="text-lg font-bold text-gray-800 mb-4">2. Pagamentos integrados</h2>
          <div className="grid sm:grid-cols-2 gap-3 max-w-3xl">
            {PAYMENT_ADDONS.map((addon) => {
              const included = isAddonIncluded(addon.id, selected);
              const checked = included || selectedAddons.includes(addon.id);
              return (
                <AddonCard
                  key={addon.id}
                  label={addon.label}
                  description={addon.description}
                  price={included ? `Incluso no ${selectedPlan.name}` : formatAddonPrice(addon)}
                  priceBelow
                  checked={checked}
                  disabled={included}
                  onToggle={() => toggleAddon(addon.id)}
                  accent={GREEN}
                />
              );
            })}
          </div>
        </div>

        {/* 3. Módulos extras */}
        <div className="mb-10">
          <h2 className="text-lg font-bold text-gray-800 mb-4">3. Módulos extras</h2>
          <div className="grid sm:grid-cols-2 gap-3 max-w-3xl">
            {EXTRA_ADDONS.map((addon) => (
              <AddonCard
                key={addon.id}
                label={addon.label}
                description={addon.description}
                price={formatAddonPrice(addon)}
                checked={selectedAddons.includes(addon.id)}
                onToggle={() => toggleAddon(addon.id)}
                accent={GREEN}
              />
            ))}
          </div>
        </div>

        {/* Resumo do seu plano */}
        <div className="mb-8">
          <h2 className="text-lg font-bold text-gray-800 mb-4">Resumo do seu plano</h2>
          <div className="max-w-2xl rounded-2xl border-2 p-5" style={{ borderColor: GREEN, backgroundColor: "#F0FBF6" }}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-gray-600">Plano escolhido</span>
              <span className="font-semibold text-gray-800">{selectedPlan.name}</span>
            </div>
            <div className="mb-3 pb-3 border-b border-emerald-200/60">
              <span className="text-sm text-gray-600">Adicionais</span>
              {chosenAddons.length === 0 ? (
                <p className="text-sm text-gray-500 mt-1">Nenhum</p>
              ) : (
                <div className="space-y-1 mt-1">
                  {chosenAddons.map((a) => {
                    const included = isAddonIncluded(a.id, selected);
                    return (
                      <div key={a.id} className="flex items-center justify-between text-sm">
                        <span className="text-gray-700">{a.label}</span>
                        <span className={included ? "text-emerald-600" : "text-gray-600"}>
                          {included ? "Incluso" : `+ ${formatMonthlyPrice(a.monthlyPrice)}`}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-gray-800">Mensalidade total</span>
              <span className="text-2xl font-bold" style={{ color: GREEN }}>
                {formatMonthlyPrice(monthlyTotal)}
              </span>
            </div>
          </div>
        </div>

        <div className="text-center">
          <Button
            onClick={handleConfirm}
            disabled={saving}
            className="h-12 px-12 text-base font-medium hover:opacity-90 gap-2"
            style={{ backgroundColor: GREEN }}
          >
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            {modoPagamento ? "Ir para pagamento" : "Começar teste grátis"}
          </Button>
        </div>
      </div>

      <PlanPaymentDialog
        open={showPayment}
        onClose={() => setShowPayment(false)}
        plan={selectedPlan}
        addonIds={selectedAddons}
        amount={monthlyTotal}
        onConfirm={handlePaymentConfirmed}
      />
    </div>
  );
}
