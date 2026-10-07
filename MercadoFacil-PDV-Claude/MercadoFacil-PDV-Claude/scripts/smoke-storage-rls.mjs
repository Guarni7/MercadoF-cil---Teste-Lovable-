/**
 * Smoke do Storage com sessão de usuário real (não service role).
 *
 * O smoke antigo subia arquivo com a service role, que ignora RLS — por isso
 * ninguém percebeu que o bucket não tinha policy de INSERT e todo upload da
 * tela (logo, foto de produto, planilha de importação) falhava.
 *
 * Verifica: usuário envia na pasta da própria empresa, lê pela URL pública e
 * NÃO consegue escrever na pasta de outra empresa.
 *
 * Uso: node scripts/smoke-storage-rls.mjs
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

async function makeTenant(env, tag) {
  const stamp = Date.now() + Math.floor(Math.random() * 1000);
  const email = `guarni07+mf.stg.${tag}.${stamp}@gmail.com`;
  const password = `Stg-${stamp}aA1!`;
  const admin = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
  const { data: created } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  await sb.auth.signInWithPassword({ email, password });
  const { data: company, error } = await sb.rpc("bootstrap_company", {
    p_trade_name: `Storage ${tag} ${stamp}`,
    p_email: email,
  });
  if (error) throw error;
  return { sb, company, email, userId: created?.user?.id, admin };
}

const env = loadEnvLocal();
const a = await makeTenant(env, "a");
const b = await makeTenant(env, "b");

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

const ownPath = `${a.company.id}/logo_${Date.now()}.png`;
const { error: ownErr } = await a.sb.storage
  .from("public")
  .upload(ownPath, png, { contentType: "image/png" });

const { data: pub } = a.sb.storage.from("public").getPublicUrl(ownPath);
const headRes = ownErr ? null : await fetch(pub.publicUrl);
const readable = !!headRes?.ok;

// Pasta de outro tenant precisa ser recusada.
const crossPath = `${b.company.id}/invasao_${Date.now()}.png`;
const { error: crossErr } = await a.sb.storage
  .from("public")
  .upload(crossPath, png, { contentType: "image/png" });

if (!ownErr) await a.admin.storage.from("public").remove([ownPath]);

const ok = !ownErr && readable && !!crossErr;
console.log(
  JSON.stringify(
    {
      ok,
      upload_proprio: !ownErr ? "ok" : ownErr.message,
      url_publica_legivel: readable,
      upload_em_outro_tenant_bloqueado: !!crossErr,
      erro_cross_tenant: crossErr?.message || null,
    },
    null,
    2,
  ),
);
process.exit(ok ? 0 : 1);
