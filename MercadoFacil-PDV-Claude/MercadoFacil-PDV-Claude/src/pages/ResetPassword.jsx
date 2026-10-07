import React, { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { api, supabase } from "@/api/dataClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Lock, Loader2, AlertTriangle } from "lucide-react";
import AuthLayout from "@/components/AuthLayout";

export default function ResetPassword() {
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  // O link do e-mail não traz `?token=`: o Supabase consome os parâmetros da URL
  // e abre uma sessão de recuperação. A tela checava um token que nunca existiu
  // e respondia "Link inválido" para todo mundo.
  const [sessao, setSessao] = useState("verificando");

  useEffect(() => {
    let vivo = true;
    const { data: sub } = supabase.auth.onAuthStateChange((evento) => {
      if (evento === "PASSWORD_RECOVERY" || evento === "SIGNED_IN") setSessao("ok");
    });
    supabase.auth.getSession().then(({ data }) => {
      if (!vivo) return;
      setSessao((atual) => (atual === "ok" ? atual : data?.session ? "ok" : "invalida"));
    });
    return () => {
      vivo = false;
      sub?.subscription?.unsubscribe();
    };
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    if (newPassword !== confirmPassword) {
      setError("As senhas não coincidem");
      return;
    }
    if (newPassword.length < 8) {
      setError("A senha precisa ter pelo menos 8 caracteres");
      return;
    }
    setLoading(true);
    try {
      await api.auth.updatePassword(newPassword);
      await api.auth.logout();
      window.location.href = "/login";
    } catch (err) {
      console.error("Erro ao redefinir senha:", err);
      setError(err.message || "Falha ao redefinir senha");
    } finally {
      setLoading(false);
    }
  };

  if (sessao === "verificando") {
    return (
      <AuthLayout icon={Lock} title="Nova senha" subtitle="Validando o link...">
        <div className="flex justify-center py-6">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      </AuthLayout>
    );
  }

  if (sessao === "invalida") {
    return (
      <AuthLayout
        icon={AlertTriangle}
        title="Link inválido"
        subtitle="Este link de redefinição é inválido ou está incompleto"
        footer={
          <Link to="/forgot-password" className="text-primary font-medium hover:underline">
            Solicitar novo link
          </Link>
        }
      >
        <p className="text-sm text-foreground text-center">
          O link expirou ou já foi usado. Solicite um novo e-mail de redefinição de senha.
        </p>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      icon={Lock}
      title="Nova senha"
      subtitle="Digite sua nova senha abaixo"
    >
      {error && (
        <div className="mb-4 p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
          {error}
        </div>
      )}
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="password">Nova Senha</Label>
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden="true" />
            <Input
              id="password"
              type="password"
              autoComplete="new-password"
              autoFocus
              placeholder="••••••••"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="pl-10 h-12"
              required
            />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="confirm">Confirmar Senha</Label>
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden="true" />
            <Input
              id="confirm"
              type="password"
              autoComplete="new-password"
              placeholder="••••••••"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="pl-10 h-12"
              required
            />
          </div>
        </div>
        <Button type="submit" className="w-full h-12 font-medium" disabled={loading}>
          {loading ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Redefinindo...
            </>
          ) : (
            "Redefinir senha"
          )}
        </Button>
      </form>
    </AuthLayout>
  );
}