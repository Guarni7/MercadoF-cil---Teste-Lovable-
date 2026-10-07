import React from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Check, Clock } from "lucide-react";
import { PLANS, TRIAL_DAYS, getPlanById, formatMonthlyPrice } from "@/lib/plans";

export default function MeuPlanoTab() {
  const currentPlanId = localStorage.getItem("selected_plan") || "mei";
  const currentPlan = getPlanById(currentPlanId);
  const CurrentIcon = currentPlan.icon;

  return (
    <div className="space-y-6">
      <Card className="p-6 border-primary/30">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center">
              <CurrentIcon className="w-6 h-6 text-primary" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-heading font-bold text-lg">Plano {currentPlan.name}</h2>
                <Badge className="bg-amber-500">Período de teste</Badge>
              </div>
              <p className="text-sm text-muted-foreground flex items-center gap-1.5 mt-0.5">
                <Clock className="w-3.5 h-3.5" /> Expira em {TRIAL_DAYS} dias
              </p>
            </div>
          </div>
          <Button>Ativar Plano</Button>
        </div>
      </Card>

      <div className="grid sm:grid-cols-2 gap-4">
        {PLANS.map((plan) => {
          const Icon = plan.icon;
          const isCurrent = plan.id === currentPlanId;
          return (
            <Card key={plan.id} className={`p-6 ${isCurrent ? "border-primary" : ""}`}>
              <div className="flex items-center gap-3 mb-4">
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${isCurrent ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
                  <Icon className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-heading font-semibold text-lg">{plan.name}</h3>
                  <p className="text-sm text-muted-foreground">{formatMonthlyPrice(plan.monthlyPrice)}</p>
                </div>
                {isCurrent && <Badge className="ml-auto">Atual</Badge>}
              </div>
              <div className="space-y-2">
                {plan.features.map((f, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm">
                    <Check className="w-4 h-4 text-emerald-600 shrink-0" />
                    {f}
                  </div>
                ))}
              </div>
              {!isCurrent && (
                <Button variant="outline" className="w-full mt-5">Fazer Upgrade</Button>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}