import React, { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog";
import {
  HelpCircle,
  Gauge,
  FileWarning,
  CreditCard,
  GraduationCap,
  MessageSquare,
  ChevronLeft,
  X,
} from "lucide-react";
import { toast } from "sonner";
import TrainingCalendar from "@/components/support/TrainingCalendar";
import HowToResolveScreen from "@/components/support/HowToResolveScreen";
import { duvidaResolveSteps, nfResolveSteps } from "@/components/support/resolveSteps";

const TEAL = "#006769";
const TEAL_SOFT = "#E0EAE9";

const mainOptions = [
  { id: "duvida", label: "Dúvida", desc: "Pergunta ou orientação de uso", icon: HelpCircle },
  { id: "lento", label: "Sistema Lento / Travando", desc: "Performance degradada ou travamento", icon: Gauge },
  { id: "nf", label: "Erro em Nota Fiscal", desc: "NF-e / NFC-e com erro ou rejeição", icon: FileWarning },
  { id: "pagamento", label: "Problema com Pagamento/TEF", desc: "TEF, máquina de cartão ou cobrança errada", icon: CreditCard },
  { id: "treinamento", label: "Solicitar Treinamento", desc: "Agendar uma sessão de treinamento", icon: GraduationCap },
  { id: "outra", label: "Outra", desc: "Descreva o que está acontecendo", icon: MessageSquare },
];

const duvidaOptions = [
  "Cadastro",
  "Importação de XML",
  "PDV (Ponto de Venda)",
  "Devolução (Vestuário)",
  "Cancelamento / Reimpressão",
  "Outra (Descrever)",
];

const nfOptions = [
  { label: "Certificado digital vencido / inválido", desc: "Erro de autenticação ou cert. expirado" },
  { label: "Rejeição da SEFAZ (código de erro)", desc: "SEFAZ retornou um código de rejeição" },
  { label: "SEFAZ fora do ar / timeout", desc: "Serviço da SEFAZ indisponível" },
  { label: "Dados fiscais incorretos (NCM, CFOP...)", desc: "Produto com NCM, CSOSN ou CFOP errado" },
  { label: "Emitente / IE com problema", desc: "CNPJ ou Inscrição Estadual irregular" },
  { label: "Não sei informar", desc: "Não sei identificar o erro" },
];

const tefOptions = [
  { label: "Não está enviando a venda para a Smart", desc: "O sistema não comunica com a maquininha" },
  { label: "Travando na Smart (maquininha)", desc: "A transação trava ou não finaliza na maquininha" },
];

const registerRequest = (data) => {
  try {
    const list = JSON.parse(localStorage.getItem("support_solicitations") || "[]");
    list.push({ ...data, date: new Date().toISOString() });
    localStorage.setItem("support_solicitations", JSON.stringify(list));
  } catch {}
};

function SubHeader({ title, onBack, onClose }) {
  return (
    <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: "#E5E7E6" }}>
      <button type="button" onClick={onBack} className="p-1 rounded-md hover:bg-muted">
        <ChevronLeft className="w-5 h-5" style={{ color: TEAL }} />
      </button>
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: TEAL_SOFT }}>
          <HelpCircle className="w-4 h-4" style={{ color: TEAL }} />
        </div>
        <span className="text-base font-bold" style={{ color: TEAL }}>
          {title}
        </span>
      </div>
      <button type="button" onClick={onClose} className="p-1 rounded-md hover:bg-muted">
        <X className="w-5 h-5" style={{ color: "#6E7A75" }} />
      </button>
    </div>
  );
}

