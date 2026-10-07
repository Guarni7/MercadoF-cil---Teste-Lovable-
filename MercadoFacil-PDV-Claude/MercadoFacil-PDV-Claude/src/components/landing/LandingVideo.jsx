import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Play, Store, ShoppingCart, Package, Users, Wallet } from "lucide-react";
import { LANDING_YOUTUBE_ID, getLandingYoutubeEmbedUrl } from "@/lib/landingVideo";

const modules = [
  { icon: ShoppingCart, label: "PDV", tone: "bg-emerald-500" },
  { icon: Package, label: "Estoque", tone: "bg-teal-500" },
  { icon: Users, label: "Clientes", tone: "bg-cyan-600" },
  { icon: Wallet, label: "Financeiro", tone: "bg-emerald-600" },
];

function PosterFrame({ onPlay }) {
  return (
    <button
      type="button"
      onClick={onPlay}
      className="group relative aspect-video w-full overflow-hidden rounded-2xl border border-white/10 bg-[#0c1614] text-left shadow-2xl shadow-emerald-950/40 outline-none ring-offset-2 focus-visible:ring-2 focus-visible:ring-emerald-400"
      aria-label="Assistir demonstração do MercadoFácil PDV"
    >
      {/* Soft product UI as poster */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_30%_20%,rgba(16,185,129,0.28),transparent_55%),radial-gradient(ellipse_at_80%_80%,rgba(45,212,191,0.18),transparent_50%)]" />
      <div
        className="absolute inset-0 opacity-[0.07]"
        style={{
          backgroundImage:
            "linear-gradient(to right, #fff 1px, transparent 1px), linear-gradient(to bottom, #fff 1px, transparent 1px)",
          backgroundSize: "48px 48px",
        }}
      />

      <div className="absolute left-4 right-4 top-4 flex items-center gap-2 sm:left-6 sm:right-6 sm:top-5">
        <div className="flex gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-red-400/90" />
          <span className="h-2.5 w-2.5 rounded-full bg-amber-400/90" />
          <span className="h-2.5 w-2.5 rounded-full bg-emerald-400/90" />
        </div>
        <div className="ml-2 flex flex-1 items-center gap-2 rounded-lg bg-white/5 px-3 py-1.5 text-[11px] text-white/50">
          <Store className="h-3.5 w-3.5 text-emerald-400" />
          app.mercadofacil — PDV
        </div>
      </div>

      <div className="absolute inset-x-6 bottom-6 top-16 grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
        {modules.map((m) => {
          const Icon = m.icon;
          return (
            <div
              key={m.label}
              className="flex flex-col items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 p-3 backdrop-blur-sm sm:p-4"
            >
              <span className={`flex h-10 w-10 items-center justify-center rounded-xl ${m.tone} text-white shadow-lg`}>
                <Icon className="h-5 w-5" />
              </span>
              <span className="text-xs font-semibold text-white/90">{m.label}</span>
            </div>
          );
        })}
      </div>

      {/* Play overlay */}
      <div className="absolute inset-0 flex items-center justify-center bg-black/25 transition-colors group-hover:bg-black/35">
        <span className="relative flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500 text-white shadow-[0_0_40px_rgba(16,185,129,0.55)] transition-transform group-hover:scale-110 sm:h-20 sm:w-20">
          <Play className="ml-1 h-7 w-7 fill-current sm:h-8 sm:w-8" />
        </span>
      </div>

      <div className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full border border-white/15 bg-black/40 px-3 py-1 text-[11px] font-medium text-white/80 backdrop-blur-sm">
        {LANDING_YOUTUBE_ID ? "Assistir demonstração" : "Demonstração em breve"}
      </div>
    </button>
  );
}

export default function LandingVideo() {
  const [playing, setPlaying] = useState(false);
  const embedUrl = getLandingYoutubeEmbedUrl(true);

  return (
    <section id="demo" className="relative overflow-hidden bg-[#071210] py-16 text-white lg:py-24">
      <div className="pointer-events-none absolute -left-24 top-10 h-72 w-72 rounded-full bg-emerald-500/20 blur-3xl" />
      <div className="pointer-events-none absolute -right-16 bottom-0 h-80 w-80 rounded-full bg-teal-400/15 blur-3xl" />

      <div className="relative mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.55 }}
          className="mb-10 text-center"
        >
          <p className="mb-3 text-sm font-semibold uppercase tracking-[0.2em] text-emerald-400/90">
            Demonstração
          </p>
          <h2 className="font-heading text-3xl font-bold tracking-tight sm:text-4xl">
            Veja o MercadoFácil em ação
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-base text-white/65 sm:text-lg">
            PDV, estoque e fiscal no mesmo fluxo — como a loja opera no dia a dia.
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 32 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.65, delay: 0.08 }}
        >
          <AnimatePresence mode="wait">
            {playing && embedUrl ? (
              <motion.div
                key="embed"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="aspect-video overflow-hidden rounded-2xl border border-white/10 shadow-2xl"
              >
                <iframe
                  title="Demonstração MercadoFácil PDV"
                  src={embedUrl}
                  className="h-full w-full"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                />
              </motion.div>
            ) : (
              <motion.div key="poster" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <PosterFrame
                  onPlay={() => {
                    if (embedUrl) setPlaying(true);
                  }}
                />
                {!LANDING_YOUTUBE_ID && (
                  <p className="mt-4 text-center text-sm text-white/45">
                    O vídeo entra aqui assim que você enviar o link do YouTube.
                  </p>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </div>
    </section>
  );
}
