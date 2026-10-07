import React from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  ArrowRight,
  Check,
  ShieldCheck,
  Clock,
  Cloud,
  ShoppingCart,
  Package,
  TrendingUp,
  Sparkles,
} from "lucide-react";

const fadeUp = {
  hidden: { opacity: 0, y: 30 },
  show: { opacity: 1, y: 0, transition: { duration: 0.6, ease: "easeOut" } },
};
const stagger = { show: { transition: { staggerChildren: 0.1 } } };

const benefits = [
  { icon: Clock, text: "1º mês grátis" },
  { icon: ShieldCheck, text: "Sem taxa de adesão" },
  { icon: Check, text: "Sem fidelidade" },
  { icon: Cloud, text: "100% na nuvem" },
];

const stats = [
  { value: "2.000+", label: "Lojas" },
  { value: "7 dias", label: "Grátis" },
  { value: "100%", label: "Na nuvem" },
  { value: "24/7", label: "Suporte" },
];

function DashboardMockup() {
  return (
    <div className="relative">
      <motion.div
        initial={{ opacity: 0, y: 40 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, delay: 0.3, ease: "easeOut" }}
        className="rounded-2xl border border-border bg-card p-4 shadow-2xl"
      >
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="h-3 w-3 rounded-full bg-red-400" />
            <div className="h-3 w-3 rounded-full bg-amber-400" />
            <div className="h-3 w-3 rounded-full bg-emerald-400" />
          </div>
          <div className="h-6 w-24 rounded bg-muted" />
        </div>
        <div className="mb-4 grid grid-cols-3 gap-3">
          {[
            { icon: ShoppingCart, label: "Vendas Hoje", value: "R$ 2.480", color: "text-emerald-600" },
            { icon: Package, label: "Produtos", value: "1.204", color: "text-teal-600" },
            { icon: TrendingUp, label: "Ticket Médio", value: "R$ 38", color: "text-cyan-600" },
          ].map((kpi) => {
            const Icon = kpi.icon;
            return (
              <div key={kpi.label} className="rounded-xl border border-border bg-muted/40 p-3">
                <Icon className={`mb-2 h-4 w-4 ${kpi.color}`} />
                <p className="text-[10px] text-muted-foreground">{kpi.label}</p>
                <p className="text-sm font-bold">{kpi.value}</p>
              </div>
            );
          })}
        </div>
        <div className="mb-4 rounded-xl border border-border bg-muted/30 p-3">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-medium">Vendas da semana</p>
            <p className="text-[10px] text-emerald-600">+12,4%</p>
          </div>
          <div className="flex h-20 items-end gap-2">
            {[40, 65, 45, 80, 55, 70, 90].map((h, i) => (
              <div
                key={i}
                className="flex-1 rounded-t bg-gradient-to-t from-emerald-500 to-teal-400"
                style={{ height: `${h}%` }}
              />
            ))}
          </div>
        </div>
        <div className="space-y-2">
          {[
            { n: "Arroz 5kg", p: "R$ 24,90", s: "32 un." },
            { n: "Feijão 1kg", p: "R$ 8,50", s: "48 un." },
            { n: "Óleo 900ml", p: "R$ 12,90", s: "25 un." },
          ].map((p) => (
            <div
              key={p.n}
              className="flex items-center justify-between rounded-lg border border-border bg-background px-3 py-2"
            >
              <span className="text-xs font-medium">{p.n}</span>
              <div className="flex items-center gap-3">
                <span className="text-xs text-muted-foreground">{p.s}</span>
                <span className="text-xs font-bold text-emerald-600">{p.p}</span>
              </div>
            </div>
          ))}
        </div>
      </motion.div>
      <motion.div
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 0.8, duration: 0.5 }}
        className="absolute -right-4 -top-4 hidden rounded-xl border border-border bg-card p-3 shadow-xl sm:block"
      >
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-100">
            <Check className="h-4 w-4 text-emerald-600" />
          </div>
          <div>
            <p className="text-xs font-bold">Venda concluída</p>
            <p className="text-[10px] text-muted-foreground">NFC-e emitida</p>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

export default function LandingHero() {
  return (
    <section id="top" className="relative overflow-hidden">
      <div className="absolute inset-0 -z-10 bg-gradient-to-b from-emerald-50 via-background to-background" />
      <div className="absolute -left-20 top-20 -z-10 h-72 w-72 rounded-full bg-emerald-200/30 blur-3xl" />
      <div className="absolute -right-20 top-40 -z-10 h-96 w-96 rounded-full bg-teal-200/20 blur-3xl" />

      <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8 lg:py-24">
        <div className="grid items-center gap-12 lg:grid-cols-2">
          <motion.div initial="hidden" animate="show" variants={stagger} className="text-center lg:text-left">
            <motion.div
              variants={fadeUp}
              className="mb-4 inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-4 py-1.5 text-sm font-medium text-emerald-700"
            >
              <Sparkles className="h-4 w-4" /> Gestão completa para seu minimercado
            </motion.div>
            <motion.h1
              variants={fadeUp}
              className="mb-4 text-4xl font-bold leading-tight tracking-tight sm:text-5xl lg:text-6xl"
            >
              Seu mercado mais <span className="text-primary">organizado</span>, rápido e lucrativo.
            </motion.h1>
            <motion.p
              variants={fadeUp}
              className="mx-auto mb-8 max-w-xl text-lg text-muted-foreground lg:mx-0"
            >
              Tenha PDV, estoque, financeiro, clientes, crediário e emissão fiscal em um único sistema, acessível de qualquer lugar.
            </motion.p>
            <motion.div
              variants={fadeUp}
              className="flex flex-wrap items-center justify-center gap-3 lg:justify-start"
            >
              <Link to="/login">
                <Button size="lg" className="h-12 bg-emerald-600 px-8 text-base text-white hover:bg-emerald-700">
                  Testar grátis <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
              <a href="#recursos">
                <Button size="lg" variant="outline" className="h-12 px-8 text-base">
                  Conhecer recursos
                </Button>
              </a>
            </motion.div>
            <motion.div
              variants={fadeUp}
              className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 lg:justify-start"
            >
              {benefits.map((b) => {
                const Icon = b.icon;
                return (
                  <div key={b.text} className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
                    <Icon className="h-4 w-4 text-emerald-600" /> {b.text}
                  </div>
                );
              })}
            </motion.div>
          </motion.div>

          <div className="relative">
            <DashboardMockup />
          </div>
        </div>

        <motion.div
          initial="hidden"
          whileInView="show"
          viewport={{ once: true }}
          variants={stagger}
          className="mt-16 grid grid-cols-2 gap-4 md:grid-cols-4"
        >
          {stats.map((s) => (
            <motion.div key={s.label} variants={fadeUp} whileHover={{ y: -4 }}>
              <Card className="p-6 text-center">
                <p className="text-3xl font-bold text-primary sm:text-4xl">{s.value}</p>
                <p className="mt-1 text-sm text-muted-foreground">{s.label}</p>
              </Card>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
