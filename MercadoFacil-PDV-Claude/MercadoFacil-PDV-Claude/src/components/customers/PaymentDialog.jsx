import React, { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/api/dataClient";
import { formatBRL } from "@/lib/format";
import { logActivity } from "@/lib/activityLog";
import { toast } from "sonner";
import { Loader2, HandCoins } from "lucide-react";

export default function PaymentDialog({ open, onClose, customer, onSaved }) {
  const [amount, setAmount] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open && customer) {
      setAmount((customer.credit_balance || 0).toString());
    }
  }, [customer, open]);

  const handleSave = async () => {
    const value = parseFloat(amount);
    if (!value || value <= 0) {
      toast.error("Informe um valor válido.");
      return;
    }
    if (value > (customer.credit_balance || 0)) {
      toast.error("Valor maior que o saldo devedor.");
      return;
    }
    setSaving(true);
    try {
      const newBalance = (customer.credit_balance || 0) - value;
      await api.entities.Customer.update(customer.id, {
        credit_balance: newBalance,
      });
      await logActivity({
        type: "pagamento_crediario",
        description: `Pagamento de crediário recebido de ${customer.name}`,
        amount: value,
        paymentMethod: "crediario",
        details: `Saldo anterior: ${formatBRL(customer.credit_balance)} | Novo saldo: ${formatBRL(newBalance)}`,
        severity: "info",
      });
      toast.success("Pagamento registrado!");
      onSaved?.();
      onClose();
    } catch (e) {
      console.error(e);
      toast.error("Erro ao registrar pagamento.");
    } finally {
      setSaving(false);
    }
  };

  if (!customer) return null;
  const balance = customer.credit_balance || 0;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <HandCoins className="w-5 h-5 text-emerald-600" /> Receber Pagamento
          </DialogTitle>
          <DialogDescription>Quitação parcial ou total do crediário.</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="p-3 rounded-lg bg-muted/50">
            <div className="text-sm font-medium">{customer.name}</div>
            <div className="flex justify-between mt-1 text-sm">
              <span className="text-muted-foreground">Saldo devedor</span>
              <span className="font-semibold text-amber-600">{formatBRL(balance)}</span>
            </div>
          </div>
          <div>
            <Label>Valor recebido</Label>
            <Input
              type="number"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0,00"
              autoFocus
            />
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              className="flex-1"
              onClick={() => setAmount(balance.toString())}
            >
              Quitar total
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="flex-1"
              onClick={() => {
                const half = balance / 2;
                setAmount(half.toFixed(2));
              }}
            >
              Metade
            </Button>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={saving} className="gap-2">
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            Confirmar Pagamento
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}