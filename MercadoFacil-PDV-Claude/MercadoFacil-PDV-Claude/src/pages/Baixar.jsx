import React from "react";
import DownloadCards from "@/components/landing/DownloadCards";

const TEAL = "#059669";

export default function Baixar() {
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <div className="max-w-5xl mx-auto w-full px-6 pt-16 pb-10">
        <p className="text-sm font-semibold tracking-wider uppercase mb-2" style={{ color: TEAL }}>
          Baixar
        </p>
        <h1 className="text-4xl font-bold text-gray-900 mb-3">Instale o MercadoFácil PDV</h1>
        <p className="text-lg text-gray-500">
          Windows, Android ou direto no navegador — escolha como a loja vai operar.
        </p>
      </div>

      <div className="max-w-5xl mx-auto w-full px-6 pb-16">
        <DownloadCards />
      </div>
    </div>
  );
}
