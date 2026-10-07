import React, { useState, useEffect } from "react";
import { Link, useLocation, Outlet, useNavigate } from "react-router-dom";
import { api } from "@/api/dataClient";
import {
  Home,
  ShoppingCart,
  ClipboardList,
  Package,
  Briefcase,
  Users,
  Truck,
  UtensilsCrossed,
  Wallet,
  BarChart3,
  Settings,
  SlidersHorizontal,
  Plug,
  CreditCard,
  FileText,
  Activity,
  Coins,
  ChevronDown,
  Bell,
  LogOut,
  Menu,
  X,
  Shield,
  Database,
  Download,
  RefreshCw,
} from "lucide-react";
import { SyncStatusIndicator } from "@/components/sync/SyncStatusIndicator";
import { useLocalBackup } from "@/hooks/useLocalBackup";
import { cn } from "@/lib/utils";
import { loadTheme } from "@/lib/theme";
import { getCachedAuth } from "@/lib/offlineAuth";
import { getCachedLogo, syncCompanyCache } from "@/lib/companyCache";
import { isTrialExpired } from "@/lib/planAccess";
import { APP_VERSION } from "@/lib/appVersion";
import { lerConfigMesas, EVENTO_CONFIG_MESAS, CARTOES_VISIVEIS } from "@/lib/mesasApi";
import { estadoDeAcessoMesas } from "@/components/mesas/useMesasAcesso";
import RenewalNotice from "@/components/plans/RenewalNotice";
import { Toaster as SonnerToaster } from "sonner";
import NotificationsDialog from "@/components/NotificationsDialog";

const navStructure = [
  { path: "/", label: "Início", icon: Home },
  { path: "/pdv", label: "Venda", icon: ShoppingCart },
  { path: "/caixa", label: "Caixa", icon: Coins },
  { path: "/gerenciador", label: "Gerenciador", icon: ClipboardList },
  { path: "/produtos", label: "Produtos", icon: Package, aliases: ["/importar-xml", "/inventario", "/relatorio-produtos", "/relatorio-compostos"] },
  { path: "/servicos", label: "Serviços", icon: Briefcase },
  { path: "/clientes", label: "Clientes", icon: Users },
  { path: "/delivery", label: "Delivery", icon: Truck },
  { path: "/mesas", label: "Mesas", icon: UtensilsCrossed, opcional: "mesas" },
  { path: "/cartoes", label: "Cartões", icon: CreditCard, opcional: "cartoes" },
  {
    label: "Financeiro",
    icon: Wallet,
    children: [{ path: "/financeiro", label: "Contas", icon: FileText }],
  },
  { path: "/relatorios", label: "Relatórios", icon: BarChart3 },
  {
    label: "Sistema",
    icon: Settings,
    children: [
      { path: "/configuracoes", label: "Configurações", icon: SlidersHorizontal },
      { path: "/sincronizacao", label: "Sincronização", icon: RefreshCw },
      { path: "/integracoes", label: "Integrações", icon: Plug },
      { path: "/baixar", label: "Baixar App", icon: Download },
      { path: "/backup", label: "Backup", icon: Database },
    ],
  },
  {
    label: "Admin",
    icon: Shield,
    adminOnly: true,
    children: [
      { path: "/plano", label: "Planos", icon: CreditCard },
      { path: "/usuarios", label: "Usuários", icon: Users },
      { path: "/log-atividades", label: "Log de Atividades", icon: Activity },
    ],
  },
];

