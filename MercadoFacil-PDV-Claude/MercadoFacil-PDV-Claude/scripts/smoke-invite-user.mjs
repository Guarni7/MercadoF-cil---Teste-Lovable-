/**
 * Smoke invite-user Edge Function.
 * Uso: node scripts/smoke-invite-user.mjs
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
const ownerEmail = `guarni07+mf.inv.own.${stamp}@gmail.com`;
const inviteEmail = `guarni07+mf.inv.staff.${stamp}@gmail.com`;
const password = `Inv-${stamp}aA1!`;

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
const { data: reg, error: regErr } = await sb.functions.invoke("register-company", {
  body: { trade_name: `Invite Co ${stamp}`, email: ownerEmail },
});
if (regErr || reg?.error) {
  console.error(JSON.stringify({ ok: false, step: "register", error: regErr?.message || reg?.error }));
  process.exit(1);
}

const { data: inv, error: invErr } = await sb.functions.invoke("invite-user", {
  body: {
    email: inviteEmail,
    password: `Staff-${stamp}aA1!`,
    full_name: "Staff Smoke",
    role: "user",
  },
});
if (invErr || inv?.error) {
  console.error(JSON.stringify({ ok: false, step: "invite", error: invErr?.message || inv?.error, inv }));
  process.exit(1);
}

const { data: ownerProf } = await sb.from("profiles").select("company_id").single();
const sb2 = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
await sb2.auth.signInWithPassword({
  email: inviteEmail,
  password: `Staff-${stamp}aA1!`,
});
const { data: staffProf } = await sb2.from("profiles").select("*").single();

const sameCompany = staffProf?.company_id === ownerProf?.company_id;
console.log(
  JSON.stringify(
    {
      ok: sameCompany && !!inv?.user?.id,
      owner_company: ownerProf?.company_id,
      staff_company: staffProf?.company_id,
      staff_role: staffProf?.role,
      invited_id: inv?.user?.id,
    },
    null,
    2
  )
);
process.exit(sameCompany ? 0 : 1);
