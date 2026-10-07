/**
 * Smoke assign-role Edge Function.
 * Uso: node scripts/smoke-assign-role.mjs
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
const ownerEmail = `guarni07+mf.role.own.${stamp}@gmail.com`;
const staffEmail = `guarni07+mf.role.staff.${stamp}@gmail.com`;
const password = `Role-${stamp}aA1!`;

const admin = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
await admin.auth.admin.createUser({
  email: ownerEmail,
  password,
  email_confirm: true,
});

const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
await sb.auth.signInWithPassword({ email: ownerEmail, password });
await sb.functions.invoke("register-company", {
  body: { trade_name: `Role Co ${stamp}`, email: ownerEmail },
});
const { data: inv } = await sb.functions.invoke("invite-user", {
  body: {
    email: staffEmail,
    password: `Staff-${stamp}aA1!`,
    full_name: "Staff",
    role: "user",
  },
});
const staffId = inv?.user?.id;
if (!staffId) {
  console.error(JSON.stringify({ ok: false, step: "invite", inv }));
  process.exit(1);
}

const { data: promoted, error } = await sb.functions.invoke("assign-role", {
  body: { user_id: staffId, role: "admin" },
});
if (error || promoted?.error) {
  console.error(
    JSON.stringify({ ok: false, step: "assign", error: error?.message || promoted?.error })
  );
  process.exit(1);
}

const ok = promoted?.user?.role === "admin";
console.log(
  JSON.stringify(
    {
      ok,
      staff_id: staffId,
      role_after: promoted?.user?.role,
    },
    null,
    2
  )
);
process.exit(ok ? 0 : 1);
