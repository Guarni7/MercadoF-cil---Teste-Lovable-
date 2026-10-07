/**
 * Smoke do bloqueio de estoque negativo (apply_stock_movement, 057) —
 * padrão bloqueado, flag por empresa, proteção atômica contra corrida entre
 * caixas, e RLS (só admin/owner grava a config).
 *
 * Uso: node scripts/smoke-stock-negative.mjs
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
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    env[m[1].trim()] = v;
  }
  return env;
}

const env = loadEnvLocal();
const admin = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const falhas = [];
const ok = [];
const check = (cond, msg) => (cond ? ok.push(msg) : falhas.push(msg));

async function novaEmpresa(tag, role = "owner") {
  const stamp = Date.now() + Math.floor(Math.random() * 1000);
  const email = `guarni07+mf.${tag}.${stamp}@gmail.com`;
  const password = `Stk-${stamp}aA1!`;
  const { data: userData } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  await sb.auth.signInWithPassword({ email, password });
  const { data: bootstrap } = await sb.rpc("bootstrap_company", { p_trade_name: `Stk ${tag} ${stamp}`, p_email: email });
  const companyId = typeof bootstrap === "string" ? bootstrap : bootstrap?.id;
  if (role !== "owner") {
    await admin.from("profiles").update({ company_role: role }).eq("id", userData.user.id);
  }
  return { sb, companyId, userId: userData.user.id };
}

const novoProduto = async (sb, companyId, stock) => {
  const { data } = await sb
    .from("products")
    .insert({ company_id: companyId, name: "Produto Estoque", price: 10, stock, unit: "UN" })
    .select()
    .single();
  return data;
};

const { sb, companyId } = await novaEmpresa("neg");

// 1. Estoque suficiente → vende (aplica normalmente)
{
  const produto = await novoProduto(sb, companyId, 10);
  const { data } = await sb.rpc("apply_stock_movement", {
    p_client_id: `t1-${produto.id}`,
    p_product_id: produto.id,
    p_quantity: 5,
    p_type: "saida",
    p_reason: "venda",
  });
  check(data?.applied === true && data?.stock === 5, `estoque suficiente vende e desconta corretamente (${JSON.stringify(data)})`);
}

// 2. Estoque zerado → bloqueia
{
  const produto = await novoProduto(sb, companyId, 0);
  const { data } = await sb.rpc("apply_stock_movement", {
    p_client_id: `t2-${produto.id}`,
    p_product_id: produto.id,
    p_quantity: 1,
    p_type: "saida",
    p_reason: "venda",
  });
  check(data?.applied === false && data?.reason === "insufficient_stock", `estoque zerado bloqueia (${JSON.stringify(data)})`);
  const { data: produtoDepois } = await sb.from("products").select("stock").eq("id", produto.id).single();
  check(produtoDepois.stock === 0, "estoque não foi alterado quando bloqueado");
}

// 3. Quantidade maior que estoque → bloqueia
{
  const produto = await novoProduto(sb, companyId, 3);
  const { data } = await sb.rpc("apply_stock_movement", {
    p_client_id: `t3-${produto.id}`,
    p_product_id: produto.id,
    p_quantity: 5,
    p_type: "saida",
    p_reason: "venda",
  });
  check(data?.applied === false && data?.reason === "insufficient_stock", `quantidade maior que estoque bloqueia (${JSON.stringify(data)})`);
}

// 4. Empresa com estoque negativo permitido → permite
{
  const { error: erroConfig } = await sb.from("company_stock_settings").upsert({ company_id: companyId, allow_negative_stock: true });
  check(!erroConfig, `owner consegue ativar estoque negativo (${erroConfig?.message || "ok"})`);

  const produto = await novoProduto(sb, companyId, 2);
  const { data } = await sb.rpc("apply_stock_movement", {
    p_client_id: `t4-${produto.id}`,
    p_product_id: produto.id,
    p_quantity: 5,
    p_type: "saida",
    p_reason: "venda",
  });
  check(data?.applied === true && data?.stock === -3, `com estoque negativo permitido, venda segue e estoque vai a -3 (${JSON.stringify(data)})`);

  await sb.from("company_stock_settings").upsert({ company_id: companyId, allow_negative_stock: false });
}

// 5. RLS: operador (não admin) não consegue ligar estoque negativo
{
  const { sb: sbOp, companyId: companyIdOp, userId: userIdOp } = await novaEmpresa("op", "operator");
  const { error } = await sbOp.from("company_stock_settings").upsert({ company_id: companyIdOp, allow_negative_stock: true });
  check(!!error, `operador não consegue ativar estoque negativo (RLS) (${error?.message || "sem erro — FALHA"})`);
  const { data: confVerifica } = await admin.from("company_stock_settings").select("allow_negative_stock").eq("company_id", companyIdOp).maybeSingle();
  check(!confVerifica?.allow_negative_stock, "config da empresa do operador continua bloqueada após a tentativa recusada");
  await admin.from("companies").delete().eq("id", companyIdOp);
}

// 6. Dois "terminais" vendendo o último item ao mesmo tempo — só um consegue
{
  const produto = await novoProduto(sb, companyId, 1);
  const [r1, r2] = await Promise.all([
    sb.rpc("apply_stock_movement", {
      p_client_id: `race-a-${produto.id}`,
      p_product_id: produto.id,
      p_quantity: 1,
      p_type: "saida",
      p_reason: "venda",
    }),
    sb.rpc("apply_stock_movement", {
      p_client_id: `race-b-${produto.id}`,
      p_product_id: produto.id,
      p_quantity: 1,
      p_type: "saida",
      p_reason: "venda",
    }),
  ]);
  const aplicados = [r1.data?.applied, r2.data?.applied].filter(Boolean).length;
  check(aplicados === 1, `dois terminais disputando o último item — só 1 aplica (aplicados: ${aplicados}, r1: ${JSON.stringify(r1.data)}, r2: ${JSON.stringify(r2.data)})`);
  const { data: produtoDepois } = await sb.from("products").select("stock").eq("id", produto.id).single();
  check(produtoDepois.stock === 0, `estoque final é 0, nunca -1 (veio ${produtoDepois.stock})`);
}

// 7. Idempotência preservada (client_id repetido não duplica baixa)
{
  const produto = await novoProduto(sb, companyId, 5);
  const clientId = `idem-${produto.id}`;
  await sb.rpc("apply_stock_movement", { p_client_id: clientId, p_product_id: produto.id, p_quantity: 2, p_type: "saida", p_reason: "venda" });
  const { data: segunda } = await sb.rpc("apply_stock_movement", { p_client_id: clientId, p_product_id: produto.id, p_quantity: 2, p_type: "saida", p_reason: "venda" });
  check(segunda?.applied === false && segunda?.reason === "already_applied", `reenvio do mesmo client_id não duplica a baixa (${JSON.stringify(segunda)})`);
  const { data: produtoDepois } = await sb.from("products").select("stock").eq("id", produto.id).single();
  check(produtoDepois.stock === 3, `estoque final 3 (5-2, não 5-2-2) — veio ${produtoDepois.stock}`);
}

// 8. Entrada (devolução, compra) nunca é bloqueada pela regra
{
  const produto = await novoProduto(sb, companyId, 0);
  const { data } = await sb.rpc("apply_stock_movement", {
    p_client_id: `entrada-${produto.id}`,
    p_product_id: produto.id,
    p_quantity: 10,
    p_type: "entrada",
    p_reason: "compra",
  });
  check(data?.applied === true && data?.stock === 10, `entrada nunca é bloqueada, mesmo com estoque em 0 (${JSON.stringify(data)})`);
}

await admin.from("companies").delete().eq("id", companyId);

console.log("\nSmoke — bloqueio de estoque negativo (apply_stock_movement)\n");
for (const m of ok) console.log(`  PASS  ${m}`);
for (const m of falhas) console.log(`  FAIL  ${m}`);
console.log(`\n${ok.length} passaram, ${falhas.length} falharam\n`);
process.exit(falhas.length ? 1 : 0);
