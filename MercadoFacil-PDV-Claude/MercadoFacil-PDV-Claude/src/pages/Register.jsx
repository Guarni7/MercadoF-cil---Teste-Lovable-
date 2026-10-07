import React, { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "@/api/dataClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ImageSlider } from "@/components/ui/image-slider";
import { UserPlus, Mail, Lock, Loader2 } from "lucide-react";
import GoogleIcon from "@/components/GoogleIcon";
import { safeReturnTo } from "@/lib/authReturnTo";

const SLIDER_IMAGES = [
  "/images/login-hero.png",
  "/images/register/market-02.webp",
  // Fotos 3 e 4 são bem mais largas (1672x941) que o painel (vertical) — sem
  // ajustar o ponto focal, o corte central perdia o caixa/atendente de vista.
  { src: "/images/register/market-03.webp", position: "78% center" },
  { src: "/images/register/market-04.webp", position: "78% center" },
];

export default function Register() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [checkEmail, setCheckEmail] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    if (password !== confirmPassword) {
      setError("As senhas não coincidem");
      return;
    }
    if (password.length < 8) {
      setError("A senha deve ter pelo menos 8 caracteres");
      return;
    }
    setLoading(true);
    try {
      const data = await api.auth.register({ email, password });
      // Se o projeto exige confirmação de e-mail, não há sessão imediata
      if (data?.session) {
        window.location.href = "/selecionar-plano";
        return;
      }
      setCheckEmail(true);
    } catch (err) {
      setError(err.message || "Falha no cadastro");
    } finally {
      setLoading(false);
    }
  };

  const handleGoogle = () => {
    api.auth.loginWithProvider("google", "/selecionar-plano");
  };

  const formPanel = checkEmail ? (
    <div className="w-full max-w-md">
      <div className="text-center mb-10">
        <img src="/brand/mercadofacil-logo.png" alt="MercadoFácil PDV" width="1000" height="468" className="mx-auto mb-6 h-24 w-auto" />
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-primary mb-4">
          <Mail className="w-7 h-7 text-primary-foreground" aria-hidden="true" />
        </div>
        <h1 className="text-3xl font-bold tracking-tight text-foreground">Verifique seu e-mail</h1>
        <p className="text-muted-foreground mt-2">{`Enviamos um link de confirmação para ${email}`}</p>
      </div>
      <div className="bg-card rounded-2xl shadow-sm border border-border p-8">
        <p className="text-sm text-muted-foreground text-center">
          Abra o e-mail e confirme a conta. Depois você poderá entrar normalmente.
        </p>
      </div>
      <p className="text-center text-sm text-muted-foreground mt-6">
        <Link to="/login" className="text-primary font-medium hover:underline">
          Voltar para o login
        </Link>
      </p>
    </div>
  ) : (
    <div className="w-full max-w-md">
      <div className="text-center mb-10">
        <img src="/brand/mercadofacil-logo.png" alt="MercadoFácil PDV" width="1000" height="468" className="mx-auto mb-6 h-24 w-auto" />
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-primary mb-4">
          <UserPlus className="w-7 h-7 text-primary-foreground" aria-hidden="true" />
        </div>
        <h1 className="text-3xl font-bold tracking-tight text-foreground">Crie sua conta</h1>
        <p className="text-muted-foreground mt-2">Cadastre-se para começar</p>
      </div>

      <div className="bg-card rounded-2xl shadow-sm border border-border p-8">
        <Button
          variant="outline"
          className="w-full h-12 text-sm font-medium mb-6"
          onClick={handleGoogle}
        >
          <GoogleIcon className="w-5 h-5 mr-2" />
          Continuar com Google
        </Button>

        <div className="relative mb-6">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-border" />
          </div>
          <div className="relative flex justify-center text-xs uppercase">
            <span className="bg-card px-3 text-muted-foreground">ou</span>
          </div>
        </div>

        {error && (
          <div className="mb-4 p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">E-mail</Label>
            <div className="relative">
              <Mail
                className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                id="email"
                type="email"
                autoComplete="email"
                autoFocus
                placeholder="voce@exemplo.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="pl-10 h-12"
                required
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Senha</Label>
            <div className="relative">
              <Lock
                className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                id="password"
                type="password"
                autoComplete="new-password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="pl-10 h-12"
                required
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirm">Confirmar Senha</Label>
            <div className="relative">
              <Lock
                className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground"
                aria-hidden="true"
              />
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
                Criando conta...
              </>
            ) : (
              "Criar conta"
            )}
          </Button>
        </form>
      </div>

      <p className="text-center text-sm text-muted-foreground mt-6">
        Já tem conta?{" "}
        <Link
          to={
            "/login" +
            (safeReturnTo() !== "/" ? "?returnTo=" + encodeURIComponent(safeReturnTo()) : "")
          }
          className="text-primary font-medium hover:underline"
        >
          Entrar
        </Link>
      </p>
    </div>
  );

  return (
    <div className="min-h-screen flex">
      <div className="hidden lg:block lg:w-1/2 relative">
        <ImageSlider images={SLIDER_IMAGES} interval={4000} className="h-screen sticky top-0" />
      </div>
      <div className="w-full lg:w-1/2 flex items-center justify-center bg-background px-4 py-12">
        {formPanel}
      </div>
    </div>
  );
}
