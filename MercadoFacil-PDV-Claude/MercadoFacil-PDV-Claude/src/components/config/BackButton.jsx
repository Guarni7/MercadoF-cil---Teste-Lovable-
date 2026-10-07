import React from "react";
import { ArrowLeft } from "lucide-react";

export default function BackButton({ onBack, className = "" }) {
  return (
    <button
      onClick={onBack}
      className={`flex items-center gap-1.5 text-sm font-medium text-slate-700 hover:text-slate-900 transition-colors ${className}`}
    >
      <ArrowLeft className="w-4 h-4" />
      Voltar
    </button>
  );
}