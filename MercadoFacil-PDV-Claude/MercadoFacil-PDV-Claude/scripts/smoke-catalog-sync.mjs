/**
 * Smoke: produto com client_id idempotente (catálogo offline → Supabase).
 * Uso: node scripts/smoke-catalog-sync.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { resolve } from "path";
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

const env = loadEnvLocal();
const stamp = Date.now();
const email = `guarni07+mf.cat.${stamp}@gmail.com`;
const password = `Cat-${stamp}aA1!`;
const clientId = `prod-${randomUUID()}`;

const admin = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
await admin.auth.admin.createUser({ email, password, email_confirm: true });
const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
await sb.auth.signInWithPassword({ email, password });
const { data: company } = await sb.rpc("bootstrap_company", {
  p_trade_name: `Cat Smoke ${stamp}`,
  p_email: email,
});

async function syncCreateOnce() {
  const { data: existing } = await sb
    .from("products")
    .select("id")
    .eq("client_id", clientId)
    .limit(1);
  if (existing?.length) return { skipped: true, id: existing[0].id };
  const { data, error } = await sb
    .from("products")
    .insert({
      name: `Prod Cat ${stamp}`,
      price: 5,
      stock: 1,
      client_id: clientId,
      company_id: company.id,
    })
    .select("id")
    .single();
  if (error && error.code === "23505") {
    const { data: again } = await sb
      .from("products")
      .select("id")
      .eq("client_id", clientId)
      .limit(1);
    return { skipped: true, id: again?.[0]?.id };
  }
  if (error) throw error;
  return { skipped: false, id: data.id };
}

const a = await syncCreateOnce();
const b = await syncCreateOnce();
const { count } = await sb
  .from("products")
  .select("*", { count: "exact", head: true })
  .eq("client_id", clientId);

const { error: dup } = await sb.from("products").insert({
  name: "dup",
  price: 1,
  client_id: clientId,
  company_id: company.id,
});
const unique = !!(dup && dup.code === "23505");

console.log(
  JSON.stringify(
    {
      ok: count === 1 && a.id === b.id && unique,
      count,
      same_id: a.id === b.id,
      unique_006: unique,
      destination: "supabase",
    },
    null,
    2
  )
);
process.exit(count === 1 && unique ? 0 : 1);
