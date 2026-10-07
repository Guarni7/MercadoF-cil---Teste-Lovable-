/**
 * Confere que os usuários migrados apontam para a empresa certa e que a
 * empresa do dono tem os dados migrados (via service role, sem login).
 *
 * Uso: node scripts/migrate/verify-user-tenant.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { resolve, join } from "path";

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
const dir = resolve(process.cwd(), "migration-dump");
const idMap = JSON.parse(readFileSync(join(dir, "id_map.json"), "utf8"));
const users = JSON.parse(readFileSync(join(dir, "User.json"), "utf8"));

const tables = [
  "products",
  "customers",
  "categories",
  "brands",
  "cash_registers",
  "sales",
  "activity_logs",
];

const rows = [];
let ok = true;

for (const u of users) {
  const expectedCompany = idMap[`Company:${u.company_id}`] || null;
  const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const authUser = (list?.users || []).find(
    (x) => String(x.email || "").toLowerCase() === String(u.email || "").toLowerCase()
  );
  if (!authUser) {
    ok = false;
    rows.push({ email: u.email, error: "sem auth.users" });
    continue;
  }
  const { data: profile, error: pErr } = await admin
    .from("profiles")
    .select("id, email, company_id, role")
    .eq("id", authUser.id)
    .maybeSingle();
  if (pErr || !profile) {
    ok = false;
    rows.push({ email: u.email, error: pErr?.message || "profile ausente" });
    continue;
  }
  const match = profile.company_id === expectedCompany;
  if (!match) ok = false;

  const counts = {};
  for (const t of tables) {
    const { count } = await admin
      .from(t)
      .select("*", { count: "exact", head: true })
      .eq("company_id", profile.company_id);
    if (count) counts[t] = count;
  }

  rows.push({
    email: u.email,
    auth_id: authUser.id,
    profile_company: profile.company_id,
    expected_company: expectedCompany,
    company_match: match,
    role: profile.role,
    data_counts: counts,
  });
}

console.log(
  JSON.stringify(
    {
      ok,
      users: rows,
      note: ok
        ? "Todos os usuários migrados apontam para a empresa correta"
        : "Divergência de tenant em ao menos um usuário",
    },
    null,
    2
  )
);
process.exit(ok ? 0 : 1);
