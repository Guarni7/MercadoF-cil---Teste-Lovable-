import React from "react";
import { motion } from "framer-motion";
import { Card } from "@/components/ui/card";
import { ShoppingCart, Package, Users, BarChart3, Wallet, Receipt } from "lucide-react";

const fadeUp = {
  hidden: { opacity: 0, y: 30 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: "easeOut" } },
};
const stagger = { show: { transition: { staggerChildren: 0.08 } } };

const features = [
  { icon: ShoppingCart, title: "PDV rápido", desc: "Venda produtos com agilidade e facilidade.", color: "bg-emerald-100 text-emerald-600" },
  { icon: Package, title: "Controle de estoque", desc: "Acompanhe entradas, saídas, estoque mínimo e produtos.", color: "bg-teal-100 text-teal-600" },
  { icon: Users, title: "Clientes e crediário", desc: "Cadastre clientes e controle vendas no crediário.", color: "bg-cyan-100 text-cyan-600" },
  { icon: BarChart3, title: "Relatórios", desc: "Acompanhe vendas, produtos, desempenho e resultados.", color: "bg-amber-100 text-amber-600" },
  { icon: Wallet, title: "Financeiro", desc: "Controle receitas, despesas, caixa e movimentações.", color: "bg-violet-100 text-violet-600" },
  { icon: Receipt, title: "Emissão fiscal", desc: "Suporte para NFC-e e NF-e.", color: "bg-rose-100 text-rose-600" },
];

export default function LandingFeatures() {
  return (
    <section id="recursos" className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8 lg:py-24">
      <motion.div initial="hidden" whileInView="show" viewport={{ once: true }} variants={stagger} className="mb-12 text-center">
        <motion.h2 variants={fadeUp} className="text-3xl font-bold tracking-tight sm:text-4xl">
          Tudo que seu mercado precisa em um só lugar
        </motion.h2>
        <motion.p variants={fadeUp} className="mt-3 text-lg text-muted-foreground">
          Módulos integrados que crescem com o seu negócio
        </motion.p>
      </motion.div>

      <motion.div initial="hidden" whileInView="show" viewport={{ once: true }} variants={stagger} className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {features.map((f) => {
          const Icon = f.icon;
          return (
            <motion.div key={f.title} variants={fadeUp} whileHover={{ y: -4 }}>
              <Card className="h-full p-6 transition-all hover:shadow-lg hover:border-primary/40">
                <div className={`mb-4 flex h-12 w-12 items-center justify-center rounded-xl ${f.color}`}>
                  <Icon className="h-6 w-6" />
                </div>
                <h3 className="mb-2 text-lg font-semibold">{f.title}</h3>
                <p className="text-sm text-muted-foreground">{f.desc}</p>
              </Card>
            </motion.div>
          );
        })}
      </motion.div>
    </section>
  );
}