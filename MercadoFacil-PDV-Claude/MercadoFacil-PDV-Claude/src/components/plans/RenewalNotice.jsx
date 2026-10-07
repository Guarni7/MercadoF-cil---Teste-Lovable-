import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import PlanPaymentDialog from "@/components/plans/PlanPaymentDialog";
import { planPhase } from "@/lib/planAccess";
import { getPlanById, getMonthlyTotal } from "@/lib/plans";
import { formatDate } from "@/lib/format";

/**
 * Aviso de renovação do plano pago: 7 dias ou menos para vencer, ou vencido
 * dentro dos 3 dias de tolerância (o sistema segue liberado nos dois casos).
 * "Renovar" abre o MESMO PlanPaymentDialog do upgrade — mesmo PIX, mesmo
 * backend; a RPC soma 30 dias sobre o maior entre vencimento e agora.
 * Plano e complementos vêm do servidor (companies.plan/plan_addons), então a
 * renovação cobra exatamente o que a empresa já tem.
 */
export default function RenewalNotice({ user }) {
  const [open, setOpen] = useState(false);
  const { phase, daysLeft, graceDaysLeft } = planPhase(user);
  if (phase !== "renewal_due" && phase !== "grace") return null;

  const plan = getPlanById(user.plan);
  const addonIds = Array.isArray(user.plan_addons) ? user.plan_addons : [];
  const vencimento = formatDate(user.plan_expires_at);
  const emGrace = phase === "grace";

  const mensagem = emGrace
    ? `Plano vencido em ${vencimento}. Você ainda tem ${graceDaysLeft} dia${graceDaysLeft === 1 ? "" : "s"} de acesso — renove para não perder o acesso.`
    : daysLeft === 1
      ? `Seu plano vence amanhã (${vencimento}). Renove para não perder o acesso.`
      : `Seu plano vence em ${daysLeft} dias (${vencimento}). Renove para não perder o acesso.`;

  return (
    <>
      <div
        role="alert"
        className={`px-4 py-2 flex items-center justify-center gap-4 text-sm shrink-0 ${
          emGrace ? "bg-destructive text-destructive-foreground" : "bg-amber-500 text-white"
        }`}
      >
        <span>{mensagem}</span>
        <Button
          size="sm"
          variant="outline"
          className="h-7 bg-transparent border-current hover:bg-white/15 hover:text-current whitespace-nowrap"
          onClick={() => setOpen(true)}
        >
          Renovar
        </Button>
      </div>
      <PlanPaymentDialog
        open={open}
        onClose={() => setOpen(false)}
        plan={plan}
        addonIds={addonIds}
        amount={getMonthlyTotal(plan.id, addonIds)}
        renewal
        onConfirm={() => window.location.reload()}
      />
    </>
  );
}
