import React, { useState } from "react";
import { api } from "@/api/dataClient";
import {
  Dialog,
  DialogContent,
  DialogClose,
  DialogTitle,
} from "@/components/ui/dialog";
import { X, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { mensagemDeErro } from "@/lib/mensagemErro";

export default function InviteDialog({ open, onClose, onInvited }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("user");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!name.trim()) return toast.error("Informe o nome.");
    if (!email.trim()) return toast.error("Informe o e-mail.");
    if (!password || password.length < 8)
      return toast.error("A senha deve ter no mínimo 8 caracteres.");

    setSubmitting(true);
    try {
      await api.users.inviteUser(email.trim(), role, {
        password,
        full_name: name.trim(),
      });
      toast.success("Usuário criado com sucesso!");
      setName("");
      setEmail("");
      setPassword("");
      onInvited?.();
      onClose();
    } catch (e) {
      console.error("Erro ao criar usuário:", e);
      toast.error(mensagemDeErro(e, "criar o usuário"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent
        className="max-w-md p-0 gap-0 border-0 overflow-hidden bg-[#F5B989]"
        style={{ borderRadius: "1rem" }}
      >
        {/* Close button */}
        <DialogClose className="absolute right-4 top-4 z-10 rounded-full p-1 text-[#2D2D2D]/60 hover:text-[#2D2D2D] hover:bg-black/5 transition-colors">
          <X className="w-4 h-4" />
        </DialogClose>

        <div className="px-7 pt-7 pb-6">
          {/* Title */}
          <DialogTitle className="text-xl font-bold text-[#2D2D2D] mb-6">
            Novo Usuário
          </DialogTitle>

          <div className="space-y-4">
            {/* Nome */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-[#2D2D2D]">
                Nome <span className="text-[#2D4B2D]">*</span>
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Nome do usuário"
                className="w-full rounded-lg border-2 border-[#2D4B2D] bg-white/40 px-3 py-2.5 text-sm text-[#2D2D2D] placeholder:text-[#2D2D2D]/40 focus:outline-none focus:border-[#2D4B2D] focus:ring-2 focus:ring-[#2D4B2D]/20 transition-all"
              />
            </div>

            {/* Email */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-[#2D2D2D]">
                Email (login) <span className="text-[#2D4B2D]">*</span>
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="usuario@email.com"
                className="w-full rounded-lg border border-[#2D2D2D]/20 bg-white/40 px-3 py-2.5 text-sm text-[#2D2D2D] placeholder:text-[#2D2D2D]/40 focus:outline-none focus:border-[#2D4B2D] focus:ring-2 focus:ring-[#2D4B2D]/20 transition-all"
              />
            </div>

            {/* Senha */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-[#2D2D2D]">
                Senha <span className="text-[#2D4B2D]">*</span>
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Mínimo 8 caracteres"
                className="w-full rounded-lg border border-[#2D2D2D]/20 bg-white/40 px-3 py-2.5 text-sm text-[#2D2D2D] placeholder:text-[#2D2D2D]/40 focus:outline-none focus:border-[#2D4B2D] focus:ring-2 focus:ring-[#2D4B2D]/20 transition-all"
              />
            </div>
          </div>

          {/* Button */}
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="mt-7 w-full rounded-lg bg-[#7A8268] py-3 text-sm font-semibold text-[#F5B989] hover:bg-[#6B7359] disabled:opacity-60 transition-colors flex items-center justify-center gap-2"
          >
            {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
            {submitting ? "Criando..." : "Criar Usuário"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}