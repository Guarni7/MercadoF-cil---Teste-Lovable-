/**
 * Cria usuário de teste confirmado e imprime credenciais (stdout).
 * Uso: node scripts/create-test-user.mjs
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
const email = `guarni07+mf.e2e.${stamp}@gmail.com`;
const password = `E2e-${stamp}aA1!`;
const admin = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const { data, error } = await admin.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
  user_metadata: { full_name: "E2E Preview" },
});
if (error) {
  console.error(JSON.stringify({ ok: false, error: error.message }));
  process.exit(1);
}
console.log(JSON.stringify({ ok: true, email, password, user_id: data.user.id }));
