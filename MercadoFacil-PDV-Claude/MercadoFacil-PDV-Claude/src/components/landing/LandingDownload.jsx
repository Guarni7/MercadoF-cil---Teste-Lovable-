import React from "react";
import { motion } from "framer-motion";
import DownloadCards from "@/components/landing/DownloadCards";

const fadeUp = {
  hidden: { opacity: 0, y: 30 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: "easeOut" } },
};
const stagger = { show: { transition: { staggerChildren: 0.1 } } };

export default function LandingDownload() {
  return (
    <section id="baixar" className="bg-muted/30 py-16 lg:py-24">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <motion.div initial="hidden" whileInView="show" viewport={{ once: true }} variants={stagger} className="mb-12 text-center">
          <motion.p variants={fadeUp} className="mb-2 text-sm font-semibold uppercase tracking-[0.18em] text-emerald-700">
            Baixar
          </motion.p>
          <motion.h2 variants={fadeUp} className="text-3xl font-bold tracking-tight sm:text-4xl">
            Instale o MercadoFácil PDV
          </motion.h2>
          <motion.p variants={fadeUp} className="mt-3 text-lg text-muted-foreground">
            Windows, Android ou direto no navegador — escolha como a loja vai operar.
          </motion.p>
        </motion.div>

        <motion.div initial="hidden" whileInView="show" viewport={{ once: true }} variants={fadeUp}>
          <DownloadCards />
        </motion.div>
      </div>
    </section>
  );
}
