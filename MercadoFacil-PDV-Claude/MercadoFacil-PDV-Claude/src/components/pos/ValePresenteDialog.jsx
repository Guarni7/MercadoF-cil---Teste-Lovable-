import React, { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Gift } from "lucide-react";

export default function ValePresenteDialog({ open, onClose, onApply }) {
  const [code, setCode] = useState("");

  useEffect(() => {
    if (open) setCode("");
  }, [open]);

  const handleApply = () => {
    if (!code.trim()) return;
    onApply?.(code.trim().toUpperCase());
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md p-0 gap-0 overflow-hidden">
        <DialogHeader className="p-4 border-b flex flex-row items-center gap-2.5 space-y-0">
          <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
            <Gift className="w-4 h-4 text-primary" />
          </div>
          <DialogTitle className="text-base font-bold">Vale Presente</DialogTitle>
        </DialogHeader>

        <div className="p-4 space-y-4">
          <p className="text-sm text-muted-foreground">
            Digite o código de 6 caracteres ou leia o código de barras. O vale é usado sempre pelo valor integral.
          </p>
          <Input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="EX: A7K9M2"
            className="rounded-full border-primary text-center text-lg font-semibold tracking-widest h-12"
            autoFocus
          />
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose} className="flex-1">
              Cancelar
            </Button>
            <Button onClick={handleApply} className="flex-1">
              Aplicar integral
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}