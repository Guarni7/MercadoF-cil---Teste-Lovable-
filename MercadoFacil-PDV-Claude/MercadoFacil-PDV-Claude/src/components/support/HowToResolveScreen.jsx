import React from "react";
import { ChevronLeft, X, HelpCircle } from "lucide-react";

const TEAL = "#006769";
const TEAL_SOFT = "#E0EAE9";
const CIRCLE_BG = "#a8d5c4";
const CIRCLE_TEXT = "#2a7e6b";

function RichText({ text }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <strong key={i} className="font-semibold text-black">
          {part.slice(2, -2)}
        </strong>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

export default function HowToResolveScreen({ steps, onNeedHelp, onBack, onClose }) {
  return (
    <>
      <div
        className="flex items-center justify-between px-4 py-3 border-b"
        style={{ borderColor: "#E5E7E6" }}
      >
        <button type="button" onClick={onBack} className="p-1 rounded-md hover:bg-muted">
          <ChevronLeft className="w-5 h-5" style={{ color: TEAL }} />
        </button>
        <div className="flex items-center gap-2">
          <div
            className="w-8 h-8 rounded-full flex items-center justify-center"
            style={{ background: TEAL_SOFT }}
          >
            <HelpCircle className="w-4 h-4" style={{ color: TEAL }} />
          </div>
          <span className="text-base font-bold" style={{ color: TEAL }}>
            Como resolver
          </span>
        </div>
        <button type="button" onClick={onClose} className="p-1 rounded-md hover:bg-muted">
          <X className="w-5 h-5" style={{ color: "#6E7A75" }} />
        </button>
      </div>
      <div className="p-5">
        <ol className="space-y-4">
          {steps.map((step, i) => (
            <li key={i} className="flex gap-3">
              <span
                className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-sm font-semibold"
                style={{ background: CIRCLE_BG, color: CIRCLE_TEXT }}
              >
                {i + 1}
              </span>
              <div className="text-sm pt-0.5 leading-relaxed" style={{ color: "#333333" }}>
                <RichText text={step.text} />
                {step.subItems && (
                  <ul className="mt-1.5 space-y-1">
                    {step.subItems.map((s, j) => (
                      <li key={j} className="flex gap-2">
                        <span
                          className="w-1.5 h-1.5 rounded-full mt-1.5 shrink-0"
                          style={{ background: TEAL }}
                        />
                        <span>{s}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </li>
          ))}
        </ol>
        <div className="mt-6 text-center">
          <p className="text-sm mb-3" style={{ color: "#888888" }}>
            Os passos não resolveram?
          </p>
          <button
            type="button"
            onClick={onNeedHelp}
            className="w-full h-11 rounded-full border text-sm font-medium transition-colors hover:bg-muted/50"
            style={{ borderColor: CIRCLE_BG, color: CIRCLE_TEXT }}
          >
            Ainda preciso de ajuda →
          </button>
        </div>
      </div>
    </>
  );
}