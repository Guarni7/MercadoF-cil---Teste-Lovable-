import React, { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Check, Clock, ArrowRight, XCircle, Phone, X, Lock } from "lucide-react";
import { useAuth } from "@/lib/AuthContext";
import { SUPPORT_PHONE_DISPLAY } from "@/lib/supportContact";
import {
  PLANS,
  PAYMENT_ADDONS,
  EXTRA_ADDONS,
  ADDONS,
  ANNUAL_DISCOUNT_PCT,
  getAnnualPrice,
  getAnnualMonthlyEquivalent,
  getMonthlyTotal,
  isAddonIncluded,
  formatMonthlyPrice,
  formatAddonPrice,
} from "@/lib/plans";
import { formatDate } from "@/lib/format";
import PrecoAnimado from "@/components/plans/PrecoAnimado";
import AddonCard from "@/components/plans/AddonCard";
import { dispararConfete } from "@/lib/confetePlanos";

const plans = PLANS;

const sameSet = (a, b) => a.length === b.length && [...a].sort().every((v, i) => v === [...b].sort()[i]);

export default function Plano() {
  const navigate = useNavigate();
  const { user } = useAuth();
  // Plano e complementos atuais vêm do servidor (companies), nunca de
  // localStorage.
  const currentPlanId = plans.some((p) => p.id === user?.plan) ? user.plan : "mei";
  const currentPlan = plans.find((p) => p.id === currentPlanId) || plans[0];
  const currentAddonIds = Array.isArray(user?.plan_addons) ? user.plan_addons : [];
  const statusPlano = user?.plan_status || "none";
  const expiraEm = user?.plan_expires_at ? new Date(user.plan_expires_at) : null;
  const expirado = !!expiraEm && expiraEm.getTime() < Date.now();
  const [showPlans, setShowPlans] = useState(true);
  const [selected, setSelected] = useState(currentPlanId);
  const [selectedAddons, setSelectedAddons] = useState(currentAddonIds);
  const [billingCycle, setBillingCycle] = useState("mensal");
  const chaveCicloRef = useRef(null);

  // Ao ligar a cobrança anual: fogos de artifício saindo da chave; os preços rolam até o valor novo.
  const alternarCiclo = () => {
    const proximo = billingCycle === "mensal" ? "anual" : "mensal";
    setBillingCycle(proximo);
    if (proximo === "anual") dispararConfete(chaveCicloRef.current);
  };

  const selectedPlan = plans.find((p) => p.id === selected);
  const toggleAddon = (id) => {
    setSelectedAddons((prev) => (prev.includes(id) ? prev.filter((a) => a !== id) : [...prev, id]));
  };

  const currentTotal = getMonthlyTotal(currentPlanId, currentAddonIds);
  const newTotal = getMonthlyTotal(selected, selectedAddons);
  const planChanged = selected !== currentPlanId;
  const addonsChanged = !sameSet(selectedAddons, currentAddonIds);
  const hasChanges = planChanged || addonsChanged;
  // Downgrade automático não é oferecido — só upgrade (MEI → Simples).
  const isDowngrade = plans.findIndex((p) => p.id === selected) < plans.findIndex((p) => p.id === currentPlanId);

  // Nada é gravado nem confirmado aqui: a contratação só acontece no fluxo
  // real de pagamento (PlanSelection + PlanPaymentDialog), que leva o plano e
  // os complementos escolhidos e só libera depois do PIX aprovado e ativado
  // no banco.
  const handleConfirm = () => {
    if (isDowngrade) return;
    const qs = new URLSearchParams({ from: "upgrade", plan: selected });
    if (selectedAddons.length) qs.set("addons", selectedAddons.join(","));
    navigate(`/selecionar-plano?${qs.toString()}`);
  };

  return (
    <div className="p-4 lg:p-6 max-w-6xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-heading font-bold">Meu Plano</h1>
        <p className="text-muted-foreground text-sm mt-0.5">
          Gerencie sua assinatura do MercadoFácil PDV.
        </p>
      </div>

      {/* Plan Status Card */}
      <Card className="p-6 mb-4">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-full bg-amber-100 flex items-center justify-center shrink-0">
            <Clock className="w-6 h-6 text-amber-600" />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="font-heading font-bold text-lg">
                {expirado
                  ? `Plano expirado · ${currentPlan.name}`
                  : statusPlano === "active"
                    ? `Plano ${currentPlan.name}`
                    : statusPlano === "trial"
                      ? `Período de teste · ${currentPlan.name}`
                      : "Sem plano ativo"}
              </h2>
              <Badge
                className={
                  expirado ? "bg-destructive" : statusPlano === "active" ? "bg-emerald-600" : "bg-amber-500"
                }
              >
                {expirado ? "Expirado" : statusPlano === "active" ? "Ativo" : statusPlano === "trial" ? "Teste" : "Inativo"}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              {expiraEm
                ? `${expirado ? "Expirou" : statusPlano === "trial" ? "Expira" : "Válido até"} em ${formatDate(expiraEm)} · `
                : ""}
              <PrecoAnimado value={billingCycle === "anual" ? getAnnualMonthlyEquivalent(currentPlan.monthlyPrice) : currentPlan.monthlyPrice} suffix="/mês" />
              {statusPlano === "trial" && !expirado ? " após o teste" : ""}
            </p>
            <Button
              onClick={() => navigate("/selecionar-plano?from=upgrade")}
              className="mt-4"
            >
              Ver planos / Assinar
              <ArrowRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </Card>

      {/* Plan selection (collapsible) */}
      {showPlans && (
        <div className="mb-4 space-y-4">
          {/* Billing cycle toggle */}
          <div className="flex items-center justify-center gap-3">
            <span className={`text-sm font-semibold ${billingCycle === "mensal" ? "text-foreground" : "text-foreground/60"}`}>Mensal</span>
            <button
              ref={chaveCicloRef}
              onClick={alternarCiclo}
              className={`relative w-12 h-6 rounded-full transition-colors ${billingCycle === "anual" ? "bg-primary" : "bg-foreground/30"}`}
            >
              <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${billingCycle === "anual" ? "translate-x-6" : ""}`} />
            </button>
            <span className={`text-sm font-semibold ${billingCycle === "anual" ? "text-foreground" : "text-foreground/60"}`}>Anual</span>
            <Badge className="bg-emerald-100 text-emerald-700 border-0">Economize {ANNUAL_DISCOUNT_PCT}%</Badge>
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            {plans.map((plan) => {
              const Icon = plan.icon;
              const isCurrent = plan.id === currentPlanId;
              // Pendente = escolhido pra upgrade mas ainda não confirmado.
              // Mesmo verde do plano atual (não é um estado de alerta) — a
              // diferença fica no ícone (check preenchido = tenho; check
              // contornado = vou trocar) e no texto do botão, não na cor.
              const isPending = !isCurrent && selected === plan.id;
              const planIsDowngrade = plans.findIndex((p) => p.id === plan.id) < plans.findIndex((p) => p.id === currentPlanId);
              return (
                <Card
                  key={plan.id}
                  // h-full + flex-col: cards com quantidade diferente de itens
                  // (MEI tem "não incluso", Simples não) ficavam com o botão em
                  // alturas diferentes — isso ancora os dois na mesma linha.
                  className={`p-6 relative h-full flex flex-col ${
                    isCurrent || isPending ? "border-primary border-2" : "border"
                  } ${planIsDowngrade ? "opacity-60" : ""}`}
                >
                  {plan.highlighted && (
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full text-xs font-medium text-white bg-primary">
                      Recomendado
                    </div>
                  )}
                  <div className="flex items-center gap-3 mb-2">
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${isCurrent ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
                      <Icon className="w-5 h-5" />
                    </div>
                    <div className="flex-1">
                      <h3 className="font-heading font-semibold text-lg">{plan.name}</h3>
                      <p className="text-sm font-medium text-muted-foreground">
                        <PrecoAnimado value={billingCycle === "anual" ? getAnnualMonthlyEquivalent(plan.monthlyPrice) : plan.monthlyPrice} suffix="/mês" />
                      </p>
                      {billingCycle === "anual" && (
                        <p className="text-xs text-emerald-600 font-medium">Cobrado <PrecoAnimado value={getAnnualPrice(plan.monthlyPrice)} suffix="/ano" /></p>
                      )}
                    </div>
                    {isCurrent && (
                      <div className="w-6 h-6 rounded-full bg-primary flex items-center justify-center shrink-0">
                        <Check className="w-4 h-4 text-primary-foreground" />
                      </div>
                    )}
                    {isPending && (
                      // Mesmo círculo do "plano atual" (posição e tamanho
                      // idênticos), só contornado em vez de preenchido — sem
                      // texto ao lado, pra não ficar maior/desproporcional
                      // em relação ao indicador do MEI.
                      <div className="w-6 h-6 rounded-full border-2 border-primary flex items-center justify-center shrink-0">
                        <Check className="w-3.5 h-3.5 text-primary" />
                      </div>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground mb-4">{plan.subtitle}</p>
                  <div className="space-y-2 flex-1">
                    {plan.features.map((f, i) => (
                      <div key={i} className="flex items-center gap-2 text-sm">
                        <Check className="w-4 h-4 text-emerald-600 shrink-0" />
                        {f}
                      </div>
                    ))}
                    {plan.notIncluded.map((f, i) => (
                      <div key={`not-${i}`} className="flex items-center gap-2 text-sm text-muted-foreground/60">
                        <X className="w-4 h-4 text-muted-foreground/40 shrink-0" />
                        <span className="line-through">{f}</span>
                      </div>
                    ))}
                  </div>
                  {isCurrent ? (
                    <Button disabled className="w-full mt-5 opacity-100 disabled:opacity-100">
                      Plano atual
                    </Button>
                  ) : planIsDowngrade ? (
                    <p className="flex items-center gap-1.5 text-xs text-muted-foreground mt-5">
                      <Lock className="w-3.5 h-3.5 shrink-0" />
                      Você já está no plano superior — downgrade não é feito automaticamente, fale com o suporte.
                    </p>
                  ) : isPending ? (
                    <Button onClick={() => setSelected(currentPlanId)} variant="outline" className="w-full mt-5">
                      Cancelar seleção
                    </Button>
                  ) : (
                    <Button onClick={() => setSelected(plan.id)} className="w-full mt-5">
                      Fazer upgrade
                    </Button>
                  )}
                </Card>
              );
            })}
          </div>

          {/* Pagamentos integrados */}
          <div>
            <h3 className="font-heading font-semibold text-base mb-3">Pagamentos integrados</h3>
            <div className="grid sm:grid-cols-2 gap-3">
              {PAYMENT_ADDONS.map((addon) => {
                const included = isAddonIncluded(addon.id, selected);
                const checked = included || selectedAddons.includes(addon.id);
                const isActive = currentAddonIds.includes(addon.id) && !included;
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
                    badge={isActive ? <Badge variant="outline" className="text-emerald-600 border-emerald-300">Ativo</Badge> : null}
                  />
                );
              })}
            </div>
          </div>

          {/* Módulos extras */}
          <div>
            <h3 className="font-heading font-semibold text-base mb-3">Módulos extras</h3>
            <div className="grid sm:grid-cols-2 gap-3">
              {EXTRA_ADDONS.map((addon) => {
                const isActive = currentAddonIds.includes(addon.id);
                return (
                  <AddonCard
                    key={addon.id}
                    label={addon.label}
                    description={addon.description}
                    price={formatAddonPrice(addon)}
                    checked={selectedAddons.includes(addon.id)}
                    onToggle={() => toggleAddon(addon.id)}
                    badge={isActive ? <Badge variant="outline" className="text-emerald-600 border-emerald-300">Ativo</Badge> : null}
                  />
                );
              })}
            </div>
          </div>

          {/* Resumo da alteração */}
          {hasChanges && !isDowngrade && (
            <Card className="p-5 border-2 border-primary bg-primary/5">
              <h3 className="font-heading font-semibold text-base mb-3">Resumo da alteração</h3>
              <div className="space-y-1.5 text-sm mb-3">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Plano atual</span>
                  <span className="font-medium">{currentPlan.name}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Complementos ativos</span>
                  <span className="font-medium">
                    {ADDONS.filter((a) => currentAddonIds.includes(a.id)).map((a) => a.label).join(", ") || "Nenhum"}
                  </span>
                </div>
                {planChanged && (
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Novo plano</span>
                    <span className="font-medium">{selectedPlan.name}</span>
                  </div>
                )}
                {addonsChanged && (
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Novos complementos</span>
                    <span className="font-medium">
                      {ADDONS.filter((a) => selectedAddons.includes(a.id)).map((a) => a.label).join(", ") || "Nenhum"}
                    </span>
                  </div>
                )}
                <div className="flex items-center justify-between pt-1.5 border-t">
                  <span className="text-muted-foreground">Valor mensal atual</span>
                  <span className="font-medium">{formatMonthlyPrice(currentTotal)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Novo valor mensal</span>
                  <span className="font-semibold text-primary">{formatMonthlyPrice(newTotal)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Diferença</span>
                  <span className={`font-semibold ${newTotal >= currentTotal ? "text-amber-600" : "text-emerald-600"}`}>
                    {newTotal >= currentTotal ? "+" : ""}
                    {formatMonthlyPrice(newTotal - currentTotal)}
                  </span>
                </div>
              </div>
              <Button onClick={handleConfirm} size="lg" className="w-full">
                {planChanged ? "Atualizar plano" : "Contratar complementos"}
              </Button>
            </Card>
          )}
        </div>
      )}

      {/* Cancel Account Card */}
      <Card className="p-6 border-destructive/30">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center shrink-0">
            <XCircle className="w-6 h-6 text-destructive" />
          </div>
          <div className="flex-1">
            <h2 className="font-heading font-bold text-lg">Cancelar plano</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Ao encerrar, você perde o acesso ao sistema imediatamente — voltando
              apenas ao reativar um plano. Seus dados continuam salvos na nossa base.
            </p>
            <Button variant="outline" className="mt-4 text-destructive border-destructive hover:bg-destructive/10">
              Encerrar conta
            </Button>
          </div>
        </div>
      </Card>

      {/* Footer */}
      <p className="text-center text-sm text-muted-foreground mt-6 flex items-center justify-center gap-1.5">
        <Phone className="w-3.5 h-3.5" />
        Dúvidas ou negociação? {SUPPORT_PHONE_DISPLAY}
      </p>

    </div>
  );
}