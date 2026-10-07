import React, { useState } from "react";
import { Plus, CheckCircle, Repeat, FileText } from "lucide-react";
import { Card } from "@/components/ui/card";
import AccountForm from "@/components/financeiro/AccountForm";
import AccountList from "@/components/financeiro/AccountList";
import RecurringAccounts from "@/components/financeiro/RecurringAccounts";
import AccountReport from "@/components/financeiro/AccountReport";

const actions = [
  {
    key: "form",
    title: "Lançar / Criar Contas",
    desc: "Nova conta a pagar ou receber",
    icon: Plus,
    color: "bg-blue-50 text-blue-600",
  },
  {
    key: "list",
    title: "Receber / Pagar Contas",
    desc: "Baixe e receba lançamentos",
    icon: CheckCircle,
    color: "bg-emerald-50 text-emerald-600",
  },
  {
    key: "recurring",
    title: "Recorrentes / Parceladas",
    desc: "Assinaturas e parcelamentos",
    icon: Repeat,
    color: "bg-purple-50 text-purple-600",
  },
  {
    key: "report",
    title: "Relatório",
    desc: "DRE e histórico financeiro",
    icon: FileText,
    color: "bg-amber-50 text-amber-600",
  },
];

export default function Financeiro() {
  const [view, setView] = useState("menu");

  if (view === "form") return <AccountForm onBack={() => setView("menu")} />;
  if (view === "list") return <AccountList onBack={() => setView("menu")} />;
  if (view === "recurring") return <RecurringAccounts onBack={() => setView("menu")} />;
  if (view === "report") return <AccountReport onBack={() => setView("menu")} />;

  return (
    <div className="p-4 lg:p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-heading font-bold">Financeiro</h1>
        <p className="text-muted-foreground text-sm mt-0.5">Gestão de contas a pagar e receber</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {actions.map((action) => {
          const Icon = action.icon;
          return (
            <Card
              key={action.key}
              className="p-6 hover:shadow-md transition-shadow cursor-pointer"
              onClick={() => setView(action.key)}
            >
              <div className={`w-12 h-12 rounded-xl flex items-center justify-center mb-4 ${action.color}`}>
                <Icon className="w-6 h-6" />
              </div>
              <h3 className="font-heading font-semibold text-lg mb-1">{action.title}</h3>
              <p className="text-sm text-muted-foreground">{action.desc}</p>
            </Card>
          );
        })}
      </div>
    </div>
  );
}