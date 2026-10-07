/**
 * Helpers multi-tenant: empresa do usuário autenticado.
 */
export function getUserCompanyId(user) {
  return user?.company_id || user?.data?.company_id || null;
}

export function isPlatformAdmin(user) {
  return !!(user?.platform_admin || user?.data?.platform_admin);
}

export function withCompanyId(payload, user) {
  const company_id = getUserCompanyId(user);
  if (!company_id) return { ...payload };
  return { ...payload, company_id };
}

/** Plano efetivo: prioriza Company quando existir (via user espelhado). */
export function getEffectivePlanFields(user, company) {
  if (company) {
    return {
      plan: company.plan || user?.plan,
      plan_status: company.plan_status || user?.plan_status || "none",
      plan_expires_at: company.plan_expires_at || user?.plan_expires_at,
      trial_started_at: company.trial_started_at || user?.trial_started_at,
      // Complementos contratados (companies.plan_addons, gravado pela ativação).
      plan_addons: company.plan_addons || [],
    };
  }
  return {
    plan: user?.plan,
    plan_status: user?.plan_status || "none",
    plan_expires_at: user?.plan_expires_at,
    trial_started_at: user?.trial_started_at,
  };
}
