import React, { useState } from "react";
import { Eye, EyeOff } from "lucide-react";

const GoogleIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 48 48">
    <path fill="#FFC107" d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s12-5.373 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-2.641-.21-5.236-.611-7.743z" />
    <path fill="#FF3D00" d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z" />
    <path fill="#4CAF50" d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238C29.211 35.091 26.715 36 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z" />
    <path fill="#1976D2" d="M43.611 20.083H42V20H24v8h11.303c-.792 2.237-2.231 4.166-4.087 5.571l6.19 5.238C42.022 35.026 44 30.038 44 24c0-2.641-.21-5.236-.611-7.743z" />
  </svg>
);

const GlassInputWrapper = ({ children }) => (
  <div className="rounded-2xl border border-border bg-foreground/5 backdrop-blur-sm transition-colors focus-within:border-violet-400/70 focus-within:bg-violet-500/10">
    {children}
  </div>
);

// Cartão claro translúcido — usado tanto sobre a foto do hero (desktop)
// quanto solto no fundo da página (mobile). A versão escura anterior ficava
// pesada demais nos dois contextos.
const TestimonialCard = ({ testimonial, delay }) => (
  <div
    className={`animate-testimonial ${delay} flex items-start gap-3 rounded-3xl p-5 w-64 shrink-0 bg-white/90 backdrop-blur-xl border border-black/10 shadow-lg`}
  >
    <img
      src={testimonial.avatarSrc}
      className="h-10 w-10 object-cover rounded-full shrink-0 ring-2 ring-black/10"
      alt="avatar"
    />
    <div className="text-sm leading-snug min-w-0">
      <p className="flex items-center gap-1 font-medium text-stone-900">{testimonial.name}</p>
      <p className="truncate text-stone-500">{testimonial.handle}</p>
      <p className="mt-1 break-words text-stone-700">{testimonial.text}</p>
    </div>
  </div>
);

export function SignInPage({
  title = <span className="font-light text-foreground tracking-tighter">Bem-vindo</span>,
  description = "Acesse sua conta e continue sua jornada conosco",
  heroImageSrc,
  testimonials = [],
  onSignIn,
  onGoogleSignIn,
  onResetPassword,
  onCreateAccount,
  onDemoSignIn,
  error,
  loading,
}) {
  const [showPassword, setShowPassword] = useState(false);

  return (
    <div className="h-[100dvh] flex flex-col md:flex-row font-geist w-[100dvw]">
      {/* Left column: sign-in form */}
      <section className="flex-1 flex items-center justify-center p-8">
        <div className="w-full max-w-md">
          <div className="flex flex-col gap-6">
            <img src="/brand/mercadofacil-logo.png" alt="MercadoFácil PDV" width="1000" height="468" className="animate-element h-24 w-auto self-start" />
            <h1 className="animate-element animate-delay-100 text-4xl md:text-5xl font-semibold leading-tight">{title}</h1>
            <p className="animate-element animate-delay-200 text-muted-foreground">{description}</p>

            {error && (
              <div className="p-3 rounded-xl bg-destructive/10 text-destructive text-sm">
                {error}
              </div>
            )}

            <form className="space-y-5" onSubmit={onSignIn}>
              <div className="animate-element animate-delay-300">
                <label className="text-sm font-medium text-muted-foreground">E-mail</label>
                <GlassInputWrapper>
                  <input name="email" type="text" inputMode="email" autoComplete="username" placeholder="Digite seu e-mail" className="w-full bg-transparent text-sm p-4 rounded-2xl focus:outline-none" />
                </GlassInputWrapper>
              </div>

              <div className="animate-element animate-delay-400">
                <label className="text-sm font-medium text-muted-foreground">Senha</label>
                <GlassInputWrapper>
                  <div className="relative">
                    <input name="password" type={showPassword ? 'text' : 'password'} placeholder="Digite sua senha" className="w-full bg-transparent text-sm p-4 pr-12 rounded-2xl focus:outline-none" />
                    <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute inset-y-0 right-3 flex items-center">
                      {showPassword ? <EyeOff className="w-5 h-5 text-muted-foreground hover:text-foreground transition-colors" /> : <Eye className="w-5 h-5 text-muted-foreground hover:text-foreground transition-colors" />}
                    </button>
                  </div>
                </GlassInputWrapper>
              </div>

              <div className="animate-element animate-delay-500 flex items-center justify-between text-sm">
                <label className="flex items-center gap-3 cursor-pointer">
                  <input type="checkbox" name="rememberMe" className="custom-checkbox" />
                  <span className="text-foreground/90">Manter-me conectado</span>
                </label>
                <a href="#" onClick={(e) => { e.preventDefault(); onResetPassword?.(); }} className="hover:underline text-violet-400 transition-colors">Esqueceu a senha?</a>
              </div>

              <button type="submit" disabled={loading} className="animate-element animate-delay-600 w-full rounded-2xl bg-primary py-4 font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50">
                {loading ? "Entrando..." : "Entrar"}
              </button>
            </form>

            {onDemoSignIn && (
              <button
                type="button"
                onClick={onDemoSignIn}
                disabled={loading}
                className="animate-element animate-delay-650 w-full rounded-2xl border border-border py-3 text-sm text-muted-foreground hover:bg-secondary transition-colors disabled:opacity-50"
              >
                Sessão de teste (admin)
              </button>
            )}

            <div className="animate-element animate-delay-700 relative flex items-center justify-center">
              <span className="w-full border-t border-border"></span>
              <span className="px-4 text-sm text-muted-foreground bg-slate-50 absolute">Ou continue com</span>
            </div>

            <button onClick={onGoogleSignIn} disabled={loading} className="animate-element animate-delay-800 w-full flex items-center justify-center gap-3 border border-border rounded-2xl py-4 hover:bg-secondary transition-colors disabled:opacity-50">
              <GoogleIcon />
              Continuar com Google
            </button>

            <p className="animate-element animate-delay-900 text-center text-sm text-muted-foreground">
              Não tem conta? <a href="#" onClick={(e) => { e.preventDefault(); onCreateAccount?.(); }} className="text-violet-400 hover:underline transition-colors">Criar conta</a>
            </p>
          </div>
        </div>
      </section>

      {/* Right column: hero image + testimonials (desktop) */}
      {heroImageSrc && (
        <section className="hidden md:block flex-1 relative p-4 bg-slate-50">
          <div
            className="animate-slide-right animate-delay-300 absolute inset-4 rounded-3xl bg-slate-200 bg-cover bg-center overflow-hidden"
            style={{ backgroundImage: `linear-gradient(to top, rgba(15,23,42,0.35), transparent 45%), url(${heroImageSrc})` }}
          />
          {testimonials.length > 0 && (
            <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex gap-4 px-8 w-full justify-center">
              <TestimonialCard testimonial={testimonials[0]} delay="animate-delay-1000" />
              {testimonials[1] && <div className="hidden lg:flex"><TestimonialCard testimonial={testimonials[1]} delay="animate-delay-1200" /></div>}
              {testimonials[2] && <div className="hidden xl:flex"><TestimonialCard testimonial={testimonials[2]} delay="animate-delay-1400" /></div>}
            </div>
          )}
        </section>
      )}

      {/* Testimonials (mobile) */}
      {testimonials.length > 0 && (
        <section className="md:hidden px-6 pb-8">
          <div className="flex gap-4 overflow-x-auto pb-2 -mx-6 px-6 snap-x">
            {testimonials.map((t, i) => (
              <TestimonialCard key={t.name} testimonial={t} delay={`animate-delay-${800 + i * 100}`} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}