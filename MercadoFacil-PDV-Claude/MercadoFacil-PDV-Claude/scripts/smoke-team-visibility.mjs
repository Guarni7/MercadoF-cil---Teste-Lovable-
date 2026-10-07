/**
 * Equipe da mesma empresa precisa aparecer na tela Usuários — e só ela.
 *
 * Antes da policy `profiles_select_same_company` o admin enxergava apenas o
 * próprio profile: o operador recém-criado sumia da lista e o seletor de
 * vendedor do PDV ficava com uma opção só.
 *
 * Uso: node scripts/smoke-team-visibility.mjs
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
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))
      v = v.slice(1, -1);
    env[m[1].trim()] = v;
  }
  return env;
}

const env = loadEnvLocal();
const admin = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

async function signUp(tag) {
  const stamp = Date.now() + Math.floor(Math.random() * 1000);
  const email = `guarni07+mf.team.${tag}.${stamp}@gmail.com`;
  const password = `Team-${stamp}aA1!`;
  await admin.auth.admin.createUser({ email, password, email_confirm: true });
  const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  await sb.auth.signInWithPassword({ email, password });
  return { sb, email, password };
}

// Empresa 1: dono + operador convidado.
const owner = await signUp("owner");
const { data: company, error: bootErr } = await owner.sb.rpc("bootstrap_company", {
  p_trade_name: `Equipe ${Date.now()}`,
  p_email: owner.email,
});
if (bootErr) throw bootErr;

const opEmail = `guarni07+mf.team.op.${Date.now()}@gmail.com`;
const { data: opUser } = await admin.auth.admin.createUser({
  email: opEmail,
  password: `Op-${Date.now()}aA1!`,
  email_confirm: true,
});
await admin
  .from("profiles")
  .update({ company_id: company.id, role: "user", full_name: "Operador Smoke" })
  .eq("id", opUser.user.id);

// Empresa 2: tenant vizinho, precisa continuar invisível.
const other = await signUp("other");
await other.sb.rpc("bootstrap_company", {
  p_trade_name: `Vizinha ${Date.now()}`,
  p_email: other.email,
});

const { data: visiveis, error } = await owner.sb
  .from("profiles")
  .select("id,email,company_id,role");
if (error) throw error;

const emails = (visiveis || []).map((p) => p.email);
const veOperador = emails.includes(opEmail);
const veVizinho = emails.includes(other.email);
const soDaEmpresa = (visiveis || []).every((p) => p.company_id === company.id);

const ok = veOperador && !veVizinho && soDaEmpresa;
console.log(
  JSON.stringify(
    {
      ok,
      profiles_visiveis: emails.length,
      ve_operador_da_equipe: veOperador,
      ve_usuario_de_outra_empresa: veVizinho,
      todos_da_mesma_empresa: soDaEmpresa,
    },
    null,
    2,
  ),
);
process.exit(ok ? 0 : 1);
