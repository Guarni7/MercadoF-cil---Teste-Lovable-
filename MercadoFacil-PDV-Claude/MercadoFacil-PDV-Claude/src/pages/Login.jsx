import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api } from "@/api/dataClient";
import { supabase } from "@/lib/supabase";
import { isOfflineError } from "@/api/supabaseData";
import { SignInPage } from "@/components/ui/sign-in";
import { safeReturnTo } from "@/lib/authReturnTo";
import { isDemoCredentials, isDemoEmail, startDemoSession } from "@/lib/demoAccount";

const testimonials = [
  {
    avatarSrc: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=100&h=100&fit=crop",
    name: "Carlos Mendes",
    handle: "@mercadomendes",
    text: "O MercadoFácil transformou meu minimercado. Controlo estoque e vendas em tempo real.",
  },
  {
    avatarSrc: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=100&h=100&fit=crop",
    name: "Ana Paula Silva",
    handle: "@supermercadosilva",
    text: "Sistema prático e rápido. O PDV agilizou muito o atendimento aos clientes.",
  },
  {
    avatarSrc: "https://images.unsplash.com/photo-1633332755192-727a05c4013d?w=100&h=100&fit=crop",
    name: "Roberto Oliveira",
    handle: "@mercadoroberto",
    text: "Os relatórios financeiros me ajudam a tomar decisões melhores para o negócio.",
  },
];

async function goDemo() {
  await startDemoSession();
  window.location.replace("/pdv");
}

export default function Login() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // Só admin: /login?mf_demo=1 — não aparece para o público
  const showAdminDemo = useMemo(
    () => searchParams.get("mf_demo") === "1",
    [searchParams]
  );

  // Retorno OAuth Google (hash #access_token=... ou ?code=)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (cancelled || !data?.session) return;

      // Sessão armazenada pode estar revogada (usuário removido, senha trocada
      // em outro dispositivo). Sem validar no servidor o app entraria em loop
      // login → área logada → landing, sem conseguir voltar ao login.
      const { error: sessionError } = await supabase.auth.getUser();
      if (cancelled) return;
      // Sem rede não dá para validar: mantém a sessão e deixa o app abrir com os
      // dados locais — descartar aqui tiraria o PDV do ar durante uma queda.
      if (sessionError && !isOfflineError(sessionError)) {
        await supabase.auth.signOut().catch(() => {});
        return;
      }

      let dest = safeReturnTo();
      try {
        const stored = sessionStorage.getItem("mf_return_to");
        if (stored) {
          sessionStorage.removeItem("mf_return_to");
          const u = new URL(stored);
          if (u.origin === window.location.origin) dest = u.pathname + u.search;
        }
      } catch {
        /* ignore */
      }
      window.location.replace(dest || "/");
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const enterDemo = async () => {
    setError("");
    setLoading(true);
    try {
      await goDemo();
    } catch (err) {
      setError(err?.message || "Falha ao abrir sessão de teste");
      setLoading(false);
    }
  };

  const handleSignIn = async (event) => {
    event.preventDefault();
    setError("");
    setLoading(true);
    const formData = new FormData(event.currentTarget);
    const email = String(formData.get("email") || "");
    const password = String(formData.get("password") || "");
    try {
      if (isDemoEmail(email)) {
        if (!isDemoCredentials(email, password)) {
          setError("E-mail ou senha inválidos");
          return;
        }
        await goDemo();
        return;
      }
      await api.auth.loginViaEmailPassword(email.trim(), password);
      window.location.href = safeReturnTo();
    } catch (err) {
      setError(err?.message || "E-mail ou senha inválidos");
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignIn = () => {
    api.auth.loginWithProvider("google", safeReturnTo());
  };

  const handleResetPassword = () => {
    navigate("/forgot-password");
  };

  const handleCreateAccount = () => {
    const returnTo = safeReturnTo();
    navigate("/register" + (returnTo !== "/" ? "?returnTo=" + encodeURIComponent(returnTo) : ""));
  };

  return (
    <div className="bg-slate-50 min-h-screen">
      <SignInPage
        title={<span className="font-light text-foreground tracking-tighter">Bem-vindo de volta</span>}
        description="Acesse sua conta e continue gerenciando seu minimercado"
        heroImageSrc="/images/login-hero.png"
        testimonials={testimonials}
        onSignIn={handleSignIn}
        onGoogleSignIn={handleGoogleSignIn}
        onResetPassword={handleResetPassword}
        onCreateAccount={handleCreateAccount}
        onDemoSignIn={showAdminDemo ? enterDemo : undefined}
        error={error}
        loading={loading}
      />
    </div>
  );
}
