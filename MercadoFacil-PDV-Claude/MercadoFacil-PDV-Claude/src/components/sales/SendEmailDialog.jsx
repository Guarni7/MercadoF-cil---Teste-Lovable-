import React, { useState } from "react";
import { X, Send, AlertTriangle } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

// Não existe envio de e-mail no sistema (nenhuma Edge Function, provedor ou SMTP para comprovantes;
// o único e-mail real é o de redefinição de senha, do Supabase Auth). Enquanto não houver integração,
// o diálogo diz isso claramente e não oferece ação: nunca simula "enviado".
export const MSG_EMAIL_INDISPONIVEL = "O envio por e-mail ainda não está disponível. Nada será enviado.";

export default function SendEmailDialog({ open, onClose, sale }) {
  const [recipients, setRecipients] = useState("");

  if (!sale) return null;

  const handleClose = () => {
    setRecipients("");
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="max-w-md p-0 overflow-hidden gap-0">
        <div className="px-5 py-4 border-b flex items-center justify-between">
          <h2 className="text-lg font-bold text-[#1f2937]">Enviar por e-mail</h2>
          <button onClick={handleClose} className="text-muted-foreground hover:text-foreground">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="px-5 py-5 space-y-4">
          <div role="status" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 flex gap-2.5">
            <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
            <p>{MSG_EMAIL_INDISPONIVEL}</p>
          </div>
          <div>
            <label className="text-sm text-[#1f2937] block mb-1.5">Destinatário(s)</label>
            <Input
              placeholder="email@exemplo.com"
              value={recipients}
              onChange={(e) => setRecipients(e.target.value)}
              className="border-[#006d77] focus-visible:ring-[#006d77]"
            />
            <p className="text-xs text-muted-foreground mt-1">Separe múltiplos com vírgula</p>
          </div>
          <Button className="w-full gap-2 text-white hover:opacity-90" style={{ background: "#7da7a9" }} disabled>
            <Send className="w-4 h-4" /> Enviar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
