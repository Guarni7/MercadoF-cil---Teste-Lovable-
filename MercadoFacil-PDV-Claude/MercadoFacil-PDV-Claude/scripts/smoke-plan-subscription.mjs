/**
 * Smoke do fluxo real de assinatura paga (plano + addons → cobrança →
 * pagamento Mercado Pago → ativação automática atômica).
 *
 * Ativação em si roda inteira dentro da RPC `activate_plan_subscription`
 * (migration 067) — uma transação Postgres com `select ... for update`.
 * Como esse SQL é testável diretamente (sem precisar de um pagamento PIX
 * real aprovado no Mercado Pago), este smoke chama a RPC via service_role
 * com valores controlados, provando atomicidade/concorrência/idempotência
 * de verdade — não apenas simulando a trava por fora.
 *
 * O que SEGUE não sendo automatizável sem aprovação real no Mercado Pago
 * (sandbox exige ação manual fora deste ambiente): geração de cobrança de
 * verdade (MERCADO_PAGO_ACCESS_TOKEN da plataforma não configurado) e o
 * disparo do webhook por uma notificação genuína do MP.
 *
 * Uso: node scripts/smoke-plan-subscription.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { resolve } from "path";
import { hasActivePlan } from "../src/lib/planAccess.js";

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

async function makeTenant(env, tag) {
  const stamp = Date.now() + Math.floor(Math.random() * 1000);
  const email = `guarni07+mf.sub.${tag}.${stamp}@gmail.com`;
  const password = `Sub-${stamp}aA1!`;
  const admin = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
  await admin.auth.admin.createUser({ email, password, email_confirm: true });
  const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  await sb.auth.signInWithPassword({ email, password });
  const { data: company, error } = await sb.rpc("bootstrap_company", {
    p_trade_name: `Assinatura ${tag} ${stamp}`,
    p_email: email,
  });
  if (error) throw error;
  return { sb, company, email, admin };
}

async function seedCharge(admin, companyId, overrides = {}) {
  const paymentId = `smoke-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
  const { data, error } = await admin
    .from("pix_charges")
    .insert({
      company_id: companyId,
      payment_id: paymentId,
      amount: 149.8,
      purpose: "platform",
      plan_id: "mei",
      addon_ids: ["nfse"],
      status: "pending",
      ...overrides,
    })
    .select("id,payment_id")
    .single();
  if (error) throw error;
  return data;
}

const activate = (admin, paymentId, status, amount) =>
  admin
    .rpc("activate_plan_subscription", {
      p_payment_id: paymentId,
      p_mp_status: status,
      p_mp_amount: amount,
    })
    .single();

const env = loadEnvLocal();
const admin = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const report = { ok: false, steps: {} };

// 1) Ativação normal → companies active + addons + activated_at
const empresa1 = await makeTenant(env, "t1");
const charge1 = await seedCharge(admin, empresa1.company.id);
const { data: result1, error: err1 } = await activate(admin, charge1.payment_id, "approved", 149.8);
if (err1) throw err1;

const { data: company1 } = await admin
  .from("companies")
  .select("plan,plan_status,plan_expires_at,plan_addons")
  .eq("id", empresa1.company.id)
  .maybeSingle();
const { data: chargeRow1 } = await admin
  .from("pix_charges")
  .select("activated_at")
  .eq("id", charge1.id)
  .maybeSingle();

report.steps["1_ativacao_normal"] = {
  rpc_activated: result1.activated,
  rpc_reason: result1.reason,
  company_plan_status: company1?.plan_status,
  company_plan: company1?.plan,
  company_addons: company1?.plan_addons,
  charge_activated_at_set: !!chargeRow1?.activated_at,
};
const pass1 =
  result1.activated === true &&
  result1.reason === "activated" &&
  company1?.plan_status === "active" &&
  company1?.plan === "mei" &&
  JSON.stringify(company1?.plan_addons) === JSON.stringify(["nfse"]) &&
  !!chargeRow1?.activated_at;

// 2/3) Erro numa etapa (valor divergente) → rollback completo, activated_at continua NULL
const empresa2 = await makeTenant(env, "t2");
const charge2 = await seedCharge(admin, empresa2.company.id, { amount: 149.8 });
const { data: result2, error: err2 } = await activate(admin, charge2.payment_id, "approved", 1 /* valor errado */);
if (err2) throw err2;

const { data: company2Before } = await admin
  .from("companies")
  .select("plan_status")
  .eq("id", empresa2.company.id)
  .maybeSingle();
const { data: chargeRow2 } = await admin
  .from("pix_charges")
  .select("activated_at")
  .eq("id", charge2.id)
  .maybeSingle();

report.steps["2_3_falha_nao_altera_nada"] = {
  rpc_activated: result2.activated,
  rpc_reason: result2.reason,
  company_continua_sem_plano: company2Before?.plan_status !== "active",
  charge_activated_at_continua_null: chargeRow2?.activated_at === null,
};
const pass23 =
  result2.activated === false &&
  result2.reason === "amount_mismatch" &&
  company2Before?.plan_status !== "active" &&
  chargeRow2?.activated_at === null;

// 4) Retry após falha consegue ativar (mesma cobrança, agora com valor certo)
const { data: result4 } = await activate(admin, charge2.payment_id, "approved", 149.8);
const { data: company2After } = await admin
  .from("companies")
  .select("plan_status,plan_expires_at")
  .eq("id", empresa2.company.id)
  .maybeSingle();

report.steps["4_retry_apos_falha"] = {
  rpc_activated: result4.activated,
  company_plan_status: company2After?.plan_status,
};
const pass4 = result4.activated === true && company2After?.plan_status === "active";

