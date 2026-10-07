/**
 * Smoke da pendência de estoque na sincronização offline (stock_sync_pending, 059).
 *
 * Simula o que syncUpdateStock (syncService.js) faz: chama apply_stock_movement,
 * e se vier insufficient_stock, grava a pendência vinculada à venda (por client_id).
 *
 * Uso: node scripts/smoke-stock-sync-pending.mjs
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
  const password = `Ssp-${stamp}aA1!`;
  const { data: userData } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  await sb.auth.signInWithPassword({ email, password });
  const { data: bootstrap } = await sb.rpc("bootstrap_company", { p_trade_name: `Ssp ${tag} ${stamp}`, p_email: email });
  const companyId = typeof bootstrap === "string" ? bootstrap : bootstrap?.id;
  return { sb, companyId, userId: userData.user.id };
}

const novoProduto = async (sb, companyId, stock) => {
  const { data } = await sb
    .from("products")
    .insert({ company_id: companyId, name: "Produto Sync", price: 10, stock, unit: "UN" })
    .select()
    .single();
  return data;
};

/** Cria a venda como o app faria (offline sync já resolvida: linha em sales com client_id). */
const novaVenda = async (sb, companyId, clientId) => {
  const { data, error } = await sb
    .from("sales")
    .insert({ company_id: companyId, client_id: clientId, total: 10, payment_method: "dinheiro", status: "concluida" })
    .select()
    .single();
  if (error) throw error;
  return data;
};

/** Espelha syncUpdateStock: chama apply_stock_movement, e se insufficient_stock, grava a pendência. */
async function syncUpdateStockSim(sb, { productId, quantity, productName, companyId, saleClientId, clientId }) {
  const { data: resultado } = await sb.rpc("apply_stock_movement", {
    p_client_id: clientId,
    p_product_id: productId,
    p_quantity: quantity,
    p_product_name: productName,
    p_type: "saida",
    p_reason: "venda",
  });
  if (resultado?.applied === false && resultado.reason === "insufficient_stock") {
    let saleId = null;
    if (saleClientId) {
      const { data: vendas } = await sb.from("sales").select("id").eq("client_id", saleClientId).limit(1);
      saleId = vendas?.[0]?.id || null;
    }
    await sb.from("stock_sync_pending").insert({
      company_id: companyId,
      sale_id: saleId,
      sale_client_id: saleClientId || null,
      product_id: productId,
      product_name: productName,
      quantity,
      client_id: clientId,
      reason: "insufficient_stock",
    });
  }
  return resultado;
}

const { sb, companyId } = await novaEmpresa("ssp");

// 1. Venda offline com estoque disponível → sincroniza normalmente, sem pendência
{
  const produto = await novoProduto(sb, companyId, 10);
  const saleClientId = `sale-ok-${produto.id}`;
  await novaVenda(sb, companyId, saleClientId);
  const resultado = await syncUpdateStockSim(sb, {
    productId: produto.id,
    quantity: 5,
    productName: produto.name,
    companyId,
    saleClientId,
    clientId: `mv-ok-${produto.id}`,
  });
  check(resultado?.applied === true, `estoque disponível: baixa aplicada normalmente (${JSON.stringify(resultado)})`);
  const { data: pendencias } = await sb.from("stock_sync_pending").select("*").eq("sale_client_id", saleClientId);
  check(pendencias.length === 0, "nenhuma pendência criada quando havia estoque suficiente");
}

// 2. Venda offline sem estoque no servidor → venda registrada + pendência visível
let pendenciaId;
{
  const produto = await novoProduto(sb, companyId, 0);
  const saleClientId = `sale-pend-${produto.id}`;
  const venda = await novaVenda(sb, companyId, saleClientId);
  const resultado = await syncUpdateStockSim(sb, {
    productId: produto.id,
    quantity: 3,
    productName: produto.name,
    companyId,
    saleClientId,
    clientId: `mv-pend-${produto.id}`,
  });
  check(resultado?.applied === false && resultado.reason === "insufficient_stock", `sem estoque: baixa recusada (${JSON.stringify(resultado)})`);

  const { data: vendaDepois } = await sb.from("sales").select("id,status").eq("id", venda.id).single();
  check(vendaDepois.status === "concluida", "venda continua registrada e concluída (não é desfeita nem excluída)");

  const { data: pendencias } = await sb.from("stock_sync_pending").select("*").eq("sale_client_id", saleClientId);
  check(pendencias.length === 1, `pendência de estoque criada e vinculada (${pendencias.length})`);
  check(pendencias[0]?.sale_id === venda.id, "pendência vinculada ao sale_id real da venda");
  check(pendencias[0]?.resolved === false, "pendência nasce não-resolvida");
  pendenciaId = pendencias[0]?.id;

  const { data: produtoDepois } = await sb.from("products").select("stock").eq("id", produto.id).single();
  check(produtoDepois.stock === 0, `estoque nunca fica negativo (veio ${produtoDepois.stock})`);
}

