import React from "react";
import { motion } from "framer-motion";
import { Card } from "@/components/ui/card";
import { Star, Quote } from "lucide-react";

const fadeUp = {
  hidden: { opacity: 0, y: 30 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: "easeOut" } },
};
const stagger = { show: { transition: { staggerChildren: 0.1 } } };

const testimonials = [
  {
    name: "Carlos Mendes",
    handle: "@mercadomendes",
    text: "O MercadoFácil transformou meu minimercado. Controlo estoque e vendas em tempo real, sem complicação.",
    avatar: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=100&h=100&fit=crop",
  },
  {
    name: "Ana Paula Silva",
    handle: "@supermercadosilva",
    text: "Sistema prático e rápido. O PDV agilizou muito o atendimento aos clientes no horário de pico.",
    avatar: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=100&h=100&fit=crop",
  },
  {
    name: "Roberto Oliveira",
    handle: "@mercadoroberto",
    text: "Os relatórios financeiros me ajudam a tomar decisões melhores para o negócio todos os dias.",
    avatar: "https://images.unsplash.com/photo-1633332755192-727a05c4013d?w=100&h=100&fit=crop",
  },
];

export default function LandingTestimonials() {
  return (
    <section id="depoimentos" className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8 lg:py-24">
      <motion.div initial="hidden" whileInView="show" viewport={{ once: true }} variants={stagger} className="mb-12 text-center">
        <motion.h2 variants={fadeUp} className="text-3xl font-bold tracking-tight sm:text-4xl">
          Quem usa, recomenda
        </motion.h2>
        <motion.p variants={fadeUp} className="mt-3 text-lg text-muted-foreground">
          Depoimentos demonstrativos de como o sistema ajuda no dia a dia
        </motion.p>
      </motion.div>

      <motion.div initial="hidden" whileInView="show" viewport={{ once: true }} variants={stagger} className="grid gap-6 md:grid-cols-3">
        {testimonials.map((t) => (
          <motion.div key={t.name} variants={fadeUp} whileHover={{ y: -4 }}>
            <Card className="relative h-full p-6 transition-all hover:shadow-lg">
              <Quote className="absolute right-4 top-4 h-8 w-8 text-primary/15" />
              <div className="mb-3 flex gap-1">
                {[...Array(5)].map((_, i) => (
                  <Star key={i} className="h-4 w-4 fill-amber-400 text-amber-400" />
                ))}
              </div>
              <p className="mb-5 text-sm text-foreground/80">{t.text}</p>
              <div className="flex items-center gap-3">
                <img src={t.avatar} className="h-11 w-11 rounded-full object-cover ring-2 ring-emerald-100" alt={t.name} />
                <div>
                  <p className="text-sm font-semibold">{t.name}</p>
                  <p className="text-xs text-muted-foreground">{t.handle}</p>
                </div>
              </div>
            </Card>
          </motion.div>
        ))}
      </motion.div>
    </section>
  );
}