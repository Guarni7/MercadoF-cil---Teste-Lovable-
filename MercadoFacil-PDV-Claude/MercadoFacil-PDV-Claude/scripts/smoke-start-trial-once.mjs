/**
 * Smoke: start_trial() concede o teste grátis UMA vez por empresa
 * (migration 068).
 *
 *  1) empresa sem histórico → primeiro trial funciona (7 dias);
 *  2) segunda chamada com trial vigente → não concede outro nem estende;
 *  3) trial expirado → recusado e nada muda (não renova);
 *  4) plano anterior (pago vencido, expired, canceled) → recusado, sem trial;
 *  5) regressão: plano ativo vigente continua intacto (não rebaixa a trial),
 *     inclusive para um membro cujo profile ainda está "none".
 *
 * Uso: node scripts/smoke-start-trial-once.mjs
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
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    env[m[1].trim()] = v;
  }
  return env;
}

const env = loadEnvLocal();
const admin = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const stamp = Date.now();
const DAY = 24 * 60 * 60 * 1000;

async function makeTenant(tag, companyFields = {}) {
  const { data: company, error: cErr } = await admin
    .from("companies")
    .insert({ trade_name: `Trial once ${tag} ${stamp}`, legal_name: `TO ${tag} ${stamp}`, plan_status: "none", ...companyFields })
    .select()
    .single();
  if (cErr) throw new Error(`company(${tag}): ${cErr.message}`);

  const email = `guarni07+mf.once.${tag}.${stamp}@gmail.com`;
  const password = `Once-${stamp}aA1!`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw new Error(`createUser(${tag}): ${error.message}`);
  const { error: pErr } = await admin
    .from("profiles")
    .update({ company_id: company.id, role: "admin" })
    .eq("id", data.user.id);
  if (pErr) throw new Error(`profile(${tag}): ${pErr.message}`);

  const client = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error: lErr } = await client.auth.signInWithPassword({ email, password });
  if (lErr) throw new Error(`login(${tag}): ${lErr.message}`);
  return { client, companyId: company.id, userId: data.user.id };
}

const startTrial = (t, plan = "mei") => t.client.rpc("start_trial", { p_plan: plan }).single();
const companyState = async (t) =>
  (await admin.from("companies").select("plan,plan_status,plan_expires_at,trial_started_at").eq("id", t.companyId).single()).data;

const report = { ok: false, steps: {} };

// 1) primeiro trial
const t1 = await makeTenant("first");
const { data: first, error: firstErr } = await startTrial(t1, "mei");
const firstDays = first ? (new Date(first.plan_expires_at).getTime() - Date.now()) / DAY : null;
report.steps["1_primeiro_trial"] = {
  erro: firstErr?.message || null,
  plan_status: first?.plan_status,
  dias: firstDays && Math.round(firstDays * 10) / 10,
};
const pass1 = !firstErr && first.plan_status === "trial" && firstDays > 6.9 && firstDays <= 7.01;

// 2) segunda chamada com trial vigente: não concede outro, não estende
const before2 = await companyState(t1);
await new Promise((r) => setTimeout(r, 1200));
const { data: second, error: secondErr } = await startTrial(t1, "simples");
const after2 = await companyState(t1);
report.steps["2_segunda_chamada"] = {
  erro: secondErr?.message || null,
  plan_status: second?.plan_status,
  validade_inalterada: after2.plan_expires_at === before2.plan_expires_at,
  plano_inalterado: after2.plan === before2.plan,
};
const pass2 =
  !secondErr &&
  second.plan_status === "trial" &&
  after2.plan_expires_at === before2.plan_expires_at &&
  after2.plan === before2.plan;

// 3) trial expirado: recusado, nada muda
const past = new Date(Date.now() - 1000).toISOString();
await admin.from("companies").update({ plan_expires_at: past }).eq("id", t1.companyId);
await admin.from("profiles").update({ plan_expires_at: past }).eq("id", t1.userId);
const { error: expiredErr } = await startTrial(t1, "mei");
const afterExpired = await companyState(t1);
report.steps["3_trial_expirado"] = {
  erro: expiredErr?.message || null,
  plan_status: afterExpired.plan_status,
  continua_expirado: new Date(afterExpired.plan_expires_at).getTime() < Date.now(),
};
const pass3 =
  /trial already used/i.test(expiredErr?.message || "") &&
  new Date(afterExpired.plan_expires_at).getTime() < Date.now();

// 4) plano anterior: pago vencido, expired, canceled
const casos = {
  ativo_vencido: { plan: "simples", plan_status: "active", plan_expires_at: past },
  expired: { plan: "mei", plan_status: "expired" },
  canceled: { plan: "mei", plan_status: "canceled" },
};
const r4 = {};
let pass4 = true;
for (const [nome, campos] of Object.entries(casos)) {
  const t = await makeTenant(`prev-${nome}`, campos);
  const { error } = await startTrial(t, "mei");
  const depois = await companyState(t);
  const recusou = /trial already used/i.test(error?.message || "");
  const semMudanca = depois.plan_status === campos.plan_status && depois.plan === campos.plan;
  r4[nome] = { recusou, plano_e_status_inalterados: semMudanca };
  if (!recusou || !semMudanca) pass4 = false;
}
report.steps["4_plano_anterior"] = r4;

// 5) regressão: plano ativo vigente não é rebaixado (nem por membro com profile "none")
const futuro = new Date(Date.now() + 20 * DAY).toISOString();
const t5 = await makeTenant("active", { plan: "simples", plan_status: "active", plan_expires_at: futuro });
const { data: act, error: actErr } = await startTrial(t5, "mei");
const afterAct = await companyState(t5);
report.steps["5_ativo_vigente_intacto"] = {
  erro: actErr?.message || null,
  plan_status_devolvido: act?.plan_status,
  empresa_continua: `${afterAct.plan}/${afterAct.plan_status}`,
  profile_none_nao_rebaixa: afterAct.plan_status === "active",
};
const pass5 = !actErr && act.plan_status === "active" && afterAct.plan === "simples" && afterAct.plan_status === "active";

report.ok = pass1 && pass2 && pass3 && pass4 && pass5;
report.note = report.ok
  ? "start_trial concede trial só uma vez; vencido/plano anterior recusados; ativo vigente intacto"
  : "Falha em algum cenário";
console.log(JSON.stringify(report, null, 2));
process.exit(report.ok ? 0 : 1);