// 3. Sincronização posterior (reenvio do mesmo client_id) não duplica venda nem pendência
{
  const { data: pendenciasAntes } = await sb.from("stock_sync_pending").select("id").eq("id", pendenciaId);
  check(pendenciasAntes.length === 1, "pendência ainda única antes do reenvio");

  const produto = await novoProduto(sb, companyId, 0);
  const saleClientId = `sale-dup-${produto.id}`;
  await novaVenda(sb, companyId, saleClientId);
  const clientId = `mv-dup-${produto.id}`;
  await syncUpdateStockSim(sb, { productId: produto.id, quantity: 1, productName: produto.name, companyId, saleClientId, clientId });
  // reenvio do mesmo client_id de movimentação (fila reprocessada, item ainda pendente) —
  // nunca chegou a aplicar (sem estoque), então continua recusando pelo mesmo motivo, sem
  // duplicar nada.
  const segunda = await syncUpdateStockSim(sb, { productId: produto.id, quantity: 1, productName: produto.name, companyId, saleClientId, clientId });
  check(segunda?.applied === false && segunda?.reason === "insufficient_stock", `reenvio pendente segue recusando, sem aplicar (${JSON.stringify(segunda)})`);

  const { data: vendas } = await sb.from("sales").select("id").eq("client_id", saleClientId);
  check(vendas.length === 1, "sincronização posterior não duplica a venda");

  const { data: pendenciasDup } = await sb.from("stock_sync_pending").select("id").eq("sale_client_id", saleClientId);
  check(pendenciasDup.length === 1, `reenvio não duplica a pendência de estoque (${pendenciasDup.length})`);
}

// 4. Pendência permanece identificável (consulta por resolved=false) e é resolvível
{
  const { data: naoResolvidas } = await sb.from("stock_sync_pending").select("*").eq("resolved", false);
  check(naoResolvidas.some((p) => p.id === pendenciaId), "pendência aparece na consulta de não-resolvidas");

  const { error: erroResolve } = await sb
    .from("stock_sync_pending")
    .update({ resolved: true, resolved_at: new Date().toISOString(), resolution_notes: "Conferido manualmente" })
    .eq("id", pendenciaId);
  check(!erroResolve, `pendência pode ser marcada como resolvida (${erroResolve?.message || "ok"})`);

  const { data: depois } = await sb.from("stock_sync_pending").select("resolved,resolution_notes").eq("id", pendenciaId).single();
  check(depois.resolved === true && depois.resolution_notes === "Conferido manualmente", "resolução persistida com nota");
}

// 5. RLS multi-tenant: outra empresa não vê nem resolve a pendência
{
  const { sb: sbOutra, companyId: companyIdOutra } = await novaEmpresa("ssp-outra");
  const { data: vistaDeFora } = await sbOutra.from("stock_sync_pending").select("*").eq("id", pendenciaId);
  check(vistaDeFora.length === 0, "outra empresa não enxerga a pendência (RLS)");

  const { data: atualizada } = await sbOutra
    .from("stock_sync_pending")
    .update({ resolved: false })
    .eq("id", pendenciaId)
    .select();
  check(!atualizada || atualizada.length === 0, "outra empresa não consegue alterar a pendência (RLS)");

  await admin.from("companies").delete().eq("id", companyIdOutra);
}

await admin.from("companies").delete().eq("id", companyId);

console.log("\nSmoke — pendência de estoque na sincronização offline (stock_sync_pending)\n");
for (const m of ok) console.log(`  PASS  ${m}`);
for (const m of falhas) console.log(`  FAIL  ${m}`);
console.log(`\n${ok.length} passaram, ${falhas.length} falharam\n`);
process.exit(falhas.length ? 1 : 0);
