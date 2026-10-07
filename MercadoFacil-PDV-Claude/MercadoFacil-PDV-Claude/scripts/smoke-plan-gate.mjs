/**
 * Smoke do gate de plano (sem mocks):
 *  1) usuário novo numa empresa SEM plano → plan_status "none" e startTrial ativa trial
 *  2) usuário novo numa empresa COM plano ativo → herda plano da empresa (não cai no gate)
 *
 * Reproduz a lógica de authMe/startTrial usando a mesma regra de negócio,
 * exercitando RLS com o cliente anônimo autenticado.
 *
 * Uso: node scripts/smoke-plan-gate.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { resolve } from "path";

function loadEnvLocal() {
  const raw = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
  const env = {};
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    )
      v = v.slice(1, -1);
    env[m[1].trim()] = v;
  }
  return env;
}

const env = loadEnvLocal();
const admin = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const stamp = Date.now();

function effectivePlan(profile, company) {
  if (company) {
    return {
      plan: company.plan || profile?.plan,
      plan_status: company.plan_status || profile?.plan_status || "none",
      plan_expires_at: company.plan_expires_at || profile?.plan_expires_at,
    };
  }
  return {
    plan: profile?.plan,
    plan_status: profile?.plan_status || "none",
    plan_expires_at: profile?.plan_expires_at,
  };
}

function hasActivePlan(u) {
  const s = u.plan_status || "none";
  if (s !== "trial" && s !== "active") return false;
  if (u.plan_expires_at) {
    const exp = new Date(u.plan_expires_at).getTime();
    if (Number.isFinite(exp) && exp < Date.now()) return false;
  }
  return true;
}

async function makeUser(companyId, tag) {
  const email = `guarni07+mf.plan.${tag}.${stamp}@gmail.com`;
  const password = `Plan-${stamp}aA1!`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) throw new Error(`createUser(${tag}): ${error.message}`);
  const { error: pErr } = await admin
    .from("profiles")
    .update({ company_id: companyId, role: "admin" })
    .eq("id", data.user.id);
  if (pErr) throw new Error(`profile(${tag}): ${pErr.message}`);

  const client = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error: lErr } = await client.auth.signInWithPassword({ email, password });
  if (lErr) throw new Error(`login(${tag}): ${lErr.message}`);
  return { client, id: data.user.id, email };
}

async function resolveMe(user) {
  const { data: profile } = await user.client
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();
  let company = null;
  if (profile?.company_id) {
    const { data } = await user.client
      .from("companies")
      .select("plan, plan_status, plan_expires_at, trial_started_at")
      .eq("id", profile.company_id)
      .maybeSingle();
    company = data || null;
  }
  return { profile, company, ...effectivePlan(profile, company) };
}

// migration 036 (P1-P3, Security Gate) revogou escrita direta do client em
// plan/plan_status/plan_expires_at/status — só o RPC start_trial (SECURITY
// DEFINER) grava esses campos agora. Reproduz o mesmo caminho que
// src/api/supabaseData.js#startTrial usa de verdade.
async function startTrial(user, plan = "mei") {
  const { data, error } = await user.client.rpc("start_trial", { p_plan: plan }).single();
  if (error) throw new Error(`startTrial: ${error.message}`);
  return data;
}

const report = { ok: false, steps: {} };

// Cenário 1 — empresa sem plano
const { data: freshCompany, error: fcErr } = await admin
  .from("companies")
  .insert({
    trade_name: `Gate sem plano ${stamp}`,
    legal_name: `Gate ${stamp}`,
    plan_status: "none",
  })
  .select()
  .single();
if (fcErr) {
  console.error(JSON.stringify({ ok: false, step: "company_none", error: fcErr.message }));
  process.exit(1);
}
const userNone = await makeUser(freshCompany.id, "none");
const before = await resolveMe(userNone);
report.steps.no_plan_before = {
  plan_status: before.plan_status,
  blocked: !hasActivePlan(before),
};
await startTrial(userNone, "mei");
const after = await resolveMe(userNone);
report.steps.no_plan_after_trial = {
  plan: after.plan,
  plan_status: after.plan_status,
  unblocked: hasActivePlan(after),
};

// Cenário 2 — empresa já com plano ativo (caso dos dados migrados)
const { data: activeCompany, error: acErr } = await admin
  .from("companies")
  .insert({
    trade_name: `Gate com plano ${stamp}`,
    legal_name: `Gate ativo ${stamp}`,
    status: "active",
    plan: "simples",
    plan_status: "active",
  })
  .select()
  .single();
if (acErr) {
  console.error(JSON.stringify({ ok: false, step: "company_active", error: acErr.message }));
  process.exit(1);
}
const userInherit = await makeUser(activeCompany.id, "inherit");
const inherited = await resolveMe(userInherit);
report.steps.inherits_company_plan = {
  profile_plan_status: inherited.profile?.plan_status || "none",
  effective_plan_status: inherited.plan_status,
  effective_plan: inherited.plan,
  unblocked: hasActivePlan(inherited),
};

report.ok =
  report.steps.no_plan_before.blocked === true &&
  report.steps.no_plan_after_trial.unblocked === true &&
  report.steps.no_plan_after_trial.plan_status === "trial" &&
  report.steps.inherits_company_plan.unblocked === true &&
  report.steps.inherits_company_plan.profile_plan_status === "none";

report.note = report.ok
  ? "Gate de plano correto: trial ativa de verdade e membro herda plano da empresa"
  : "Falha no gate de plano";

console.log(JSON.stringify(report, null, 2));
process.exit(report.ok ? 0 : 1);
