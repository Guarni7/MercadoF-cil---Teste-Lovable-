/**
 * Smoke da correção de estoque no ProductDialog — edição de produto não pode
 * mais sobrescrever a coluna stock com um valor obsoleto. Testa o mesmo
 * caminho que o componente agora usa: UPDATE em products SEM a coluna stock
 * (edição comum), e ajuste manual de estoque via apply_stock_movement
 * (type entrada/saida, reason 'ajuste_manual') em vez de UPDATE direto.
 *
 * Uso: node scripts/smoke-product-stock-integrity.mjs
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

const stamp = Date.now();
const email = `guarni07+mf.prodstock.${stamp}@gmail.com`;
const password = `Pst-${stamp}aA1!`;
await admin.auth.admin.createUser({ email, password, email_confirm: true });
const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
await sb.auth.signInWithPassword({ email, password });
const { data: bootstrap } = await sb.rpc("bootstrap_company", { p_trade_name: `Pst ${stamp}`, p_email: email });
const companyId = typeof bootstrap === "string" ? bootstrap : bootstrap?.id;

const novoProduto = async (stock) => {
  const { data, error } = await sb
    .from("products")
    .insert({ company_id: companyId, name: "Produto Dialog", price: 10, stock, unit: "UN" })
    .select()
    .single();
  if (error) throw error;
  return data;
};

// Mesmo payload que ProductDialog.jsx agora envia numa edição: tudo, exceto
// stock (a chave nem existe no objeto — pick() já descarta undefined).
const editarSemMexerNoEstoque = async (id, patch) => {
  const { data, error } = await sb.from("products").update(patch).eq("id", id).select().single();
  if (error) throw error;
  return data;
};

const ajusteManual = async (produto, delta) => {
  const { data, error } = await sb.rpc("apply_stock_movement", {
    p_client_id: `ajuste-${produto.id}-${Date.now()}-${Math.random()}`,
    p_product_id: produto.id,
    p_quantity: Math.abs(delta),
    p_product_name: produto.name,
    p_type: delta > 0 ? "entrada" : "saida",
    p_reason: "ajuste_manual",
    p_notes: "Ajuste manual via cadastro de produto",
  });
  if (error) throw error;
  return data;
};

// 1. Editar produto sem alterar estoque — nenhuma mudança na coluna stock.
{
  const produto = await novoProduto(20);
  const editado = await editarSemMexerNoEstoque(produto.id, { name: "Produto Dialog Editado", price: 12 });
  check(editado.stock === 20, `editar sem mexer no estoque preserva o valor (${editado.stock})`);
  check(editado.name === "Produto Dialog Editado" && editado.price === 12, "outros campos foram atualizados normalmente");
}

// 2. Venda enquanto o diálogo está aberto + salvar produto depois da venda —
// o UPDATE do diálogo (sem stock) não pode desfazer a baixa da venda.
{
  const produto = await novoProduto(20);
  // "diálogo aberto" com snapshot stock=20 (baseline). Enquanto isso, uma
  // venda decrementa 6 unidades pelo caminho real (apply_stock_movement).
  const baixa = await sb.rpc("apply_stock_movement", {
    p_client_id: `venda-${produto.id}`,
    p_product_id: produto.id,
    p_quantity: 6,
    p_type: "saida",
    p_reason: "venda",
  });
  check(baixa.data?.applied === true && baixa.data?.stock === 14, `venda concorrente decrementa o estoque real para 14 (${JSON.stringify(baixa.data)})`);

  // Operador salva o cadastro (campo Estoque nunca foi tocado no formulário
  // — delta 0, nenhuma movimentação disparada pelo componente) sem stock no payload.
  const salvo = await editarSemMexerNoEstoque(produto.id, { name: "Produto Dialog Pós-Venda" });
  check(salvo.stock === 14, `salvar produto depois da venda preserva o estoque real da venda, não o valor antigo de 20 (${salvo.stock})`);
}

// 3. Ajuste manual de estoque — operador muda o campo Estoque de propósito.
// Vira movimentação auditada (apply_stock_movement), não UPDATE direto.
{
  const produto = await novoProduto(10);
  // Operador aumenta de 10 para 15 no formulário → delta +5 → entrada.
  const resultado = await ajusteManual(produto, 5);
  check(resultado?.applied === true && resultado?.stock === 15, `ajuste manual +5 aplica como entrada auditada (${JSON.stringify(resultado)})`);

  const { data: movimento } = await sb
    .from("stock_movements")
    .select("type, reason, quantity")
    .eq("product_id", produto.id)
    .eq("reason", "ajuste_manual")
    .maybeSingle();
  check(
    movimento?.type === "entrada" && movimento?.reason === "ajuste_manual" && Number(movimento?.quantity) === 5,
    `ajuste manual fica registrado em stock_movements com motivo próprio (${JSON.stringify(movimento)})`
  );
}

// 4. Concorrência: venda e ajuste manual disputando o mesmo produto ao mesmo
// tempo — apply_stock_movement é atômico para os dois, estoque final correto.
{
  const produto = await novoProduto(10);
  const [venda, ajuste] = await Promise.all([
    sb.rpc("apply_stock_movement", {
      p_client_id: `conc-venda-${produto.id}`,
      p_product_id: produto.id,
      p_quantity: 3,
      p_type: "saida",
      p_reason: "venda",
    }),
    sb.rpc("apply_stock_movement", {
      p_client_id: `conc-ajuste-${produto.id}`,
      p_product_id: produto.id,
      p_quantity: 2,
      p_type: "entrada",
      p_reason: "ajuste_manual",
    }),
  ]);
  check(venda.data?.applied === true, `venda concorrente aplicada (${JSON.stringify(venda.data)})`);
  check(ajuste.data?.applied === true, `ajuste manual concorrente aplicado (${JSON.stringify(ajuste.data)})`);

  const { data: produtoFinal } = await sb.from("products").select("stock").eq("id", produto.id).single();
  check(produtoFinal.stock === 9, `estoque final reflete os dois movimentos atomicamente (10-3+2=9, veio ${produtoFinal.stock})`);
}

await admin.from("companies").delete().eq("id", companyId);

console.log("\nSmoke — integridade de estoque na edição de produto (ProductDialog)\n");
for (const m of ok) console.log(`  PASS  ${m}`);
for (const m of falhas) console.log(`  FAIL  ${m}`);
console.log(`\n${ok.length} passaram, ${falhas.length} falharam\n`);
process.exit(falhas.length ? 1 : 0);
