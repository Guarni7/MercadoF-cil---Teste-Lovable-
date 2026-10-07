/**
 * Teste da regra de acesso por plano (src/lib/planAccess.js): aviso de
 * renovação (7 dias), tolerância de 3 dias após o vencimento e bloqueio
 * depois disso. É lógica pura — o PlanRoute só chama planRouteDecision, então
 * testar a função cobre a decisão real de rota sem precisar de React/DOM.
 *
 * Uso: node scripts/smoke-plan-access.mjs
 */
import { planPhase, hasActivePlan, planRouteDecision, GRACE_DAYS, RENEWAL_WARNING_DAYS } from "../src/lib/planAccess.js";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 15, 12, 0, 0); // instante fixo → teste determinístico
const iso = (ms) => new Date(ms).toISOString();
const ativo = (expMs) => ({ company_id: "c1", plan_status: "active", plan: "mei", plan_expires_at: iso(expMs) });

const casos = [];
const caso = (nome, ok, detalhe) => casos.push({ nome, ok: !!ok, ...(detalhe ? { detalhe } : {}) });

// constantes de negócio
caso("constantes: aviso 7 dias, tolerância 3 dias", RENEWAL_WARNING_DAYS === 7 && GRACE_DAYS === 3);

// a) active vigente
{
  const u = ativo(NOW + 30 * DAY);
  const p = planPhase(u, NOW);
  caso("a) active com 30 dias → sem aviso, acesso liberado", p.phase === "active" && hasActivePlan(u, NOW) && planRouteDecision(u, "/vendas", NOW) === "allow");
}
{
  const u = ativo(NOW + 7 * DAY);
  const p = planPhase(u, NOW);
  caso("7 dias restantes → aviso (renewal_due) + acesso", p.phase === "renewal_due" && p.daysLeft === 7 && planRouteDecision(u, "/vendas", NOW) === "allow", p);
}
{
  const u = ativo(NOW + 7 * DAY + 60 * 60 * 1000);
  caso("7 dias + 1h restantes → ainda sem aviso (conta 8 dias)", planPhase(u, NOW).phase === "active");
}
{
  const u = ativo(NOW + 1 * DAY);
  const p = planPhase(u, NOW);
  caso("1 dia restante → aviso (renewal_due) + acesso", p.phase === "renewal_due" && p.daysLeft === 1 && planRouteDecision(u, "/vendas", NOW) === "allow", p);
}

// b) active dentro da tolerância
{
  const u = ativo(NOW - 1 * DAY);
  const p = planPhase(u, NOW);
  caso("vencido há 1 dia → grace (aviso) + acesso continua", p.phase === "grace" && p.graceDaysLeft === 2 && planRouteDecision(u, "/vendas", NOW) === "allow", p);
}
{
  const u = ativo(NOW - 3 * DAY);
  const p = planPhase(u, NOW);
  caso("vencido há exatamente 3 dias → ainda dentro da tolerância", p.phase === "grace" && planRouteDecision(u, "/vendas", NOW) === "allow", p);
}

// c) active expirado além da tolerância
{
  const u = ativo(NOW - 3 * DAY - 1000);
  const p = planPhase(u, NOW);
  caso("vencido há 3 dias + 1s → expired, PlanRoute bloqueia", p.phase === "expired" && planRouteDecision(u, "/vendas", NOW) === "selecionar-plano", p);
}
{
  const u = ativo(NOW - 10 * DAY);
  caso("vencido há 10 dias → bloqueado", planRouteDecision(u, "/estoque", NOW) === "selecionar-plano");
  caso("bloqueado ainda acessa /plano e /selecionar-plano (renovar)", planRouteDecision(u, "/plano", NOW) === "allow" && planRouteDecision(u, "/selecionar-plano", NOW) === "allow");
}

// d) trial: sem tolerância, comportamento anterior
{
  const vigente = { company_id: "c1", plan_status: "trial", plan_expires_at: iso(NOW + 3 * DAY) };
  caso("d) trial vigente → liberado, sem aviso de renovação", planPhase(vigente, NOW).phase === "trial" && planRouteDecision(vigente, "/vendas", NOW) === "allow");
  const expirado = { company_id: "c1", plan_status: "trial", plan_expires_at: iso(NOW - 1000) };
  caso("trial vencido → bloqueia na hora (sem tolerância)", planPhase(expirado, NOW).phase === "expired" && planRouteDecision(expirado, "/vendas", NOW) === "selecionar-plano");
}

// demais estados
caso("sem plano (none) → bloqueado", planRouteDecision({ company_id: "c1", plan_status: "none" }, "/vendas", NOW) === "selecionar-plano");
caso("sem empresa → /empresa", planRouteDecision({ plan_status: "active", plan_expires_at: iso(NOW + DAY) }, "/vendas", NOW) === "empresa");
caso("platform_admin sempre liberado", planRouteDecision({ platform_admin: true }, "/vendas", NOW) === "allow");
caso("active sem data de validade → liberado, sem aviso", planPhase({ company_id: "c1", plan_status: "active" }, NOW).phase === "active");

const falhas = casos.filter((c) => !c.ok);
console.log(JSON.stringify({ ok: falhas.length === 0, total: casos.length, falhas, casos }, null, 2));
process.exit(falhas.length ? 1 : 0);
