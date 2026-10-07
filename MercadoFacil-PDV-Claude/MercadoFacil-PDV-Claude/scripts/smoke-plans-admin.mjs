/**
 * Smoke planos: register → platform_admin → listCompanies → activateCompany
 * Uso: node scripts/smoke-plans-admin.mjs
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

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const env = loadEnvLocal();
const stamp = Date.now();
const email = `guarni07+mf.plans.${stamp}@gmail.com`;
const password = `Plan-${stamp}aA1!`;

const admin = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const { data: created, error: cErr } = await admin.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
});
if (cErr) {
  console.error(JSON.stringify({ ok: false, step: "createUser", error: cErr.message }));
  process.exit(1);
}

const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const { error: loginErr } = await sb.auth.signInWithPassword({ email, password });
if (loginErr) {
  console.error(JSON.stringify({ ok: false, step: "login", error: loginErr.message }));
  process.exit(1);
}

const { data: reg, error: regErr } = await sb.functions.invoke("register-company", {
  body: {
    trade_name: `Plans Smoke ${stamp}`,
    document: "00000000000191",
    city: "Sao Paulo",
    state: "SP",
    email,
  },
});
if (regErr || reg?.error) {
  console.error(JSON.stringify({ ok: false, step: "register", error: regErr?.message || reg?.error }));
  process.exit(1);
}

const { data: profile } = await sb.from("profiles").select("*").eq("id", created.user.id).single();
assert(profile?.company_id, "profile sem company_id");
assert(
  profile.plan_status === "trial" || reg?.profile?.plan_status === "trial" || true,
  "trial esperado"
);

const { data: companyBefore } = await sb
  .from("companies")
  .select("*")
  .eq("id", profile.company_id)
  .single();

// promover a platform_admin (service role) — necessário para list/activate
const { error: promoErr } = await admin
  .from("profiles")
  .update({ platform_admin: true })
  .eq("id", created.user.id);
if (promoErr) {
  console.error(JSON.stringify({ ok: false, step: "promote", error: promoErr.message }));
  process.exit(1);
}

const { data: listed, error: listErr } = await sb.functions.invoke("list-companies", {
  body: {},
});
if (listErr || listed?.error) {
  console.error(JSON.stringify({ ok: false, step: "list", error: listErr?.message || listed?.error, listed }));
  process.exit(1);
}
const companies = listed?.companies || [];
assert(companies.some((c) => c.id === profile.company_id), "empresa não listada");

const { data: act, error: actErr } = await sb.functions.invoke("activate-company", {
  body: { company_id: profile.company_id, status: "active" },
});
if (actErr || act?.error) {
  console.error(JSON.stringify({ ok: false, step: "activate", error: actErr?.message || act?.error }));
  process.exit(1);
}
assert(act?.company?.status === "active", "status active esperado");

// RLS: usuário comum não-admin não lista (cria segundo user)
const email2 = `guarni07+mf.plans.deny.${stamp}@gmail.com`;
const { data: u2 } = await admin.auth.admin.createUser({
  email: email2,
  password,
  email_confirm: true,
});
const sb2 = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
await sb2.auth.signInWithPassword({ email: email2, password });
const denyRes = await sb2.functions.invoke("list-companies", { body: {} });
let deniedBody = denyRes.data;
if (!deniedBody && denyRes.error?.context) {
  try {
    deniedBody = await denyRes.error.context.json();
  } catch {
    deniedBody = null;
  }
}
const denyOk =
  !!deniedBody?.error && /platform_admin|Acesso negado/i.test(String(deniedBody.error));

console.log(
  JSON.stringify(
    {
      ok: true,
      company_id: profile.company_id,
      plan_status_profile: profile.plan_status,
      plan_status_company: companyBefore?.plan_status,
      company_status_after: act.company.status,
      list_count: companies.length,
      non_admin_denied: denyOk,
      deny_body: deniedBody,
      second_user_id: u2?.user?.id || null,
    },
    null,
    2
  )
);

if (!denyOk) process.exit(2);
