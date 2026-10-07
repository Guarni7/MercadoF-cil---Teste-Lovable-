import React from "react";
import { Link } from "react-router-dom";
import { Phone, Mail, MessageCircle, MapPin, Facebook, Instagram, Youtube } from "lucide-react";
import {
  SUPPORT_PHONE_DISPLAY,
  SUPPORT_TEL_URL,
  SUPPORT_WHATSAPP_URL,
  SUPPORT_EMAIL,
  SUPPORT_EMAIL_DISPLAY,
  SUPPORT_CITY,
} from "@/lib/supportContact";

const sections = [
  {
    title: "Produto",
    links: [
      { label: "Recursos", href: "#recursos" },
      { label: "Planos", href: "#planos" },
      { label: "Ajuda", href: "/ajuda" },
      { label: "Baixar", href: "#baixar" },
    ],
  },
  {
    title: "Conta",
    links: [
      { label: "Entrar", href: "/login" },
      { label: "Criar conta", href: "/register" },
      { label: "Escolher plano", href: "/selecionar-plano" },
    ],
  },
  {
    title: "Legal",
    links: [
      { label: "Central de ajuda", href: "/ajuda" },
      { label: "Termos de uso", href: "/termos" },
      { label: "Política de privacidade", href: "/privacidade" },
    ],
  },
];

const socials = [
  { icon: Facebook, href: "#", label: "Facebook" },
  { icon: Instagram, href: "#", label: "Instagram" },
  { icon: Youtube, href: "#", label: "Youtube" },
];

export default function LandingFooter() {
  return (
    <footer id="contato" className="bg-sidebar text-sidebar-foreground">
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="grid gap-10 lg:grid-cols-12">
          <div className="lg:col-span-4">
            <div className="flex items-center gap-2 font-heading text-lg font-bold text-sidebar-primary">
              <img src="/brand/mf-icon-256.png" alt="" width="36" height="36" className="h-9 w-9 rounded-xl" />
              MercadoFácil PDV
            </div>
            <p className="mt-4 text-sm text-sidebar-foreground/60 max-w-xs">
              Sistema de gestão e ponto de venda para minimercados. Controle estoque, vendas e finanças em um só lugar.
            </p>
            <div className="mt-6 space-y-2.5 text-sm text-sidebar-foreground/70">
              <a href={SUPPORT_TEL_URL} className="flex items-center gap-2.5 hover:text-sidebar-foreground transition-colors">
                <Phone className="h-4 w-4 text-sidebar-primary" />
                {SUPPORT_PHONE_DISPLAY}
              </a>
              {SUPPORT_EMAIL ? (
                <a href={`mailto:${SUPPORT_EMAIL}`} className="flex items-center gap-2.5 hover:text-sidebar-foreground transition-colors">
                  <Mail className="h-4 w-4 text-sidebar-primary" />
                  {SUPPORT_EMAIL}
                </a>
              ) : (
                <div className="flex items-center gap-2.5">
                  <Mail className="h-4 w-4 text-sidebar-primary" />
                  {SUPPORT_EMAIL_DISPLAY}
                </div>
              )}
              <a href={SUPPORT_WHATSAPP_URL} className="flex items-center gap-2.5 hover:text-sidebar-foreground transition-colors">
                <MessageCircle className="h-4 w-4 text-sidebar-primary" />
                WhatsApp: {SUPPORT_PHONE_DISPLAY}
              </a>
              <div className="flex items-center gap-2.5">
                <MapPin className="h-4 w-4 text-sidebar-primary" />
                {SUPPORT_CITY}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-8 sm:grid-cols-3 lg:col-span-8">
            {sections.map((section) => (
              <div key={section.title}>
                <h3 className="font-heading text-sm font-semibold text-sidebar-foreground uppercase tracking-wider">
                  {section.title}
                </h3>
                <ul className="mt-4 space-y-2.5">
                  {section.links.map((link) => (
                    <li key={link.label}>
                      {link.href.startsWith("#") ? (
                        <a href={link.href} className="text-sm text-sidebar-foreground/60 hover:text-sidebar-primary transition-colors">
                          {link.label}
                        </a>
                      ) : (
                        <Link to={link.href} className="text-sm text-sidebar-foreground/60 hover:text-sidebar-primary transition-colors">
                          {link.label}
                        </Link>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-10 flex flex-col items-center justify-between gap-4 border-t border-sidebar-border pt-6 sm:flex-row">
          <p className="text-xs text-sidebar-foreground/50 text-center sm:text-left">
            © {new Date().getFullYear()} MercadoFácil PDV — Todos os direitos reservados.
          </p>
          <div className="flex items-center gap-3">
            {socials.map((s) => {
              const Icon = s.icon;
              return (
                <a
                  key={s.label}
                  href={s.href}
                  aria-label={s.label}
                  className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/5 text-sidebar-foreground/70 hover:bg-sidebar-primary hover:text-sidebar-primary-foreground transition-colors"
                >
                  <Icon className="h-4 w-4" />
                </a>
              );
            })}
          </div>
        </div>
      </div>
    </footer>
  );
}
