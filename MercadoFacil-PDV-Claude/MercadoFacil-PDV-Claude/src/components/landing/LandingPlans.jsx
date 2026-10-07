import React from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Check, CreditCard, Landmark, FileText, MessageCircle, UtensilsCrossed } from "lucide-react";
import { PLANS, ADDONS, ADDONS_TAGLINE, TRIAL_DAYS, formatAddonPrice } from "@/lib/plans";
import { formatBRL } from "@/lib/format";

const fadeUp = {
  hidden: { opacity: 0, y: 30 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: "easeOut" } },
};
const stagger = { show: { transition: { staggerChildren: 0.1 } } };

const planos = PLANS.map((p) => ({
  ...p,
  features: [...p.features, `${TRIAL_DAYS} dias de teste grátis`, "Sem fidelidade"],
  button: p.id === "mei" ? "Começar agora" : "Testar grátis",
}));

// Mesmo conjunto de src/lib/plans.js (ADDONS) — ícone só de apresentação.
const ADDON_ICONS = { pdv_pos: CreditCard, tef_sitef: Landmark, whatsapp: MessageCircle, nfse: FileText, mesas: UtensilsCrossed };
const complementos = ADDONS.map((a) => ({ icon: ADDON_ICONS[a.id] || FileText, name: a.label, price: formatAddonPrice(a), description: a.description }));

export default function LandingPlans() {
  return (
    <section id="planos" className="bg-muted/30 py-16 lg:py-24">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <motion.div initial="hidden" whileInView="show" viewport={{ once: true }} variants={stagger} className="mb-12 text-center">
          <motion.p variants={fadeUp} className="mb-2 text-sm font-semibold uppercase tracking-[0.18em] text-emerald-700">
            Planos
          </motion.p>
          <motion.h2 variants={fadeUp} className="text-3xl font-bold tracking-tight sm:text-4xl">
            Monte o plano ideal para seu mercado
          </motion.h2>
          <motion.p variants={fadeUp} className="mt-3 text-lg text-muted-foreground">
            Base MEI ou Simples + complementos opcionais · Sem taxa de adesão · 7 dias grátis · Sem fidelidade
          </motion.p>
        </motion.div>

        {/* Plans */}
        <motion.div initial="hidden" whileInView="show" viewport={{ once: true }} variants={stagger} className="mx-auto grid max-w-4xl gap-6 sm:grid-cols-2">
          {planos.map((p) => {
            const Icon = p.icon;
            return (
              <motion.div key={p.name} variants={fadeUp} whileHover={{ y: -4 }}>
                <Card className={`relative h-full p-6 ${p.highlighted ? "border-primary ring-2 ring-primary/20 shadow-lg" : ""}`}>
                  {p.highlighted && (
                    <Badge className="absolute -top-3 left-1/2 -translate-x-1/2 bg-emerald-600 text-white">
                      RECOMENDADO
                    </Badge>
                  )}
                  <div className="mb-4 flex items-center gap-3">
                    <div className={`flex h-12 w-12 items-center justify-center rounded-xl ${p.highlighted ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
                      <Icon className="h-6 w-6" />
                    </div>
                    <div>
                      <h3 className="text-lg font-bold">{p.name}</h3>
                      <p className="text-sm text-muted-foreground">por mês</p>
                    </div>
                  </div>
                  <p className="mb-2 text-3xl font-bold text-primary">{formatBRL(p.monthlyPrice)}<span className="text-base font-normal text-muted-foreground">/mês</span></p>
                  <p className="mb-5 text-sm text-muted-foreground">{p.tagline}</p>
                  <div className="mb-6 space-y-2.5">
                    {p.features.map((f) => (
                      <div key={f} className="flex items-center gap-2 text-sm">
                        <Check className="h-4 w-4 shrink-0 text-emerald-600" /> {f}
                      </div>
                    ))}
                  </div>
                  <Link to="/login">
                    <Button className={`w-full ${p.highlighted ? "bg-emerald-600 text-white hover:bg-emerald-700" : ""}`}>
                      {p.button}
                    </Button>
                  </Link>
                </Card>
              </motion.div>
            );
          })}
        </motion.div>

        {/* Complements */}
        <motion.div initial="hidden" whileInView="show" viewport={{ once: true }} variants={stagger} className="mt-16">
          <motion.h3 variants={fadeUp} className="mb-6 text-center text-xl font-bold">
            Complementos opcionais
          </motion.h3>
          <motion.p variants={fadeUp} className="-mt-4 mb-6 text-center text-sm text-muted-foreground">
            {ADDONS_TAGLINE}
          </motion.p>
          <motion.div variants={stagger} className="mx-auto grid max-w-4xl grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            {complementos.map((c) => {
              const Icon = c.icon;
              return (
                <motion.div key={c.name} variants={fadeUp} whileHover={{ y: -4 }}>
                  <Card className="p-4 text-center transition-all hover:shadow-md hover:border-primary/40">
                    <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-100">
                      <Icon className="h-5 w-5 text-emerald-600" />
                    </div>
                    <p className="text-sm font-semibold">{c.name}</p>
                    <p className="text-xs text-muted-foreground">{c.price}</p>
                    <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{c.description}</p>
                  </Card>
                </motion.div>
              );
            })}
          </motion.div>
        </motion.div>
      </div>
    </section>
  );
}