export default function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState(/** @type {Record<string, any>} */ ({}));
  const [user, setUser] = useState(null);
  const [logoUrl, setLogoUrl] = useState(null);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  // Dispara e agenda o backup local automático (Electron) — só precisa estar
  // montado, sem uso do valor de retorno aqui; a tela de Sincronização lê o
  // mesmo hook pra mostrar data/hora do último backup e o botão manual.
  useLocalBackup();
  const location = useLocation();
  const navigate = useNavigate();

  const isAdmin = user?.role === "admin";
  // plan_status/plan_expires_at já vêm da empresa (getEffectivePlanFields
  // prioriza companies.* sobre profiles.*, ver src/lib/companyContext.js) —
  // o aviso de trial é sobre a empresa, não sobre este usuário.
  // platform_admin (conta da própria MercadoFácil, não de uma empresa
  // cliente) nunca é tratado como cliente em trial — mesmo campo que já
  // gateia /empresas e que hasCompany()/isTrialExpired() (planAccess.js) já
  // dão bypass; nenhuma regra nova por e-mail/nome/id.
  const isTrialActive =
    !user?.platform_admin && user?.plan_status === "trial" && !isTrialExpired(user);

  // Mesas e Cartões são opcionais: só aparecem no menu quando ativados em Configurações → Vendas (ou na própria tela).
  const [mesasAtivas, setMesasAtivas] = useState(() => lerConfigMesas().ativo);
  useEffect(() => {
    const sync = () => setMesasAtivas(lerConfigMesas().ativo);
    window.addEventListener(EVENTO_CONFIG_MESAS, sync);
    return () => window.removeEventListener(EVENTO_CONFIG_MESAS, sync);
  }, []);
  const visibleNav = navStructure.filter((item) => (!item.adminOnly || isAdmin) && (!item.opcional || (mesasAtivas && estadoDeAcessoMesas(user).liberadas && (item.opcional !== "cartoes" || CARTOES_VISIVEIS))));

  useEffect(() => {
    loadUser();
    loadTheme();
    const cached = getCachedLogo();
    if (cached) setLogoUrl(cached);
    syncCompanyCache().then(({ logoUrl: remoto }) => setLogoUrl(remoto || null));
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  useEffect(() => {
    if (user && !isAdmin && location.pathname === "/") {
      navigate("/pdv", { replace: true });
    }
  }, [user, isAdmin, location.pathname, navigate]);

  useEffect(() => {
    visibleNav.forEach((item) => {
      if (item.children) {
        const isActive = item.children.some((c) => location.pathname === c.path);
        if (isActive) {
          setExpandedGroups((prev) => ({ ...prev, [item.label]: true }));
        }
      }
    });
    setSidebarOpen(false);
  }, [location.pathname]);

  const loadUser = async () => {
    try {
      const u = await api.auth.me();
      setUser(u);
    } catch {
      // Offline o servidor não responde; sem o usuário em cache o menu cairia
      // para "Caixa" e esconderia telas que o operador tem permissão de usar.
      const cached = await getCachedAuth().catch(() => null);
      if (cached) setUser(cached);
    }
  };

  const handleLogout = async () => {
    await api.auth.logout();
  };

  const toggleGroup = (label) => {
    setExpandedGroups((prev) => ({ ...prev, [label]: !prev[label] }));
  };

  const isItemActive = (item) => {
    if (item.path) return location.pathname === item.path || (item.aliases || []).includes(location.pathname);
    if (item.children) return item.children.some((c) => location.pathname === c.path);
    return false;
  };

  return (
    <div className="min-h-screen bg-background">
      <SonnerToaster richColors position="top-right" />

      {/* Mobile header */}
      <header className="lg:hidden fixed top-0 left-0 right-0 z-30 bg-sidebar h-14 flex items-center px-4">
        <button onClick={() => setSidebarOpen(true)} className="p-2 -ml-2 text-sidebar-foreground">
          <Menu className="w-6 h-6" />
        </button>
        <img src="/brand/mf-icon-256.png" alt="" width="28" height="28" className="ml-2 h-7 w-7 rounded-lg" />
        <span className="font-heading font-bold text-lg ml-2 text-sidebar-foreground">MercadoFácil</span>
      </header>

      {sidebarOpen && (
        <div className="fixed inset-0 z-40 bg-black/50 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          "fixed top-0 left-0 z-50 h-full w-60 bg-sidebar flex flex-col transition-transform lg:translate-x-0",
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="h-16 flex items-center gap-2.5 px-5 border-b border-sidebar-border shrink-0">
          <div className={cn("w-9 h-9 rounded-xl flex items-center justify-center shrink-0 overflow-hidden", logoUrl && "bg-sidebar-primary")}>
            {logoUrl ? (
              <img src={logoUrl} alt="Logo" className="w-full h-full object-contain" />
            ) : (
              <img src="/brand/mf-icon-256.png" alt="MercadoFácil" width="36" height="36" className="w-full h-full object-contain" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-heading font-bold text-sm text-sidebar-foreground leading-tight">MercadoFácil</div>
            <div className="text-xs text-sidebar-foreground/50">Sistema PDV</div>
          </div>
          <button onClick={() => setSidebarOpen(false)} className="lg:hidden p-1 text-sidebar-foreground">
            <X className="w-5 h-5" />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto py-3 px-2">
          {visibleNav.map((item) => {
            const Icon = item.icon;
            const active = isItemActive(item);
            const hasChildren = !!item.children;
            const expanded = expandedGroups[item.label];

            if (hasChildren) {
              return (
                <div key={item.label}>
                  <button
                    onClick={() => toggleGroup(item.label)}
                    className={cn(
                      "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors mb-0.5",
                      active
                        ? "bg-sidebar-accent text-sidebar-accent-foreground"
                        : "text-sidebar-foreground hover:bg-white/5"
                    )}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    <span className="flex-1 text-left">{item.label}</span>
                    <ChevronDown className={cn("w-4 h-4 transition-transform", expanded && "rotate-180")} />
                  </button>
                  {expanded && (
                    <div className="ml-4 mb-1 space-y-0.5">
                      {item.children.map((child) => {
                        const ChildIcon = child.icon;
                        return (
                          <Link
                            key={child.path}
                            to={child.path}
                            className={cn(
                              "flex items-center gap-3 pl-7 pr-3 py-2 rounded-lg text-sm transition-colors",
                              location.pathname === child.path
                                ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                                : "text-sidebar-foreground/60 hover:bg-white/5"
                            )}
                          >
                            {ChildIcon && <ChildIcon className="w-4 h-4 shrink-0" />}
                            {child.label}
                          </Link>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            }

            return (
              <Link
                key={item.path}
                to={item.path}
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors mb-0.5",
                  active
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground hover:bg-white/5"
                )}
              >
                <Icon className="w-4 h-4 shrink-0" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-sidebar-border p-3 space-y-3 shrink-0">
          <SyncStatusIndicator />
          <button
            onClick={() => setNotifOpen(true)}
            className="w-full flex items-center gap-2 text-xs text-sidebar-foreground/50 hover:text-sidebar-foreground transition-colors relative"
          >
            <div className="relative">
              <Bell className="w-4 h-4" />
              {notifications.length > 0 && (
                <span
                  className="absolute -top-1.5 -right-1.5 min-w-4 h-4 px-1 rounded-full text-[10px] font-bold text-white flex items-center justify-center"
                  style={{ background: "#ef4444" }}
                >
                  {notifications.length}
                </span>
              )}
            </div>
            <span>Notificações</span>
          </button>
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-full bg-sidebar-accent/20 flex items-center justify-center shrink-0">
              <span className="text-sm font-semibold text-sidebar-foreground">
                {(user?.full_name || "U").charAt(0).toUpperCase()}
              </span>
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-sidebar-foreground truncate">
                {user?.full_name || "Usuário"}
              </div>
              <div className="text-xs text-sidebar-foreground/50">
                {isAdmin ? "Administrador" : "Caixa"} · v{APP_VERSION}
              </div>
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-sidebar-foreground/70 hover:bg-white/5 hover:text-sidebar-foreground transition-colors"
          >
            <LogOut className="w-4 h-4" />
            Sair
          </button>
        </div>
      </aside>

      {/* Main content */}
      <div className="lg:pl-60">
        <div className="flex flex-col h-screen pt-14 lg:pt-0">
          {/* Aviso de trial: só para quem administra a empresa (mesma regra
              de AdminRoute.jsx/isAdmin) e só enquanto o trial da EMPRESA
              está de fato ativo — antes não checava plan_status/expiração
              nenhuma, então aparecia até com plano pago ou trial encerrado. */}
          {/* Renovação do plano pago (7 dias ou menos / tolerância de 3 dias). */}
          {isAdmin && <RenewalNotice user={user} />}
          {isAdmin && isTrialActive && (
            <div className="bg-primary text-primary-foreground px-4 py-2 flex items-center justify-center gap-4 text-sm shrink-0">
              <span className="hidden sm:inline">Período de teste — experimente todas as funções</span>
              <span className="sm:hidden">Período de teste</span>
              <Link to="/plano" className="border border-primary-foreground/40 rounded-md px-3 py-0.5 text-xs font-medium hover:bg-primary-foreground/10 transition-colors whitespace-nowrap">
                Ativar plano
              </Link>
            </div>
          )}
          <main className="flex-1 overflow-y-auto">
            <Outlet />
          </main>
        </div>
      </div>

      <NotificationsDialog
        open={notifOpen}
        onClose={() => setNotifOpen(false)}
        notifications={notifications}
      />
    </div>
  );
}