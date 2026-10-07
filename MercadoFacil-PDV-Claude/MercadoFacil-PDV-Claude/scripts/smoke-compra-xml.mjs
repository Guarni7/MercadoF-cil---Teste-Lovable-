/**
 * Importação de NF-e: conta a pagar persistida, entrada de estoque com custo e
 * reimportação bloqueada.
 *
 * Antes a nota vivia só no estado da tela: recarregar apagava o histórico, o
 * estoque subia sem movimento nenhum e o relatório de Compras exibia
 * "XML importados: 0" fixo no código.
 *
 * Uso: node scripts/smoke-compra-xml.mjs
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
const email = `guarni07+mf.xml.${stamp}@gmail.com`;
const password = `Xm-${stamp}aA1!`;
await admin.auth.admin.createUser({ email, password, email_confirm: true });

const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
await sb.auth.signInWithPassword({ email, password });

const { data: empresa, error: bootErr } = await sb.rpc("bootstrap_company", {
  p_trade_name: `Mercado XML ${stamp}`,
  p_email: email,
});
if (bootErr) throw bootErr;

const { data: produto, error: prodErr } = await sb
  .from("products")
  .insert({
    name: "Arroz da NF-e",
    barcode: `NF${stamp}`,
    price: 30,
    cost: 0,
    stock: 0,
    active: true,
    company_id: empresa.id,
  })
  .select()
  .single();
if (prodErr) throw prodErr;

const chave = `3526${stamp}`;
const custoUnitario = 21.5;
const quantidade = 12;

const { data: mov, error: movErr } = await sb.rpc("apply_stock_movement", {
  p_client_id: `xml_${chave}_${produto.barcode}`,
  p_product_id: produto.id,
  p_quantity: quantidade,
  p_product_name: produto.name,
  p_type: "entrada",
  p_reason: "compra",
  p_notes: `NF-e 123 — Distribuidora ${stamp}`,
  p_terminal_id: null,
  p_unit_cost: custoUnitario,
});
if (movErr) throw movErr;

// Reprocessar o mesmo item da mesma nota não pode dobrar o estoque.
const { data: movRepetido } = await sb.rpc("apply_stock_movement", {
  p_client_id: `xml_${chave}_${produto.barcode}`,
  p_product_id: produto.id,
  p_quantity: quantidade,
  p_product_name: produto.name,
  p_type: "entrada",
  p_reason: "compra",
  p_notes: "repetido",
  p_terminal_id: null,
  p_unit_cost: custoUnitario,
});

const { data: movimento } = await sb
  .from("stock_movements")
  .select("unit_cost,quantity,reason")
  .eq("client_id", `xml_${chave}_${produto.barcode}`)
  .single();

const conta = {
  type: "pagar",
  description: `NF-e 123 — Distribuidora ${stamp}`,
  supplier: `Distribuidora ${stamp}`,
  category: "Compras",
  amount: custoUnitario * quantidade,
  due_date: "2026-09-16",
  issue_date: "2026-09-16",
  status: "pendente",
  paid: false,
  source: "xml",
  document_number: "123",
  access_key: chave,
  company_id: empresa.id,
};
const { data: bill, error: billErr } = await sb.from("bills").insert(conta).select().single();
if (billErr) throw billErr;

// Mesma chave duas vezes = nota duplicada no financeiro.
const { error: dupErr } = await sb.from("bills").insert(conta);

const { data: produtoFinal } = await sb
  .from("products")
  .select("stock")
  .eq("id", produto.id)
  .single();

const ok =
  mov?.applied === true &&
  movRepetido?.applied === false &&
  movimento?.unit_cost === custoUnitario &&
  produtoFinal?.stock === quantidade &&
  bill?.source === "xml" &&
  !!dupErr;

console.log(
  JSON.stringify(
    {
      ok,
      entrada_aplicada: mov?.applied,
      reimportacao_do_item_ignorada: movRepetido?.applied === false,
      custo_gravado_na_movimentacao: movimento?.unit_cost,
      estoque_final: produtoFinal?.stock,
      conta_a_pagar_origem: bill?.source,
      nota_duplicada_bloqueada: !!dupErr,
      erro_duplicidade: dupErr?.message || null,
    },
    null,
    2,
  ),
);
process.exit(ok ? 0 : 1);
