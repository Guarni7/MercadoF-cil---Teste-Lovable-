/**
 * Smoke: start_trial() não pode ser usado pra estender o trial indefinidamente.
 *
 * Regressão coberta (migration 065_fix_start_trial_extension):
 *  1) primeira chamada inicia trial normalmente (plan_status "trial", vencimento ~7 dias);
 *  2) segunda chamada durante o trial ainda ativo NÃO reescreve plan_expires_at;
 *  3) trial continua funcionando (usuário segue "trial", não vira "none"/bloqueado).
 *
 * Uso: node scripts/smoke-start-trial-extension.mjs
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

async function makeUser(companyId, tag) {
  const email = `guarni07+mf.trialext.${tag}.${stamp}@gmail.com`;
  const password = `TrialExt-${stamp}aA1!`;
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

async function startTrial(user, plan = "mei") {
  const { data, error } = await user.client.rpc("start_trial", { p_plan: plan }).single();
  if (error) throw new Error(`startTrial: ${error.message}`);
  return data;
}

const report = { ok: false, steps: {} };

const { data: company, error: cErr } = await admin
  .from("companies")
  .insert({
    trade_name: `Trial extension ${stamp}`,
    legal_name: `Trial ext ${stamp}`,
    plan_status: "none",
  })
  .select()
  .single();
if (cErr) {
  console.error(JSON.stringify({ ok: false, step: "company", error: cErr.message }));
  process.exit(1);
}

const user = await makeUser(company.id, "ext");

// 1) primeira chamada inicia trial
const first = await startTrial(user, "mei");
report.steps.first_call = {
  plan_status: first.plan_status,
  plan_expires_at: first.plan_expires_at,
  started_trial: first.plan_status === "trial" && !!first.plan_expires_at,
};

// 2) segunda chamada, ~1s depois, ainda dentro do trial — não deve mudar plan_expires_at
await new Promise((r) => setTimeout(r, 1200));
const second = await startTrial(user, "mei");
report.steps.second_call_during_active_trial = {
  plan_status: second.plan_status,
  plan_expires_at: second.plan_expires_at,
  expires_unchanged: second.plan_expires_at === first.plan_expires_at,
};

// 3) trial continua funcionando (não caiu pra "none"/bloqueado)
const { data: profile } = await user.client
  .from("profiles")
  .select("plan_status, plan_expires_at")
  .eq("id", user.id)
  .maybeSingle();
report.steps.trial_still_active = {
  plan_status: profile?.plan_status,
  still_trial: profile?.plan_status === "trial",
};

report.ok =
  report.steps.first_call.started_trial === true &&
  report.steps.second_call_during_active_trial.expires_unchanged === true &&
  report.steps.trial_still_active.still_trial === true;

report.note = report.ok
  ? "start_trial() não estende mais o vencimento em chamadas repetidas durante trial ativo"
  : "Falha: start_trial() ainda estende plan_expires_at em chamadas repetidas (migration 065 pendente de aplicar?)";

console.log(JSON.stringify(report, null, 2));
process.exit(report.ok ? 0 : 1);
