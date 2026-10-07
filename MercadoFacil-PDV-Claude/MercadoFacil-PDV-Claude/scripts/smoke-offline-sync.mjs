/**
 * Smoke offline/idempotência → Supabase (teste real).
 * Simula: venda online + replay do mesmo client_id (como fila Dexie ao reconectar).
 * Uso: node scripts/smoke-offline-sync.mjs
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

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const env = loadEnvLocal();
const stamp = Date.now();
const email = `guarni07+mf.offline.${stamp}@gmail.com`;
const password = `Off-${stamp}aA1!`;
const saleClientId = `sale-${randomUUID()}`;
const stockClientId = `stk-${randomUUID()}`;
const terminalId = `term-smoke-${stamp}`;

const admin = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const { data: created, error: cErr } = await admin.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
});
if (cErr) {
  console.error(JSON.stringify({ ok: false, step: "createUser", error: cErr.message }));
  process.exit(1);
}

const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const { error: loginErr } = await sb.auth.signInWithPassword({ email, password });
if (loginErr) {
  console.error(JSON.stringify({ ok: false, step: "login", error: loginErr.message }));
  process.exit(1);
}

const { data: company, error: bootErr } = await sb.rpc("bootstrap_company", {
  p_trade_name: `Offline Smoke ${stamp}`,
  p_email: email,
});
if (bootErr) {
  console.error(JSON.stringify({ ok: false, step: "bootstrap", error: bootErr.message }));
  process.exit(1);
}
const companyId = company?.id;
assert(companyId, "bootstrap_company sem id");

const { data: product, error: pErr } = await sb
  .from("products")
  .insert({
    name: `Prod Offline ${stamp}`,
    price: 10,
    stock: 100,
    company_id: companyId,
  })
  .select()
  .single();
if (pErr) {
  console.error(JSON.stringify({ ok: false, step: "product", error: pErr.message }));
  process.exit(1);
}

/** Replica syncCreateSale: filter client_id → create se ausente */
async function syncCreateSaleOnce(payload) {
  const { data: existing } = await sb
    .from("sales")
    .select("id")
    .eq("client_id", payload.client_id)
    .limit(1);
  if (existing?.length) return { skipped: true, id: existing[0].id };
  const { data, error } = await sb.from("sales").insert(payload).select("id").single();
  if (error) {
    if (String(error.message || "").includes("duplicate") || error.code === "23505") {
      const { data: again } = await sb
        .from("sales")
        .select("id")
        .eq("client_id", payload.client_id)
        .limit(1);
      return { skipped: true, id: again?.[0]?.id, race: true };
    }
    throw error;
  }
  return { skipped: false, id: data.id };
}

const salePayload = {
  total: 10,
  subtotal: 10,
  status: "concluida",
  payment_method: "dinheiro",
  client_id: saleClientId,
  terminal_id: terminalId,
  company_id: companyId,
  items: [{ product_id: product.id, name: product.name, quantity: 1, price: 10 }],
};

const online = await syncCreateSaleOnce(salePayload);
assert(!online.skipped, "primeira venda deveria inserir");

const offlineReplay = await syncCreateSaleOnce(salePayload);
assert(offlineReplay.skipped, "replay offline deveria ser idempotente");
assert(offlineReplay.id === online.id, "mesmo id após replay");

const { count: saleCount, error: scErr } = await sb
  .from("sales")
  .select("*", { count: "exact", head: true })
  .eq("client_id", saleClientId);
if (scErr) throw scErr;
assert(saleCount === 1, `esperado 1 sale, veio ${saleCount}`);

/** Stock movement idempotente */
async function syncStockOnce() {
  const { data: existing } = await sb
    .from("stock_movements")
    .select("id")
    .eq("client_id", stockClientId)
    .limit(1);
  if (existing?.length) return { skipped: true };

  const { data: prod } = await sb.from("products").select("*").eq("id", product.id).single();
  await sb.from("products").update({ stock: (prod.stock || 0) - 1 }).eq("id", product.id);
  const { error } = await sb.from("stock_movements").insert({
    product_id: product.id,
    product_name: product.name,
    type: "saida",
    quantity: 1,
    reason: "venda",
    client_id: stockClientId,
    terminal_id: terminalId,
    company_id: companyId,
  });
  if (error && (error.code === "23505" || String(error.message).includes("duplicate"))) {
    return { skipped: true, race: true };
  }
  if (error) throw error;
  return { skipped: false };
}

await syncStockOnce();
await syncStockOnce();

const { count: movCount } = await sb
  .from("stock_movements")
  .select("*", { count: "exact", head: true })
  .eq("client_id", stockClientId);
assert(movCount === 1, `esperado 1 stock_movement, veio ${movCount}`);

const { data: prodAfter } = await sb.from("products").select("stock").eq("id", product.id).single();
assert(prodAfter.stock === 99, `estoque esperado 99, veio ${prodAfter.stock}`);

/** Unique index: insert direto duplicado deve falhar (se 005 aplicado) */
const { error: dupErr } = await sb.from("sales").insert({
  ...salePayload,
  total: 99,
});
const uniqueEnforced = !!(dupErr && (dupErr.code === "23505" || /duplicate|unique/i.test(dupErr.message || "")));

console.log(
  JSON.stringify(
    {
      ok: true,
      company_id: companyId,
      sale_client_id: saleClientId,
      sales_count: saleCount,
      stock_movements_count: movCount,
      stock_after: prodAfter.stock,
      terminal_id: terminalId,
      unique_index_005: uniqueEnforced,
      destination: "supabase",
      base44_fallback: false,
    },
    null,
    2
  )
);

if (!uniqueEnforced) {
  console.error(
    JSON.stringify({
      ok: false,
      warn: "Índice único client_id ausente — rode supabase/migrations/005_client_id_unique.sql",
    })
  );
  process.exit(2);
}
