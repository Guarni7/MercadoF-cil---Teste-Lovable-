/**
 * Cadastro da empresa: ida e volta de todos os campos da tela Configurações.
 *
 * A tela usava nomes próprios (name/cnpj/number/uf) que não batiam com as
 * colunas (trade_name/document/address_number/state): salvava em branco e, ao
 * reabrir, mostrava o formulário vazio mesmo com a empresa cadastrada.
 *
 * Uso: node scripts/smoke-company-fields.mjs
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

const stamp = Date.now();
const email = `guarni07+mf.cofields.${stamp}@gmail.com`;
const password = `Co-${stamp}aA1!`;
await admin.auth.admin.createUser({ email, password, email_confirm: true });

const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const { data: sess } = await sb.auth.signInWithPassword({ email, password });

const enviado = {
  trade_name: `Mercado Campos ${stamp}`,
  legal_name: `Mercado Campos ${stamp} LTDA`,
  document: "12.345.678/0001-90",
  phone: "(31) 99999-0000",
  email,
  cep: "30110-000",
  address: "Rua das Flores",
  address_number: "123",
  complement: "Loja 2",
  neighborhood: "Centro",
  city: "Belo Horizonte",
  state: "MG",
  instagram: "@mercadocampos",
};

const res = await fetch(`${env.VITE_SUPABASE_URL}/functions/v1/register-company`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${sess.session.access_token}`,
    "Content-Type": "application/json",
    apikey: env.VITE_SUPABASE_ANON_KEY,
  },
  body: JSON.stringify(enviado),
});
const body = await res.json();
if (body.error) {
  console.log(JSON.stringify({ ok: false, erro: body.error }, null, 2));
  process.exit(1);
}

const { data: company } = await sb
  .from("companies")
  .select("*")
  .eq("id", body.company.id)
  .single();

const divergentes = Object.entries(enviado)
  .filter(([campo, valor]) => (company?.[campo] ?? null) !== valor)
  .map(([campo, valor]) => ({ campo, enviado: valor, gravado: company?.[campo] ?? null }));

const ok = divergentes.length === 0;
console.log(
  JSON.stringify(
    { ok, company_id: body.company.id, campos_conferidos: Object.keys(enviado).length, divergentes },
    null,
    2,
  ),
);
process.exit(ok ? 0 : 1);
