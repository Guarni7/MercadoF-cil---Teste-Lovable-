/**
 * Smoke entidades restantes: Customer, Delivery, Bill, Nfce + RLS cross-tenant.
 * Uso: node scripts/smoke-entities-extra.mjs
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
  const email = `guarni07+mf.ent.${tag}.${stamp}@gmail.com`;
  const password = `Ent-${stamp}aA1!`;
  const admin = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
  await admin.auth.admin.createUser({ email, password, email_confirm: true });
  const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  await sb.auth.signInWithPassword({ email, password });
  const { data: company, error } = await sb.rpc("bootstrap_company", {
    p_trade_name: `Ent ${tag} ${stamp}`,
    p_email: email,
  });
  if (error) throw error;
  return { sb, company, email };
}

const env = loadEnvLocal();
const a = await makeTenant(env, "a");
const b = await makeTenant(env, "b");

const { data: cust, error: cErr } = await a.sb
  .from("customers")
  .insert({
    name: "Cliente A",
    credit_limit: 100,
    credit_balance: 10,
    company_id: a.company.id,
  })
  .select()
  .single();
if (cErr) throw cErr;

const { data: bill, error: bErr } = await a.sb
  .from("bills")
  .insert({
    description: "Conta luz",
    amount: 50,
    status: "pendente",
    type: "pagar",
    company_id: a.company.id,
  })
  .select()
  .single();
if (bErr) throw bErr;

const { data: del, error: dErr } = await a.sb
  .from("delivery_orders")
  .insert({
    status: "pendente",
    customer_name: "Cliente A",
    customer_phone: "11999999999",
    address: "Rua 1",
    total: 30,
    company_id: a.company.id,
  })
  .select()
  .single();
if (dErr) throw dErr;

const { data: nfce, error: nErr } = await a.sb
  .from("nfces")
  .insert({
    status: "autorizada",
    sale_id: null,
    company_id: a.company.id,
  })
  .select()
  .single();
if (nErr) throw nErr;

// B não vê dados de A
const { data: leakCust } = await b.sb.from("customers").select("id").eq("id", cust.id);
const { data: leakBill } = await b.sb.from("bills").select("id").eq("id", bill.id);
const { data: leakDel } = await b.sb.from("delivery_orders").select("id").eq("id", del.id);
const { data: leakNfce } = await b.sb.from("nfces").select("id").eq("id", nfce.id);

const rlsOk =
  (leakCust?.length || 0) === 0 &&
  (leakBill?.length || 0) === 0 &&
  (leakDel?.length || 0) === 0 &&
  (leakNfce?.length || 0) === 0;

console.log(
  JSON.stringify(
    {
      ok: rlsOk && !!cust.id && !!bill.id && !!del.id && !!nfce.id,
      customer_id: cust.id,
      bill_id: bill.id,
      delivery_id: del.id,
      nfce_id: nfce.id,
      rls_isolated: rlsOk,
      destination: "supabase",
    },
    null,
    2
  )
);
process.exit(rlsOk ? 0 : 1);
