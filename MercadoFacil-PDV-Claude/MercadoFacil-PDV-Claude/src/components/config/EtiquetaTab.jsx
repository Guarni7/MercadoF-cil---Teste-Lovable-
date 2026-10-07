import React from "react";
import BackButton from "./BackButton";
import { Tag, Clock } from "lucide-react";

/**
 * Placeholder — a Balança de Etiqueta (pesa e imprime etiqueta pro produto,
 * ex. Toledo Prix Uno) é um equipamento diferente da Balança Checkout
 * (Toledo 8217, lê peso pro PDV via P05A). Sem modelo/protocolo confirmado
 * ainda, então esta tela só avisa — nenhuma configuração/comunicação real.
 */
export default function EtiquetaTab({ onBack }) {
  return (
    <div className="space-y-5">
      <BackButton onBack={onBack} />

      <div className="flex items-center gap-2">
        <Tag className="w-5 h-5 text-slate-700" />
        <h2 className="text-lg font-semibold text-slate-800">Balança de Etiqueta</h2>
      </div>

      <div className="rounded-xl border border-slate-200 bg-slate-50 p-6 text-center space-y-3">
        <div className="w-12 h-12 mx-auto rounded-full bg-amber-100 flex items-center justify-center">
          <Clock className="w-6 h-6 text-amber-600" />
        </div>
        <p className="text-sm font-medium text-slate-800">
          Configuração em breve
        </p>
        <p className="text-sm text-muted-foreground max-w-sm mx-auto">
          A balança de etiqueta (impressão de etiqueta com peso/preço no produto) será
          configurada em uma próxima atualização. Essa tela é separada da Balança Checkout,
          que já está disponível.
        </p>
      </div>
    </div>
  );
}