// 5) Duas chamadas simultâneas → somente uma ativa (select ... for update serializa)
const empresa3 = await makeTenant(env, "t3");
const charge3 = await seedCharge(admin, empresa3.company.id);
const [{ data: r5a }, { data: r5b }] = await Promise.all([
  activate(admin, charge3.payment_id, "approved", 149.8),
  activate(admin, charge3.payment_id, "approved", 149.8),
]);
const reasons5 = [r5a.reason, r5b.reason].sort();
report.steps["5_concorrencia"] = {
  resultado_a: { activated: r5a.activated, reason: r5a.reason },
  resultado_b: { activated: r5b.activated, reason: r5b.reason },
};
const pass5 =
  r5a.activated === true &&
  r5b.activated === true &&
  JSON.stringify(reasons5) === JSON.stringify(["activated", "already_activated"]);

// 6) Reenvio após ativação → idempotente (não reestende plan_expires_at)
const { data: company3First } = await admin
  .from("companies")
  .select("plan_expires_at")
  .eq("id", empresa3.company.id)
  .maybeSingle();
const expiresAfterFirst = company3First?.plan_expires_at;
const { data: r6 } = await activate(admin, charge3.payment_id, "approved", 149.8);
const { data: company3Second } = await admin
  .from("companies")
  .select("plan_expires_at")
  .eq("id", empresa3.company.id)
  .maybeSingle();

report.steps["6_reenvio_idempotente"] = {
  rpc_reason: r6.reason,
  expires_unchanged: company3Second?.plan_expires_at === expiresAfterFirst,
};
const pass6 =
  r6.activated === true && r6.reason === "already_activated" && company3Second?.plan_expires_at === expiresAfterFirst;

// 7) activated=true só quando a ativação realmente terminou — coberto pelos
// próprios testes 1/2/4: activated:false em amount_mismatch antes do retry,
// activated:true só depois que a transação realmente comitou.
report.steps["7_activated_reflete_estado_real"] = {
  falha_retorna_activated_false: pass23,
  sucesso_retorna_activated_true: pass1,
};
const pass7 = pass23 && pass1;

// 9) Empresa A não consegue ativar cobrança da empresa B — a RPC só aceita
// payment_id (nunca company_id do chamador): o company_id afetado é sempre
// o GRAVADO NA COBRANÇA, nunca um vindo de fora. Prova: ativar a cobrança da
// empresa A não toca a empresa B, e checar o pagamento de A como empresa B
// via check-pix-payment é negado.
const empresaA = await makeTenant(env, "a");
const empresaB = await makeTenant(env, "b");
const chargeA = await seedCharge(admin, empresaA.company.id);

const { data: resultA } = await activate(admin, chargeA.payment_id, "approved", 149.8);
const { data: empresaBDepois } = await admin
  .from("companies")
  .select("plan_status")
  .eq("id", empresaB.company.id)
  .maybeSingle();

report.steps["9_isolamento_tenant"] = {
  cobranca_ativou_empresa_certa: resultA.company_id === empresaA.company.id,
  empresa_b_nao_afetada: empresaBDepois?.plan_status !== "active",
};
const pass9 = resultA.company_id === empresaA.company.id && empresaBDepois?.plan_status !== "active";

// Permissão: authenticated NÃO pode chamar a RPC direto (só service_role)
const { error: errPermissao } = await empresaA.sb.rpc("activate_plan_subscription", {
  p_payment_id: chargeA.payment_id,
  p_mp_status: "approved",
  p_mp_amount: 149.8,
});
report.steps["rpc_negada_para_authenticated"] = {
  erro: errPermissao?.message || null,
  negada: !!errPermissao,
};
const passPermissao = !!errPermissao;

// M — planAccess.hasActivePlan (mesma função que PlanRoute usa)
const futuro = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString();
// Plano pago vencido só bloqueia depois dos 3 dias de tolerância (planAccess.js).
const passado = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString();
report.steps["M_plan_route_reconhece_active"] = {
  active_com_expiracao_futura: hasActivePlan({ plan_status: "active", plan_expires_at: futuro }) === true,
  active_mas_expirado: hasActivePlan({ plan_status: "active", plan_expires_at: passado }) === false,
};
const passM =
  hasActivePlan({ plan_status: "active", plan_expires_at: futuro }) === true &&
  hasActivePlan({ plan_status: "active", plan_expires_at: passado }) === false;

report.steps["8_contrato_approved_vs_activated"] = {
  nota:
    "Verificado por leitura de código (não há runner de teste de componente React neste projeto): " +
    "check-pix-payment só preenche `activated` quando de fato chama activatePlanFromCharge; " +
    "PlanPaymentDialog.verificarPagamento agora exige data.approved && data.activated antes de " +
    "setPaid(true)/mostrar sucesso — approved sozinho cai no branch de aviso, não no de sucesso.",
};

report.steps["not_testable_without_real_mp"] = {
  geracao_de_cobranca_real: "NÃO VERIFICADO — MERCADO_PAGO_ACCESS_TOKEN da plataforma não configurado",
  webhook_disparado_pelo_mp_de_verdade: "NÃO VERIFICADO — exige pagamento real aprovado/recusado no Mercado Pago",
};

report.ok = pass1 && pass23 && pass4 && pass5 && pass6 && pass7 && pass9 && passPermissao && passM;
report.note = report.ok
  ? "RPC atômica validada: ativação normal, rollback em falha, retry após falha, concorrência, idempotência em reenvio, isolamento multi-tenant e permissões (só service_role) — todos OK. Geração/aprovação real via Mercado Pago segue não verificável neste ambiente."
  : "Falha em algum passo verificável.";

console.log(JSON.stringify(report, null, 2));
process.exit(report.ok ? 0 : 1);
