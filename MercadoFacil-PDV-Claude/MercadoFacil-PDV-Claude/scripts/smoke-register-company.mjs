/**
 * Smoke register-company (teste real). Uso: node scripts/smoke-register-company.mjs
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
const stamp = Date.now();
const email = `guarni07+mf.reg.${stamp}@gmail.com`;
const password = `Reg-${stamp}aA1!`;

const admin = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const { data: created, error: cErr } = await admin.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
});
if (cErr) {
  console.error(JSON.stringify({ ok: false, error: cErr.message }));
  process.exit(1);
}

const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const { error: loginErr } = await sb.auth.signInWithPassword({ email, password });
if (loginErr) {
  console.error(JSON.stringify({ ok: false, error: loginErr.message }));
  process.exit(1);
}

const { data, error } = await sb.functions.invoke("register-company", {
  body: {
    trade_name: `Loja Smoke ${stamp}`,
    document: "00000000000191",
    city: "Sao Paulo",
    state: "SP",
    email,
  },
});
if (error) {
  console.error(JSON.stringify({ ok: false, error: error.message, data }));
  process.exit(1);
}
if (data?.error) {
  console.error(JSON.stringify({ ok: false, error: data.error }));
  process.exit(1);
}

const { data: profile } = await sb.from("profiles").select("*").eq("id", created.user.id).single();
const { data: company } = await sb
  .from("companies")
  .select("*")
  .eq("id", profile.company_id)
  .single();

console.log(
  JSON.stringify(
    {
      ok: true,
      company_id: profile.company_id,
      plan_status: profile.plan_status,
      trade_name: company?.trade_name,
      message: data?.message,
    },
    null,
    2
  )
);
