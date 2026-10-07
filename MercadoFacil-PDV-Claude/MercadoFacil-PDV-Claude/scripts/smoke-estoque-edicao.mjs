/**
 * Smoke da edição de estoque pelo cadastro de produto (ProductDialog).
 *
 * A tela, ao editar, NÃO grava o estoque no update do produto: manda o update sem `stock` e
 * aplica a diferença (delta) por apply_stock_movement (movimentação auditada). Este smoke
 * repete exatamente esses passos no banco real, como o usuário da empresa (RLS), e confere:
 * 0→10, 10→25, 25→0 persistem e aparecem na mesma consulta que a lista usa ("recarregar a
 * página"); a venda continua baixando estoque; saldo insuficiente não aplica; reenvio com o
 * mesmo client_id não duplica. E confere no código que o aviso de ajuste não aplicado
 * (sem conexão / saldo insuficiente) não vira "Produto atualizado!" nem fecha a janela.
 *
 * Uso: node scripts/smoke-estoque-edicao.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";
import { readFileSync } from "fs";
import { resolve } from "path";

const falhas = [];
const ok = [];
const check = (cond, msg) => (cond ? ok.push(msg) : falhas.push(msg));

// ---------- código do formulário ----------
{
  const dlg = readFileSync(resolve(process.cwd(), "src/components/products/ProductDialog.jsx"), "utf8").split("\r\n").join("\n");
  check(dlg.includes("stock: product ? undefined : parseFloat(form.stock) || 0"), "edição: o update do produto não leva o estoque (só cadastro novo grava stock)");
  check(dlg.includes("const delta = novoValor - baselineStock;") && dlg.includes('type: delta > 0 ? "entrada" : "saida"') && dlg.includes('reason: "ajuste_manual"'), "edição: a diferença vira movimentação auditada (entrada/saída, ajuste_manual)");
  const iOffline = dlg.indexOf("estoqueAplicado = false;\n            toast.error(\n              \"Estoque NÃO foi alterado");
  const iSaldo = dlg.indexOf("estoqueAplicado = false;\n              toast.error(\n                \"Ajuste não aplicado");
  const iRetorno = dlg.indexOf("if (!estoqueAplicado) {");
  const iSucesso = dlg.indexOf('toast.success("Produto atualizado!");');
  check(iOffline > 0 && iSaldo > 0 && iRetorno > iOffline && iRetorno > iSaldo && iSucesso > iRetorno, "ajuste não aplicado (sem conexão ou saldo insuficiente): marca falha antes do sucesso");
  check(/if \(!estoqueAplicado\) \{[^}]*onSaved\?\.\(\);\s*return;\s*\}/.test(dlg), "ajuste não aplicado: não mostra 'Produto atualizado!' nem fecha a janela (mantém o valor digitado)");
}

// ---------- banco real ----------
const env = {};
for (const line of readFileSync(resolve(process.cwd(), ".env.local"), "utf8").split(/\r?\n/)) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (!m) continue;
  let v = m[2].trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  env[m[1].trim()] = v;
}
const admin = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const stamp = Date.now();
let userId = null;
let companyId = null;
try {
  const email = `guarni07+mf.estqedit.${stamp}@gmail.com`;
  const password = `Edt-${stamp}aA1!`;
  const { data: u } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  userId = u.user.id;
  const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  await sb.auth.signInWithPassword({ email, password });
  const { data: c } = await sb.rpc("bootstrap_company", { p_trade_name: `Estoque edição ${stamp}`, p_email: email });
  companyId = typeof c === "string" ? c : c?.id;

  const { data: p, error: erroCriar } = await sb.from("products").insert({ company_id: companyId, name: "TESTE", price: 1, stock: 0, min_stock: 0, category: "x", unit: "UN" }).select("*").single();
  check(!erroCriar && Number(p.stock) === 0, `produto novo nasce com estoque 0 (${erroCriar?.message || "ok"})`);

  // a mesma consulta da tela de produtos (listProducts): lista ordenada por nome, até 500
  const naLista = async () => Number((await sb.from("products").select("*").order("name", { ascending: true }).limit(500)).data.find((x) => x.id === p.id)?.stock);
  const naTabela = async () => Number((await admin.from("products").select("stock").eq("id", p.id).single()).data.stock);
  const movimentos = async () => (await admin.from("stock_movements").select("type, quantity, reason").eq("product_id", p.id).eq("reason", "ajuste_manual").order("created_at")).data;

  // o que o salvar da tela faz: update sem stock + movimentação pelo delta
  const editar = async (de, para, clientId = randomUUID()) => {
    const up = await sb.from("products").update({ name: "TESTE", price: 1, min_stock: 0 }).eq("id", p.id).select("stock").single();
    const delta = para - de;
    const r = delta === 0 ? null : await sb.rpc("apply_stock_movement", {
      p_client_id: clientId, p_product_id: p.id, p_quantity: Math.abs(delta), p_product_name: "TESTE",
      p_type: delta > 0 ? "entrada" : "saida", p_reason: "ajuste_manual", p_notes: "Ajuste manual via cadastro de produto", p_terminal_id: null, p_unit_cost: null,
    });
    return { up, r };
  };

  const a = await editar(0, 10);
  check(!a.up.error && Number(a.up.data.stock) === 0 && a.r?.data?.applied === true, "0 → 10: o update não mexe no estoque e a movimentação é aplicada");
  check((await naTabela()) === 10 && (await naLista()) === 10, "0 → 10: 10 na tabela e na lista (recarregar a página)");
  await editar(10, 25);
  check((await naTabela()) === 25 && (await naLista()) === 25, "10 → 25: 25 na tabela e na lista");
  await editar(25, 0);
  check((await naTabela()) === 0 && (await naLista()) === 0, "25 → 0: 0 na tabela e na lista");
  const mov = await movimentos();
  check(mov.length === 3 && mov[0].type === "entrada" && Number(mov[0].quantity) === 10 && Number(mov[1].quantity) === 15 && mov[2].type === "saida" && Number(mov[2].quantity) === 25, "as 3 edições ficaram auditadas: entrada 10, entrada 15, saída 25");

  // editar outros campos sem mexer no estoque não gera movimentação
  const antes = (await movimentos()).length;
  await editar(0, 0);
  check((await movimentos()).length === antes && (await naTabela()) === 0, "salvar sem mudar o estoque não gera movimentação");

  // venda continua baixando estoque
  await editar(0, 5);
  const venda = await sb.rpc("apply_stock_movement", { p_client_id: randomUUID(), p_product_id: p.id, p_quantity: 2, p_product_name: "TESTE", p_type: "saida", p_reason: "venda", p_notes: null, p_terminal_id: null, p_unit_cost: null });
  check(venda.data?.applied === true && (await naTabela()) === 3 && (await naLista()) === 3, "venda de 2 unidades baixa o estoque normalmente (5 → 3)");
  // saldo insuficiente não aplica e não mexe no estoque
  const alem = await sb.rpc("apply_stock_movement", { p_client_id: randomUUID(), p_product_id: p.id, p_quantity: 10, p_product_name: "TESTE", p_type: "saida", p_reason: "ajuste_manual", p_notes: null, p_terminal_id: null, p_unit_cost: null });
  check(alem.data?.applied === false && alem.data?.reason === "insufficient_stock" && (await naTabela()) === 3, "redução maior que o saldo: não aplica (insufficient_stock) e o estoque fica 3");
  // reenvio com o mesmo client_id não duplica
  const cid = randomUUID();
  await editar(3, 8, cid);
  const reenvio = await editar(3, 8, cid);
  check(reenvio.r?.data?.applied === false && reenvio.r?.data?.reason === "already_applied" && (await naTabela()) === 8, "reenvio do mesmo ajuste (mesmo client_id) não duplica: estoque 8");
} catch (e) {
  falhas.push(`abortou: ${e.message}`);
} finally {
  if (companyId) await admin.from("companies").delete().eq("id", companyId);
  if (userId) await admin.auth.admin.deleteUser(userId);
}

console.log("\nSmoke — edição de estoque pelo cadastro de produto\n");
for (const m of ok) console.log(`  PASS  ${m}`);
for (const m of falhas) console.log(`  FAIL  ${m}`);
console.log(`\n${ok.length} passaram, ${falhas.length} falharam\n`);
process.exit(falhas.length ? 1 : 0);
