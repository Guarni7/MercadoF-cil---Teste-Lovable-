import React, { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { ArrowDownCircle, Loader2 } from "lucide-react";
import { formatBRL } from "@/lib/format";
import { logActivity } from "@/lib/activityLog";
import { toast } from "sonner";
import CurrencyInput from "@/components/ui/currency-input";
import { applyCashMovement } from "@/lib/dataLayer";

export default function SangriaDialog({ open, onClose, register, onSaved }) {
  const [amount, setAmount] = useState(0);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setAmount(0);
      setReason("");
    }
  }, [open]);

  const handleConfirm = async () => {
    if (amount <= 0) {
      toast.error("Informe um valor válido.");
      return;
    }
    if (!reason.trim()) {
      toast.error("Informe a justificativa da sangria.");
      return;
    }
    setSaving(true);
    try {
      if (register?.id) {
        await applyCashMovement(register, { type: "sangria", amount, reason: reason.trim() });
      }
      await logActivity({
        type: "sangria",
        description: `Sangria de ${formatBRL(amount)} — ${reason.trim()}`,
        severity: "info",
        amount: -amount,
        cashRegisterId: register?.id || "",
        details: reason.trim(),
      });
      toast.success(`Sangria de ${formatBRL(amount)} registrada!`);
      onSaved?.();
      onClose();
    } catch (e) {
      console.error(e);
      toast.error("Erro ao registrar sangria.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-foreground font-bold">
            <div className="w-8 h-8 rounded-full bg-red-500 flex items-center justify-center shrink-0">
              <ArrowDownCircle className="w-5 h-5 text-white" />
            </div>
            Sangria
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label className="mb-1.5 block">Valor</Label>
            <CurrencyInput
              value={amount}
              onChange={setAmount}
              className="text-lg font-semibold border-primary text-primary"
            />
          </div>
          <div>
            <Label className="mb-1.5 block">Justificativa da Sangria</Label>
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Ex: Pagamento fornecedor, Depósito..."
            />
          </div>
        </div>

        <Button
          onClick={handleConfirm}
          disabled={saving}
          className="w-full gap-2"
        >
          {saving && <Loader2 className="w-4 h-4 animate-spin" />}
          Confirmar
        </Button>
      </DialogContent>
    </Dialog>
  );
}