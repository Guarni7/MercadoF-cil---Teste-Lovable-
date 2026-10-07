import React from "react";
import { motion } from "framer-motion";
import { Check, ShoppingCart, Package, TrendingUp, Wallet, Cloud, Smartphone } from "lucide-react";

const fadeUp = {
  hidden: { opacity: 0, y: 30 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: "easeOut" } },
};
const stagger = { show: { transition: { staggerChildren: 0.1 } } };

const benefits = [
  { icon: ShoppingCart, text: "Venda mais rápido" },
  { icon: Package, text: "Controle seu estoque em tempo real" },
  { icon: TrendingUp, text: "Saiba quanto seu mercado está vendendo" },
  { icon: Wallet, text: "Acompanhe seu financeiro" },
  { icon: Cloud, text: "Acesse de qualquer lugar" },
  { icon: Smartphone, text: "Funciona em Android e iOS" },
];

function ShowcaseMockup() {
  return (
    <div className="relative">
      <div className="absolute inset-0 -z-10 rounded-3xl bg-gradient-to-br from-emerald-100 to-teal-50" />
      <div className="grid grid-cols-2 gap-4 rounded-2xl border border-border bg-card p-6 shadow-xl">
        {/* Left panel - PDV */}
        <div className="space-y-2">
          <div className="rounded-lg bg-emerald-600 p-3 text-white">
            <ShoppingCart className="mb-2 h-5 w-5" />
            <p className="text-xs font-bold">PDV</p>
          </div>
          {["Arroz 5kg — R$ 24,90", "Feijão 1kg — R$ 8,50", "Óleo 900ml — R$ 12,90"].map((item) => (
            <div key={item} className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs font-medium">
              {item}
            </div>
          ))}
          <div className="rounded-lg bg-emerald-50 px-3 py-2 text-right text-sm font-bold text-emerald-700">
            Total: R$ 46,30
          </div>
        </div>
        {/* Right panel - Dashboard */}
        <div className="space-y-3">
          <div className="rounded-lg border border-border bg-muted/40 p-3">
            <p className="mb-2 text-[10px] font-medium text-muted-foreground">Vendas do mês</p>
            <div className="flex h-16 items-end gap-1.5">
              {[50, 70, 45, 85, 60, 75, 95].map((h, i) => (
                <div key={i} className="flex-1 rounded-t bg-gradient-to-t from-teal-500 to-emerald-400" style={{ height: `${h}%` }} />
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-lg border border-border bg-muted/40 p-3">
              <p className="text-[10px] text-muted-foreground">Clientes</p>
              <p className="text-lg font-bold">342</p>
            </div>
            <div className="rounded-lg border border-border bg-muted/40 p-3">
              <p className="text-[10px] text-muted-foreground">Crediário</p>
              <p className="text-lg font-bold text-amber-600">R$ 1.2k</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function LandingShowcase() {
  return (
    <section className="bg-muted/30 py-16 lg:py-24">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="grid items-center gap-12 lg:grid-cols-2">
          {/* Mockup */}
          <motion.div initial={{ opacity: 0, x: -30 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ duration: 0.6 }}>
            <ShowcaseMockup />
          </motion.div>

          {/* Benefits */}
          <motion.div initial="hidden" whileInView="show" viewport={{ once: true }} variants={stagger}>
            <motion.h2 variants={fadeUp} className="mb-3 text-3xl font-bold tracking-tight sm:text-4xl">
              Feito para facilitar seu dia
            </motion.h2>
            <motion.p variants={fadeUp} className="mb-8 text-lg text-muted-foreground">
              Tudo o que você precisa para gerenciar seu minimercado com eficiência, na palma da mão.
            </motion.p>
            <div className="space-y-4">
              {benefits.map((b) => {
                const Icon = b.icon;
                return (
                  <motion.div key={b.text} variants={fadeUp} className="flex items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-100">
                      <Icon className="h-5 w-5 text-emerald-600" />
                    </div>
                    <span className="flex items-center gap-2 text-base font-medium">
                      <Check className="h-4 w-4 text-emerald-600" /> {b.text}
                    </span>
                  </motion.div>
                );
              })}
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}