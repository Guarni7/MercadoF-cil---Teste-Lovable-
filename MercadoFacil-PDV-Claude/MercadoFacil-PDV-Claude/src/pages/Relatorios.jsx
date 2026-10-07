import React, { useState } from "react";
import {
  LineChart,
  ShoppingCart,
  Package,
  Users,
  Building2,
  ArrowUpDown,
  Percent,
  CreditCard,
  Cake,
  Layers,
  ShoppingBag,
  DollarSign,
  ClipboardCheck,
  Shield,
  TrendingUp,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import ResumoReport from "@/components/reports/ResumoReport";
import VendasReport from "@/components/reports/VendasReport";
import ProdutosReport from "@/components/reports/ProdutosReport";
import ClientesReport from "@/components/reports/ClientesReport";
import CaixaReport from "@/components/reports/CaixaReport";
import SangriasReport from "@/components/reports/SangriasReport";
import ComissaoReport from "@/components/reports/ComissaoReport";
import FormaPgtoReport from "@/components/reports/FormaPgtoReport";
import AniversariantesReport from "@/components/reports/AniversariantesReport";
import CompostosReport from "@/components/reports/CompostosReport";
import ComprasReport from "@/components/reports/ComprasReport";
import HistCustosReport from "@/components/reports/HistCustosReport";
import MargemEstoqueReport from "@/components/reports/MargemEstoqueReport";
import AuditoriaReport from "@/components/reports/AuditoriaReport";
import DREReport from "@/components/reports/DREReport";

const reports = [
  { key: "resumo", label: "Resumo", icon: LineChart, color: "text-cyan-600 bg-cyan-50" },
  { key: "vendas", label: "Vendas", icon: ShoppingCart, color: "text-blue-600 bg-blue-50" },
  { key: "produtos", label: "Produtos", icon: Package, color: "text-orange-600 bg-orange-50" },
  { key: "clientes", label: "Clientes", icon: Users, color: "text-purple-600 bg-purple-50" },
  { key: "caixa", label: "Caixa", icon: Building2, color: "text-emerald-600 bg-emerald-50" },
  { key: "sangrias", label: "Sangrias", icon: ArrowUpDown, color: "text-red-600 bg-red-50" },
  { key: "comissao", label: "Comissão", icon: Percent, color: "text-cyan-600 bg-cyan-50" },
  { key: "forma-pgto", label: "Forma Pgto", icon: CreditCard, color: "text-purple-600 bg-purple-50" },
  { key: "aniversariantes", label: "Aniversariantes", icon: Cake, color: "text-pink-600 bg-pink-50" },
  { key: "compostos", label: "Compostos", icon: Layers, color: "text-teal-600 bg-teal-50" },
  { key: "compras", label: "Compras", icon: ShoppingBag, color: "text-orange-600 bg-orange-50" },
  { key: "hist-custos", label: "Hist. Custos", icon: DollarSign, color: "text-emerald-600 bg-emerald-50" },
  { key: "margem-estoque", label: "Margem Estoque", icon: ClipboardCheck, color: "text-blue-600 bg-blue-50" },
  { key: "auditoria", label: "Auditoria", icon: Shield, color: "text-red-600 bg-red-50" },
  { key: "dre", label: "DRE", icon: TrendingUp, color: "text-emerald-600 bg-emerald-50" },
];

const reportComponents = {
  resumo: ResumoReport,
  vendas: VendasReport,
  produtos: ProdutosReport,
  clientes: ClientesReport,
  caixa: CaixaReport,
  sangrias: SangriasReport,
  comissao: ComissaoReport,
  "forma-pgto": FormaPgtoReport,
  aniversariantes: AniversariantesReport,
  compostos: CompostosReport,
  compras: ComprasReport,
  "hist-custos": HistCustosReport,
  "margem-estoque": MargemEstoqueReport,
  auditoria: AuditoriaReport,
  dre: DREReport,
};

export default function Relatorios() {
  const [selected, setSelected] = useState(null);

  if (selected) {
    const Comp = reportComponents[selected];
    if (Comp) return <Comp onBack={() => setSelected(null)} />;
  }

  return (
    <div className="p-4 lg:p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-heading font-bold">Relatórios</h1>
        <p className="text-muted-foreground text-sm mt-0.5">Escolha o tipo de relatório</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
        {reports.map((report) => {
          const Icon = report.icon;
          return (
            <Card
              key={report.label}
              onClick={() =>
                report.soon
                  ? toast.info("Relatório em breve")
                  : setSelected(report.key)
              }
              className={`p-5 flex flex-col items-center gap-3 hover:shadow-lg hover:border-primary/50 hover:-translate-y-0.5 transition-all cursor-pointer text-center group ${
                report.soon ? "opacity-60" : ""
              }`}
            >
              <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${report.color} group-hover:scale-110 transition-transform`}>
                <Icon className="w-6 h-6" />
              </div>
              <span className="text-sm font-medium">{report.label}</span>
            </Card>
          );
        })}
      </div>
    </div>
  );
}