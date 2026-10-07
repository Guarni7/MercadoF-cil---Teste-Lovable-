import React, { useState, useEffect } from "react";
import { Landmark } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import BackButton from "./BackButton";

export default function FinanceiroSection({ onBack }) {
  const [lateFee, setLateFee] = useState(0);
  const [dailyFee, setDailyFee] = useState(0);
  const [lateType, setLateType] = useState("percent");
  const [dailyType, setDailyType] = useState("percent");

  useEffect(() => {
    try {
      const saved = localStorage.getItem("financeiro_config");
      if (saved) {
        const cfg = JSON.parse(saved);
        setLateFee(cfg.late_fee || 0);
        setDailyFee(cfg.daily_fee || 0);
        setLateType(cfg.late_type || "percent");
        setDailyType(cfg.daily_type || "percent");
      }
    } catch {}
  }, []);

  function handleSave() {
    localStorage.setItem("financeiro_config", JSON.stringify({
      late_fee: lateFee, daily_fee: dailyFee, late_type: lateType, daily_type: dailyType,
    }));
    toast.success("Configurações financeiras salvas!");
  }

  return (
    <div className="space-y-5">
      <BackButton onBack={onBack} />

      <div className="flex items-center gap-2">
        <Landmark className="w-5 h-5 text-slate-700" />
        <h2 className="text-lg font-semibold text-slate-800">Financeiro</h2>
      </div>

      <p className="text-sm text-slate-500 max-w-2xl">
        Configure juros e mora que serão aplicados automaticamente nas parcelas vencidas de Crediário e Caderno.
      </p>

      <div className="space-y-6 max-w-xl">
        <div>
          <label className="text-sm font-medium text-slate-800">Juros por atraso</label>
          <p className="text-xs text-slate-500 mb-2">Valor cobrado uma única vez sobre a parcela vencida.</p>
          <div className="flex gap-2">
            <Input
              type="number"
              value={lateFee}
              onChange={(e) => setLateFee(parseFloat(e.target.value) || 0)}
              className="flex-1"
            />
            <Select value={lateType} onValueChange={setLateType}>
              <SelectTrigger className="w-36 rounded-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="percent">Percentual</SelectItem>
                <SelectItem value="fixed">Valor fixo</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div>
          <label className="text-sm font-medium text-slate-800">Mora diária</label>
          <p className="text-xs text-slate-500 mb-2">Valor cobrado por cada dia de atraso após o vencimento.</p>
          <div className="flex gap-2">
            <Input
              type="number"
              value={dailyFee}
              onChange={(e) => setDailyFee(parseFloat(e.target.value) || 0)}
              className="flex-1"
            />
            <Select value={dailyType} onValueChange={setDailyType}>
              <SelectTrigger className="w-36 rounded-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="percent">Percentual</SelectItem>
                <SelectItem value="fixed">Valor fixo</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <Button onClick={handleSave} className="gap-2">
          Salvar Configurações
        </Button>
      </div>
    </div>
  );
}