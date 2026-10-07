/**
 * Vincula usuários Base44 exportados aos usuários Supabase Auth existentes (por e-mail)
 * e aponta seus profiles para a empresa migrada correspondente (via id_map).
 *
 * NÃO cria usuários novos por padrão (use --create para convidar).
 * Uso:
 *   node scripts/migrate/link-users.mjs --dir=./migration-dump [--apply] [--create]
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "fs";
import { resolve, join } from "path";
import { randomUUID } from "crypto";

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

function arg(name, fallback = null) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

const apply = process.argv.includes("--apply");
const create = process.argv.includes("--create");
const dir = resolve(process.cwd(), arg("dir", "migration-dump"));
const env = loadEnvLocal();
const admin = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const idMapPath = join(dir, "id_map.json");
if (!existsSync(idMapPath)) {
  console.error(JSON.stringify({ ok: false, error: "id_map.json ausente; rode import-dump antes" }));
  process.exit(1);
}
const idMap = JSON.parse(readFileSync(idMapPath, "utf8"));
const users = JSON.parse(readFileSync(join(dir, "User.json"), "utf8"));

const { data: list, error: listErr } = await admin.auth.admin.listUsers({
  page: 1,
  perPage: 1000,
});
if (listErr) {
  console.error(JSON.stringify({ ok: false, error: listErr.message }));
  process.exit(1);
}
const byEmail = new Map(
  (list?.users || []).map((u) => [String(u.email || "").toLowerCase(), u])
);

const report = { ok: true, apply, linked: [], missing_auth: [], errors: [] };

for (const u of users) {
  const email = String(u.email || "").toLowerCase();
  const oldCompany = u.company_id;
  const newCompany = oldCompany ? idMap[`Company:${oldCompany}`] : null;
  const authUser = byEmail.get(email);

  if (!authUser) {
    if (create && apply) {
      // createUser não dispara e-mail; o dono define senha via "esqueci a senha"
      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email,
        email_confirm: true,
        password: `Mf-${randomUUID()}-A1!`,
        user_metadata: { full_name: u.full_name || u.name || null, migrated_from: "base44" },
      });
      if (createErr) {
        report.errors.push({ email, step: "createUser", error: createErr.message });
        continue;
      }
      report.created = report.created || [];
      report.created.push({ email, auth_id: created.user.id, email_sent: false });
      byEmail.set(email, created.user);
    } else {
      report.missing_auth.push({ email, base44_company: oldCompany, supabase_company: newCompany });
      continue;
    }
  }

  const target = byEmail.get(email);
  if (!target || !newCompany) {
    report.missing_auth.push({ email, reason: !newCompany ? "empresa não migrada" : "sem auth" });
    continue;
  }

  if (!apply) {
    report.linked.push({ email, auth_id: target.id, company_id: newCompany, mode: "dry-run" });
    continue;
  }

  const { error: upErr } = await admin
    .from("profiles")
    .update({
      company_id: newCompany,
      role: u.role || "admin",
      full_name: u.full_name || u.name || null,
    })
    .eq("id", target.id);
  if (upErr) {
    report.errors.push({ email, step: "profile_update", error: upErr.message });
  } else {
    report.linked.push({ email, auth_id: target.id, company_id: newCompany });
  }
}

report.ok = report.errors.length === 0;
console.log(JSON.stringify(report, null, 2));
process.exit(report.ok ? 0 : 1);
