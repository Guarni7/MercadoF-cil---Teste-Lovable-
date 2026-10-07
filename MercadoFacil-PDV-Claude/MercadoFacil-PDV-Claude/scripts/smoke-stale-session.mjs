/**
 * Smoke de sessão revogada: usuário faz login, é removido no servidor e o
 * cliente continua com o token salvo. O app precisa reconhecer 401 e limpar a
 * sessão em vez de ficar em loop login → área logada → landing.
 *
 * Uso: node scripts/smoke-stale-session.mjs
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
const email = `guarni07+mf.stale.${stamp}@gmail.com`;
const password = `Stale-${stamp}aA1!`;

const { data: created, error: cErr } = await admin.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
});
if (cErr) throw cErr;

const client = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const { error: lErr } = await client.auth.signInWithPassword({ email, password });
if (lErr) throw lErr;

const report = { ok: false, steps: {} };
const { data: before } = await client.auth.getSession();
report.steps.session_after_login = !!before?.session;

// Usuário some do servidor; o token continua no cliente (getSession é local).
await admin.from("profiles").delete().eq("id", created.user.id);
const { error: delErr } = await admin.auth.admin.deleteUser(created.user.id);
if (delErr) throw delErr;

const { data: stillLocal } = await client.auth.getSession();
report.steps.session_still_cached_locally = !!stillLocal?.session;

// É assim que authMe detecta a revogação: getUser() bate no servidor.
const { data: userCheck, error: userErr } = await client.auth.getUser();
report.steps.get_user_rejects = !!userErr && !userCheck?.user;
report.steps.get_user_error = userErr?.message || null;

// E o token não passa mais no RLS.
const { error: readErr } = await client.from("profiles").select("id").limit(1).maybeSingle();
report.steps.profile_read_fails = !!readErr;

await client.auth.signOut().catch(() => {});
const { data: afterSignOut } = await client.auth.getSession();
report.steps.session_cleared_after_signout = !afterSignOut?.session;

report.ok =
  report.steps.session_after_login === true &&
  report.steps.session_still_cached_locally === true &&
  report.steps.get_user_rejects === true &&
  report.steps.session_cleared_after_signout === true;
report.note = report.ok
  ? "Sessão revogada é detectada por getUser() e limpa com signOut — sem loop de rota"
  : "Detecção de sessão revogada falhou";

console.log(JSON.stringify(report, null, 2));
process.exit(report.ok ? 0 : 1);
