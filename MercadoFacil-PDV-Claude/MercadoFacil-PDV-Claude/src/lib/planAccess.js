/**
 * Acesso por plano — trial/active e dentro da validade.
 * Exige empresa vinculada (exceto platform_admin e rotas livres).
 *
 * Tudo aqui parte do plan_status/plan_expires_at que vêm do servidor
 * (companies, via authMe) — nunca de localStorage.
 */

export const RENEWAL_WARNING_DAYS = 7;
// Dias de acesso mantido DEPOIS do vencimento de um plano pago (active).
// Não vale para trial: teste vencido bloqueia na hora.
export const GRACE_DAYS = 3;

const DAY_MS = 24 * 60 * 60 * 1000;

function expiresAtMs(user) {
  if (!user?.plan_expires_at) return null;
  const exp = new Date(user.plan_expires_at).getTime();
  return Number.isFinite(exp) ? exp : null;
}

/**
 * Fase do plano em relação ao tempo:
 *  - "trial"       trial vigente
 *  - "active"      plano pago vigente, mais de 7 dias para vencer (ou sem data)
 *  - "renewal_due" plano pago vigente, 7 dias ou menos para vencer
 *  - "grace"       plano pago vencido, ainda dentro dos 3 dias de tolerância
 *  - "expired"     trial vencido, ou plano pago vencido há mais de 3 dias
 *  - "none"        sem plano (none/canceled/suspended/…)
 * `daysLeft`: dias até o vencimento (renewal_due); `graceDaysLeft`: dias de
 * tolerância restantes (grace). Dias contados para cima (ceil).
 */
export function planPhase(user, now = Date.now()) {
  if (!user) return { phase: "none" };
  if (user.platform_admin) return { phase: "active" };

  const status = user.plan_status || "none";
  const exp = expiresAtMs(user);

  if (status === "trial") {
    if (exp !== null && exp <= now) return { phase: "expired" };
    return { phase: "trial" };
  }

  if (status === "active") {
    if (exp === null) return { phase: "active" };
    if (exp > now) {
      const daysLeft = Math.ceil((exp - now) / DAY_MS);
      return daysLeft <= RENEWAL_WARNING_DAYS ? { phase: "renewal_due", daysLeft } : { phase: "active", daysLeft };
    }
    const graceEnd = exp + GRACE_DAYS * DAY_MS;
    if (now <= graceEnd) return { phase: "grace", graceDaysLeft: Math.ceil((graceEnd - now) / DAY_MS) };
    return { phase: "expired" };
  }

  return { phase: "none" };
}

export function hasActivePlan(user, now = Date.now()) {
  if (!user) return false;
  if (user.platform_admin) return true;
  const { phase } = planPhase(user, now);
  return phase === "trial" || phase === "active" || phase === "renewal_due" || phase === "grace";
}

export function hasCompany(user) {
  if (!user) return false;
  if (user.platform_admin) return true;
  return !!(user.company_id || user.data?.company_id);
}

/** Já teve plano/trial (status trial ou active) e o acesso já terminou
 *  (trial vencido, ou plano pago vencido além da tolerância). */
export function isTrialExpired(user, now = Date.now()) {
  if (!user || user.platform_admin) return false;
  return planPhase(user, now).phase === "expired";
}

export function planBlockReason(user, now = Date.now()) {
  if (!user) return "Faça login para continuar.";
  if (!hasCompany(user)) {
    return "Cadastre os dados da sua empresa para formalizar o acesso.";
  }
  const status = user.plan_status || "none";
  if (isTrialExpired(user, now)) {
    return status === "active"
      ? `Seu plano venceu e os ${GRACE_DAYS} dias de tolerância terminaram. Renove para continuar.`
      : "Seu período de teste expirou. Escolha um plano para continuar.";
  }
  if (status === "expired") return "Seu plano expirou. Renove para continuar.";
  if (status === "canceled") return "Seu plano foi cancelado.";
  if (status === "none" || !status) return "Escolha um plano e inicie o teste grátis de 7 dias.";
  return "É necessário um plano ativo para usar o sistema.";
}

export const PLAN_FREE_PATHS = [
  "/selecionar-plano",
  "/plano",
  "/baixar",
  "/empresa",
  "/empresas",
  "/termos",
  "/privacidade",
  "/ajuda",
];

export function isPlanFreePath(pathname) {
  return PLAN_FREE_PATHS.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`)
  );
}

/**
 * Decisão do PlanRoute, isolada pra ser testável sem React:
 * "allow" | "empresa" (sem empresa) | "selecionar-plano" (sem acesso).
 */
export function planRouteDecision(user, pathname, now = Date.now()) {
  if (isPlanFreePath(pathname)) return "allow";
  if (!hasCompany(user)) return "empresa";
  if (!hasActivePlan(user, now)) return "selecionar-plano";
  return "allow";
}