function ListOption({ label, desc, pill, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full flex items-center gap-3 p-3 bg-white border text-left transition-all hover:shadow-sm ${
        pill ? "rounded-full" : "rounded-xl"
      }`}
      style={{ borderColor: "#E5E7E6" }}
    >
      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: TEAL }} />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold" style={{ color: "#1A201C" }}>
          {label}
        </div>
        {desc && <div className="text-xs" style={{ color: "#6E7A75" }}>{desc}</div>}
      </div>
    </button>
  );
}

function TreinamentoScreen({ onBack, onClose, onSubmit }) {
  const [date, setDate] = useState(null);
  const [time, setTime] = useState("08:00");
  return (
    <>
      <SubHeader title="Solicitar Treinamento" onBack={onBack} onClose={onClose} />
      <div className="p-5">
        <p className="text-sm mb-4" style={{ color: "#6E7A75" }}>
          Escolha uma data e horário (Seg–Sex, 08h–18h):
        </p>
        <TrainingCalendar selectedDate={date} onSelect={setDate} />
        <div className="mt-4">
          <label className="text-xs font-medium block mb-1.5" style={{ color: "#6E7A75" }}>Horário</label>
          <select
            value={time}
            onChange={(e) => setTime(e.target.value)}
            className="w-full h-10 rounded-xl border px-3 text-sm bg-white"
            style={{ borderColor: "#E5E7E6" }}
          >
            {Array.from({ length: 11 }, (_, i) => {
              const h = String(i + 8).padStart(2, "0");
              return <option key={h} value={`${h}:00`}>{h}:00</option>;
            })}
          </select>
        </div>
        <button
          type="button"
          disabled={!date}
          onClick={() => onSubmit(date, time)}
          className="w-full mt-4 h-11 rounded-xl text-white text-sm font-semibold disabled:opacity-50"
          style={{ background: "#94B5B2" }}
        >
          Enviar
        </button>
      </div>
    </>
  );
}

function DescribeForm({ title = "Como resolver", subtitle, placeholder, buttonLabel = "Enviar", onSubmit, onBack, onClose }) {
  const [text, setText] = useState("");
  return (
    <>
      <SubHeader title={title} onBack={onBack} onClose={onClose} />
      <div className="p-5">
        <p className="text-sm mb-3" style={{ color: "#505050" }}>{subtitle}</p>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={placeholder}
          rows={5}
          className="w-full rounded-xl p-3 text-sm outline-none resize-none"
          style={{ border: `2px solid ${TEAL}` }}
        />
        <button
          type="button"
          disabled={!text.trim()}
          onClick={() => onSubmit(text.trim())}
          className="w-full mt-4 h-11 rounded-xl text-white text-sm font-semibold disabled:opacity-50"
          style={{ background: "#94B5B2" }}
        >
          {buttonLabel}
        </button>
      </div>
    </>
  );
}

export default function SupportDialog({ open, onClose }) {
  const [screen, setScreen] = useState("main");
  const [resolveData, setResolveData] = useState(null);
  const [describeConfig, setDescribeConfig] = useState(null);

  useEffect(() => {
    if (open) {
      setScreen("main");
      setResolveData(null);
      setDescribeConfig(null);
    }
  }, [open]);

  const finish = (data) => {
    registerRequest(data);
    toast.success("Solicitação registrada! Em breve entraremos em contato.");
    onClose();
  };

  const goMain = () => {
    setScreen("main");
    setResolveData(null);
    setDescribeConfig(null);
  };

  const startResolve = (steps, type, label) => {
    setResolveData({ steps, type, label });
    setDescribeConfig(null);
    setScreen("resolve");
  };

  const startDescribe = (config) => {
    setDescribeConfig(config);
    setScreen("describe");
  };

  const renderMain = () => (
    <>
      <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: "#E5E7E6" }}>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ background: TEAL_SOFT }}>
            <HelpCircle className="w-5 h-5" style={{ color: TEAL }} />
          </div>
          <span className="text-lg font-bold" style={{ color: TEAL }}>Solicitar Suporte</span>
        </div>
        <button type="button" onClick={onClose} className="p-1 rounded-md hover:bg-muted">
          <X className="w-5 h-5" style={{ color: "#6E7A75" }} />
        </button>
      </div>
      <div className="p-5">
        <p className="text-sm mb-4" style={{ color: "#666666" }}>
          Qual é o problema? Escolha o mais próximo:
        </p>
        <div className="space-y-2.5">
          {mainOptions.map((opt) => {
            const Icon = opt.icon;
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => setScreen(opt.id)}
                className="w-full flex items-center gap-3 p-3 rounded-xl text-left transition-all hover:shadow-sm"
                style={{ background: "#F9F9F9" }}
              >
                <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0" style={{ background: TEAL_SOFT }}>
                  <Icon className="w-5 h-5" style={{ color: TEAL }} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-foreground">{opt.label}</div>
                  <div className="text-xs text-muted-foreground">{opt.desc}</div>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </>
  );

  const renderListScreen = (title, subtitle, items, pill, onPick) => (
    <>
      <SubHeader title={title} onBack={goMain} onClose={onClose} />
      <div className="p-5">
        <p className="text-sm mb-4" style={{ color: "#6E7A75" }}>{subtitle}</p>
        <div className="space-y-2.5">
          {items.map((it) => (
            <ListOption
              key={it.label || it}
              label={it.label || it}
              desc={it.desc}
              pill={pill}
              onClick={() => onPick(it.label || it)}
            />
          ))}
        </div>
      </div>
    </>
  );

  const renderResolve = () => (
    <HowToResolveScreen
      steps={resolveData.steps}
      onNeedHelp={() =>
        startDescribe({
          title: "Como resolver",
          subtitle:
            resolveData.type === "nf"
              ? "Descreva o erro que está aparecendo (copie a mensagem se possível):"
              : "Descreva o que está acontecendo:",
          placeholder:
            resolveData.type === "nf"
              ? "Ex: Rejeição 562 — IE do destinatário..."
              : "Descreva brevemente o que está acontecendo...",
          buttonLabel: "Enviar para suporte",
          type: resolveData.type,
          label: resolveData.label,
          back: () => setScreen("resolve"),
        })
      }
      onBack={() => setScreen(resolveData.type === "duvida" ? "duvida" : "nf")}
      onClose={onClose}
    />
  );

  const renderDescribe = () => (
    <DescribeForm
      title={describeConfig.title}
      subtitle={describeConfig.subtitle}
      placeholder={describeConfig.placeholder}
      buttonLabel={describeConfig.buttonLabel}
      onBack={describeConfig.back || goMain}
      onClose={onClose}
      onSubmit={(text) => finish({ type: describeConfig.type, label: describeConfig.label, detail: text })}
    />
  );

  const renderTreinamento = () => (
    <TreinamentoScreen onBack={goMain} onClose={onClose} onSubmit={(d, t) => finish({ type: "treinamento", label: "Solicitar Treinamento", date: d, time: t })} />
  );

  const renderScreen = () => {
    switch (screen) {
      case "duvida":
        return renderListScreen("Qual módulo?", "Sobre qual parte do sistema é a sua dúvida?", duvidaOptions, true, (label) => {
          if (label === "Outra (Descrever)") {
            startDescribe({
              title: "Como resolver",
              subtitle: "Descreva o que está acontecendo:",
              placeholder: "Descreva brevemente o que está acontecendo...",
              buttonLabel: "Enviar",
              type: "duvida",
              label: "Outra (Descrever)",
              back: () => setScreen("duvida"),
            });
          } else {
            startResolve(duvidaResolveSteps[label], "duvida", label);
          }
        });
      case "nf":
        return renderListScreen("Qual o tipo de erro?", "Qual tipo de erro está aparecendo?", nfOptions, false, (label) => {
          if (label === "Não sei informar") {
            startDescribe({
              title: "Como resolver",
              subtitle: "Descreva o erro que está aparecendo (copie a mensagem se possível):",
              placeholder: "Ex: Rejeição 562 — IE do destinatário...",
              buttonLabel: "Enviar para suporte",
              type: "nf",
              label: "Não sei informar",
              back: () => setScreen("nf"),
            });
          } else {
            startResolve(nfResolveSteps[label], "nf", label);
          }
        });
      case "resolve":
        return renderResolve();
      case "describe":
        return renderDescribe();
      case "pagamento":
        return renderListScreen("Problema com TEF", "Qual é o problema com o TEF / cartão?", tefOptions, false, (label) =>
          finish({ type: "pagamento", label })
        );
      case "treinamento":
        return renderTreinamento();
      case "lento":
        return (
          <DescribeForm
            title="Sistema Lento / Travando"
            subtitle="Descreva o que está acontecendo"
            placeholder="Descreva brevemente o que está acontecendo..."
            onBack={goMain}
            onClose={onClose}
            onSubmit={(text) => finish({ type: "lento", label: "Sistema Lento / Travando", detail: text })}
          />
        );
      case "outra":
        return (
          <DescribeForm
            title="Outra"
            subtitle="Descreva o que está acontecendo"
            placeholder="Descreva brevemente o que está acontecendo..."
            onBack={goMain}
            onClose={onClose}
            onSubmit={(text) => finish({ type: "outra", label: "Outra", detail: text })}
          />
        );
      default:
        return renderMain();
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md p-0 gap-0 overflow-hidden [&>button]:hidden">
        {renderScreen()}
      </DialogContent>
    </Dialog>
  );
}