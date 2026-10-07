/**
 * Smoke do fluxo de devolução (sale_returns) — devolução parcial/total,
 * vínculo com a venda original, restauração de estoque via
 * apply_stock_movement, e os limites contra devolver mais do que foi vendido.
 *
 * Verifica:
 *  1. devolução parcial é aceita e reduz o saldo disponível;
 *  2. devolução total (segunda parte do saldo) fecha o saldo em zero;
 *  3. devolver acima da quantidade vendida é rejeitado;
 *  4. segunda devolução acima do saldo restante é rejeitada;
 *  5. estoque é restaurado corretamente via apply_stock_movement (stock_movements
 *     ganha linha tipo 'entrada', products.stock sobe o valor certo);
 *  6. registro da devolução é criado com vínculo (sale_id) e quem/quando/motivo;
 *  7. venda original não é alterada pela devolução;
 *  8. devolução de venda de outra empresa é rejeitada (multi-tenant).
 *
 * Uso: node scripts/smoke-sale-returns.mjs
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

async function novaEmpresa(tag) {
  const stamp = Date.now() + Math.floor(Math.random() * 1000);
  const email = `guarni07+mf.${tag}.${stamp}@gmail.com`;
  const password = `Ret-${stamp}aA1!`;
  await admin.auth.admin.createUser({ email, password, email_confirm: true });
  const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  await sb.auth.signInWithPassword({ email, password });
  const { data: bootstrap } = await sb.rpc("bootstrap_company", { p_trade_name: `Ret ${tag} ${stamp}`, p_email: email });
  const companyId = typeof bootstrap === "string" ? bootstrap : bootstrap?.id;
  return { sb, companyId };
}

const { sb, companyId } = await novaEmpresa("split");

// Produto de teste com estoque conhecido
const { data: produto } = await sb
  .from("products")
  .insert({ company_id: companyId, name: "Produto Devolução", price: 10, stock: 100, unit: "UN" })
  .select()
  .single();

// Venda de 10 unidades
const { data: venda } = await sb
  .from("sales")
  .insert({
    company_id: companyId,
    items: [{ product_id: produto.id, name: produto.name, quantity: 10, price: 10, total: 100 }],
    subtotal: 100,
    total: 100,
    payment_method: "dinheiro",
    amount_received: 100,
    status: "concluida",
  })
  .select()
  .single();

check(venda?.total === 100, "venda original criada com total 100");

// Estoque desce 10 (simulando a baixa do checkout, via apply_stock_movement)
await sb.rpc("apply_stock_movement", {
  p_client_id: `venda-${venda.id}-${produto.id}`,
  p_product_id: produto.id,
  p_quantity: 10,
  p_product_name: produto.name,
  p_type: "saida",
  p_reason: "venda",
});
const { data: estoqueAposVenda } = await sb.from("products").select("stock").eq("id", produto.id).single();
check(estoqueAposVenda.stock === 90, `estoque desceu para 90 após a venda (${estoqueAposVenda.stock})`);

// 1. Devolução parcial: 4 unidades
const clientId1 = "return-1-" + venda.id;
const { data: devolucao1, error: erro1 } = await sb
  .from("sale_returns")
  .insert({
    company_id: companyId,
    sale_id: venda.id,
    client_id: clientId1,
    items: [{ product_id: produto.id, name: produto.name, quantity: 4, unit_price: 10, total: 40 }],
    reason: "Cliente devolveu 4 unidades",
    refund_method: "dinheiro",
  })
  .select()
  .single();
check(!erro1, `devolução parcial (4 de 10) é aceita (${erro1?.message || "ok"})`);
check(devolucao1?.total === 40, "total da devolução recalculado a partir dos itens (40)");
check(devolucao1?.sale_id === venda.id, "devolução vinculada à venda original (sale_id)");
check(!!devolucao1?.created_at, "devolução tem created_at (quando)");

await sb.rpc("apply_stock_movement", {
  p_client_id: `${clientId1}-${produto.id}`,
  p_product_id: produto.id,
  p_quantity: 4,
  p_product_name: produto.name,
  p_type: "entrada",
  p_reason: "devolucao",
});
const { data: estoqueApos1 } = await sb.from("products").select("stock").eq("id", produto.id).single();
check(estoqueApos1.stock === 94, `estoque restaurado corretamente (90 + 4 = 94, veio ${estoqueApos1.stock})`);

const { data: movimento } = await sb
  .from("stock_movements")
  .select("type, quantity, reason")
  .eq("client_id", `${clientId1}-${produto.id}`)
  .single();
check(movimento?.type === "entrada" && movimento?.quantity === 4, "stock_movements registrou a entrada da devolução (auditável)");

// 2. Devolver acima do vendido (11 > 10) é rejeitado
{
  const { error } = await sb.from("sale_returns").insert({
    company_id: companyId,
    sale_id: venda.id,
    items: [{ product_id: produto.id, name: produto.name, quantity: 11, unit_price: 10, total: 110 }],
  });
  check(!!error && /excede o saldo/i.test(error.message), `devolver 11 de 10 vendidos é rejeitado (${error?.message})`);
}

// 3. Segunda devolução acima do saldo restante (6 disponíveis, pedir 7) é rejeitada
{
  const { error } = await sb.from("sale_returns").insert({
    company_id: companyId,
    sale_id: venda.id,
    items: [{ product_id: produto.id, name: produto.name, quantity: 7, unit_price: 10, total: 70 }],
  });
  check(!!error && /excede o saldo/i.test(error.message), `segunda devolução de 7 (saldo é 6) é rejeitada (${error?.message})`);
}

// 4. Devolução total do saldo restante (6) fecha a venda
const clientId2 = "return-2-" + venda.id;
const { error: erro2 } = await sb.from("sale_returns").insert({
  company_id: companyId,
  sale_id: venda.id,
  client_id: clientId2,
  items: [{ product_id: produto.id, name: produto.name, quantity: 6, unit_price: 10, total: 60 }],
  refund_method: "dinheiro",
});
check(!erro2, `devolução do saldo restante (6) é aceita (${erro2?.message || "ok"})`);

// 5. Devolver mais 1 agora que o saldo é 0 é rejeitado
{
  const { error } = await sb.from("sale_returns").insert({
    company_id: companyId,
    sale_id: venda.id,
    items: [{ product_id: produto.id, name: produto.name, quantity: 1, unit_price: 10, total: 10 }],
  });
  check(!!error && /excede o saldo/i.test(error.message), `devolver com saldo zerado é rejeitado (${error?.message})`);
}

// 6. Venda original preservada (nenhuma devolução alterou items/total da venda)
const { data: vendaDepois } = await sb.from("sales").select("total, items, status").eq("id", venda.id).single();
check(vendaDepois.total === 100, "total da venda original continua 100 (não foi alterado pelas devoluções)");
check(vendaDepois.items?.[0]?.quantity === 10, "items da venda original continuam com quantidade 10");
check(vendaDepois.status === "concluida", "status da venda original não muda por devolução (diferente de cancelamento)");

// 7. Multi-tenant: devolução de outra empresa apontando para esta venda é rejeitada
{
  const { sb: sbOutraEmpresa, companyId: outraEmpresa } = await novaEmpresa("outra");
  const { error } = await sbOutraEmpresa.from("sale_returns").insert({
    company_id: outraEmpresa,
    sale_id: venda.id,
    items: [{ product_id: produto.id, name: produto.name, quantity: 1, unit_price: 10, total: 10 }],
  });
  check(!!error, `empresa B não consegue registrar devolução da venda da empresa A (${error?.message || "sem erro — FALHA"})`);
  await admin.from("companies").delete().eq("id", outraEmpresa);
}

// 8. Item malformado (sem product_id) é rejeitado
{
  const { error } = await sb.from("sale_returns").insert({
    company_id: companyId,
    sale_id: venda.id,
    items: [{ quantity: 1, total: 10 }],
  });
  check(!!error, `item sem product_id é rejeitado (${error?.message || "sem erro — FALHA"})`);
}

await admin.from("companies").delete().eq("id", companyId);

console.log("\nSmoke — devolução (sale_returns)\n");
for (const m of ok) console.log(`  PASS  ${m}`);
for (const m of falhas) console.log(`  FAIL  ${m}`);
console.log(`\n${ok.length} passaram, ${falhas.length} falharam\n`);
process.exit(falhas.length ? 1 : 0);
