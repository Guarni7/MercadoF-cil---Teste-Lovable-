import React from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";

const fadeUp = {
  hidden: { opacity: 0, y: 30 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: "easeOut" } },
};
const stagger = { show: { transition: { staggerChildren: 0.1 } } };

export default function LandingCTA() {
  return (
    <section className="relative overflow-hidden bg-gradient-to-r from-emerald-600 to-teal-600">
      <div className="absolute -left-20 top-0 h-72 w-72 rounded-full bg-white/10 blur-3xl" />
      <div className="absolute -right-20 bottom-0 h-72 w-72 rounded-full bg-white/10 blur-3xl" />

      <div className="mx-auto max-w-4xl px-4 py-20 text-center sm:px-6 lg:py-28">
        <motion.div initial="hidden" whileInView="show" viewport={{ once: true }} variants={stagger}>
          <motion.h2 variants={fadeUp} className="mb-4 text-3xl font-bold tracking-tight text-white sm:text-4xl">
            Pronto para simplificar seu mercado?
          </motion.h2>
          <motion.p variants={fadeUp} className="mx-auto mb-8 max-w-xl text-lg text-white/90">
            Comece agora e tenha 7 dias grátis para conhecer o MercadoFácil PDV.
          </motion.p>
          <motion.div variants={fadeUp}>
            <Link to="/login">
              <Button size="lg" className="h-12 bg-white px-10 text-base text-emerald-700 hover:bg-white/90">
                Testar grátis <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
          </motion.div>
          <motion.p variants={fadeUp} className="mt-6 text-sm text-white/80">
            Sem taxa de adesão • Sem fidelidade
          </motion.p>
        </motion.div>
      </div>
    </section>
  );
}