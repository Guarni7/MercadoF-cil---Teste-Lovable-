/**
 * Smoke: renovação de plano (migration 069).
 *
 *  1) renovação ANTES do vencimento preserva os dias restantes (+30 sobre o
 *     vencimento atual);
 *  2) renovação DEPOIS do vencimento (inclui a tolerância) soma 30 dias a
 *     partir de agora;
 *  3) segunda ativação da MESMA cobrança não estende;
 *  4) duas cobranças diferentes aprovadas ao mesmo tempo somam as duas
 *     (nenhuma perde dias);
 *  5) primeiro pagamento durante o trial: vira active com 30 dias a partir
 *     de agora (dias do teste não viram crédito);
 *  6) start_trial continua funcionando (empresa sem histórico ganha 7 dias).
 *
 * Uso: node scripts/smoke-plan-renewal.mjs
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
const TOL = 60 * 1000; // 1 min de tolerância entre "agora" do teste e do banco

let seq = 0;
async function makeCompany(tag, fields) {
  const { data, error } = await admin
    .from("companies")
    .insert({ trade_name: `Renewal ${tag} ${stamp}`, legal_name: `RN ${tag} ${stamp}`, plan_status: "none", ...fields })
    .select()
    .single();
  if (error) throw new Error(`company(${tag}): ${error.message}`);
  return data.id;
}
async function seedCharge(companyId) {
  const paymentId = `renew-${stamp}-${++seq}`;
  const { error } = await admin.from("pix_charges").insert({
    company_id: companyId,
    payment_id: paymentId,
    amount: 119.9,
    purpose: "platform",
    plan_id: "mei",
    addon_ids: [],
    status: "pending",
  });
  if (error) throw error;
  return paymentId;
}
const activate = (paymentId) =>
  admin
    .rpc("activate_plan_subscription", { p_payment_id: paymentId, p_mp_status: "approved", p_mp_amount: 119.9 })
    .single();
const expiresOf = async (companyId) =>
  new Date((await admin.from("companies").select("plan_expires_at").eq("id", companyId).single()).data.plan_expires_at).getTime();

const report = { ok: false, steps: {} };

// 1) antes do vencimento: +30 sobre o vencimento atual (10 dias restantes → 40)
const venc1 = Date.now() + 10 * DAY;
const c1 = await makeCompany("early", { plan: "mei", plan_status: "active", plan_expires_at: new Date(venc1).toISOString() });
const { data: r1, error: e1 } = await activate(await seedCharge(c1));
if (e1) throw e1;
const exp1 = await expiresOf(c1);
report.steps["1_renovacao_antes_do_vencimento"] = {
  reason: r1.reason,
  dias_a_partir_de_agora: Math.round(((exp1 - Date.now()) / DAY) * 10) / 10,
  exatamente_vencimento_mais_30d: Math.abs(exp1 - (venc1 + 30 * DAY)) < 1000,
};
const pass1 = r1.reason === "activated" && Math.abs(exp1 - (venc1 + 30 * DAY)) < 1000;

// 2) depois do vencimento (2 dias vencido = dentro da tolerância): +30 a partir de agora
const c2 = await makeCompany("late", { plan: "mei", plan_status: "active", plan_expires_at: new Date(Date.now() - 2 * DAY).toISOString() });
const { data: r2 } = await activate(await seedCharge(c2));
const exp2 = await expiresOf(c2);
report.steps["2_renovacao_apos_vencimento"] = {
  reason: r2.reason,
  dias_a_partir_de_agora: Math.round(((exp2 - Date.now()) / DAY) * 10) / 10,
};
const pass2 = r2.reason === "activated" && Math.abs(exp2 - (Date.now() + 30 * DAY)) < TOL;

// 3) segunda ativação da mesma cobrança não estende
const pagto3 = await seedCharge(await makeCompany("same", { plan: "mei", plan_status: "active", plan_expires_at: new Date(Date.now() + 5 * DAY).toISOString() }));
const c3 = (await admin.from("pix_charges").select("company_id").eq("payment_id", pagto3).single()).data.company_id;
await activate(pagto3);
const antes3 = await expiresOf(c3);
const { data: r3 } = await activate(pagto3);
const depois3 = await expiresOf(c3);
report.steps["3_mesma_cobranca_nao_estende"] = { reason: r3.reason, validade_inalterada: antes3 === depois3 };
const pass3 = r3.reason === "already_activated" && antes3 === depois3;

// 4) duas cobranças diferentes ao mesmo tempo: soma as duas (10 + 30 + 30 = 70 dias)
const venc4 = Date.now() + 10 * DAY;
const c4 = await makeCompany("concurrent", { plan: "mei", plan_status: "active", plan_expires_at: new Date(venc4).toISOString() });
const [pa, pb] = [await seedCharge(c4), await seedCharge(c4)];
const [{ data: r4a }, { data: r4b }] = await Promise.all([activate(pa), activate(pb)]);
const exp4 = await expiresOf(c4);
report.steps["4_duas_cobrancas_simultaneas"] = {
  reasons: [r4a.reason, r4b.reason],
  dias_a_partir_de_agora: Math.round(((exp4 - Date.now()) / DAY) * 10) / 10,
  exatamente_vencimento_mais_60d: Math.abs(exp4 - (venc4 + 60 * DAY)) < 1000,
};
const pass4 = r4a.reason === "activated" && r4b.reason === "activated" && Math.abs(exp4 - (venc4 + 60 * DAY)) < 1000;

// 5) primeiro pagamento durante o trial: 30 dias a partir de agora, sem crédito do teste
const c5 = await makeCompany("trial", { plan: "mei", plan_status: "trial", plan_expires_at: new Date(Date.now() + 5 * DAY).toISOString(), trial_started_at: new Date().toISOString() });
const { data: r5 } = await activate(await seedCharge(c5));
const exp5 = await expiresOf(c5);
const st5 = (await admin.from("companies").select("plan_status").eq("id", c5).single()).data.plan_status;
report.steps["5_pagamento_durante_trial"] = {
  reason: r5.reason,
  plan_status: st5,
  dias_a_partir_de_agora: Math.round(((exp5 - Date.now()) / DAY) * 10) / 10,
};
const pass5 = r5.reason === "activated" && st5 === "active" && Math.abs(exp5 - (Date.now() + 30 * DAY)) < TOL;

// 6) start_trial continua funcionando para empresa sem histórico
const c6 = await makeCompany("fresh", {});
const email = `guarni07+mf.renew.${stamp}@gmail.com`;
const password = `Renew-${stamp}aA1!`;
const { data: u, error: uErr } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
if (uErr) throw uErr;
await admin.from("profiles").update({ company_id: c6, role: "admin" }).eq("id", u.user.id);
const client = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
await client.auth.signInWithPassword({ email, password });
const { data: tr, error: trErr } = await client.rpc("start_trial", { p_plan: "mei" }).single();
const dias6 = tr ? (new Date(tr.plan_expires_at).getTime() - Date.now()) / DAY : null;
report.steps["6_start_trial_intacto"] = { erro: trErr?.message || null, plan_status: tr?.plan_status, dias: dias6 && Math.round(dias6 * 10) / 10 };
const pass6 = !trErr && tr.plan_status === "trial" && dias6 > 6.9 && dias6 <= 7.01;

report.ok = pass1 && pass2 && pass3 && pass4 && pass5 && pass6;
report.note = report.ok
  ? "Renovação soma 30d sobre o maior entre vencimento e agora (só plano active); idempotente; trial e start_trial intactos"
  : "Falha em algum cenário";
console.log(JSON.stringify(report, null, 2));
process.exit(report.ok ? 0 : 1);
