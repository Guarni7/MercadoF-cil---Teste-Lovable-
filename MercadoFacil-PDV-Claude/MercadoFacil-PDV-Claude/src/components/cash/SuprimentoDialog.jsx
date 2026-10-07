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
import { ArrowUpCircle, Loader2 } from "lucide-react";
import { formatBRL } from "@/lib/format";
import { logActivity } from "@/lib/activityLog";
import { toast } from "sonner";
import CurrencyInput from "@/components/ui/currency-input";
import { applyCashMovement } from "@/lib/dataLayer";

export default function SuprimentoDialog({ open, onClose, register, onSaved }) {
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
    setSaving(true);
    try {
      if (register?.id) {
        await applyCashMovement(register, { type: "suprimento", amount, reason: reason.trim() });
      }
      await logActivity({
        type: "suprimento",
        description: `Suprimento de ${formatBRL(amount)}${reason.trim() ? ` — ${reason.trim()}` : ""}`,
        severity: "info",
        amount: amount,
        cashRegisterId: register?.id || "",
        details: reason.trim(),
      });
      toast.success(`Suprimento de ${formatBRL(amount)} registrado!`);
      onSaved?.();
      onClose();
    } catch (e) {
      console.error(e);
      toast.error("Erro ao registrar suprimento.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-foreground font-bold">
            <div className="w-8 h-8 rounded-full bg-green-600 flex items-center justify-center shrink-0">
              <ArrowUpCircle className="w-5 h-5 text-white" />
            </div>
            Suprimento
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
            <Label className="mb-1.5 block">Justificativa</Label>
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Ex: Troco inicial, Reforço de caixa..."
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