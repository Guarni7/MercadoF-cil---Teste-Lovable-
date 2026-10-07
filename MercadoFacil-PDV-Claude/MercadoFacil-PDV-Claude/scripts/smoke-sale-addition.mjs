/**
 * Smoke do acréscimo (addition) na venda — total = subtotal - discount +
 * addition (060_sales_addition.sql), e payments[] continua validado contra
 * esse total (053_sales_payments.sql).
 *
 * Uso: node scripts/smoke-sale-addition.mjs
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
  const password = `Add-${stamp}aA1!`;
  await admin.auth.admin.createUser({ email, password, email_confirm: true });
  const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  await sb.auth.signInWithPassword({ email, password });
  const { data: bootstrap } = await sb.rpc("bootstrap_company", { p_trade_name: `Add ${tag} ${stamp}`, p_email: email });
  const companyId = typeof bootstrap === "string" ? bootstrap : bootstrap?.id;
  return { sb, companyId };
}

const itens = (unitPrice, qty) => [
  { product_id: "00000000-0000-0000-0000-000000000001", name: "Item", price: unitPrice, quantity: qty, total: unitPrice * qty },
];

const { sb, companyId } = await novaEmpresa("add");

// 1. Venda sem acréscimo (e sem desconto) — total = subtotal
{
  const { data, error } = await sb
    .from("sales")
    .insert({ company_id: companyId, client_id: `s1-${Date.now()}`, items: itens(10, 2), payments: [{ method: "dinheiro", amount: 20 }] })
    .select()
    .single();
  check(!error && data.total === 20 && data.addition === 0, `sem acréscimo: total=20 (${JSON.stringify({ total: data?.total, addition: data?.addition, err: error?.message })})`);
}

// 2. Venda com acréscimo — total = subtotal + addition
{
  const { data, error } = await sb
    .from("sales")
    .insert({ company_id: companyId, client_id: `s2-${Date.now()}`, items: itens(10, 2), addition: 5, payments: [{ method: "dinheiro", amount: 25 }] })
    .select()
    .single();
  check(!error && data.total === 25, `com acréscimo: total=25 (${JSON.stringify({ total: data?.total, err: error?.message })})`);
}

// 3. Desconto + acréscimo — total = subtotal - discount + addition
{
  const { data, error } = await sb
    .from("sales")
    .insert({
      company_id: companyId,
      client_id: `s3-${Date.now()}`,
      items: itens(10, 2),
      discount: 3,
      addition: 5,
      payments: [{ method: "dinheiro", amount: 22 }],
    })
    .select()
    .single();
  check(!error && data.total === 22, `desconto+acréscimo: total=22 (20-3+5) (${JSON.stringify({ total: data?.total, err: error?.message })})`);
}

// 4. Split-payment + acréscimo — soma de payments[] bate com o total (com acréscimo)
{
  const { data, error } = await sb
    .from("sales")
    .insert({
      company_id: companyId,
      client_id: `s4-${Date.now()}`,
      items: itens(10, 2),
      addition: 5,
      payments: [
        { method: "dinheiro", amount: 15 },
        { method: "credito", amount: 10 },
      ],
    })
    .select()
    .single();
  check(!error && data.total === 25, `split+acréscimo: total=25 (${JSON.stringify({ total: data?.total, err: error?.message })})`);
}

// 5. Split-payment que NÃO soma o acréscimo — trigger de payments rejeita
{
  const { error } = await sb.from("sales").insert({
    company_id: companyId,
    client_id: `s5-${Date.now()}`,
    items: itens(10, 2),
    addition: 5,
    payments: [{ method: "dinheiro", amount: 20 }], // esqueceu o acréscimo
  });
  check(!!error && /não confere/i.test(error.message), `payments sem acréscimo é rejeitado pela trigger (${error?.message || "sem erro — FALHA"})`);
}

// 6. Valor inválido de acréscimo (string) — insert deve falhar (coluna numeric)
{
  const { error } = await sb.from("sales").insert({
    company_id: companyId,
    client_id: `s6-${Date.now()}`,
    items: itens(10, 2),
    addition: "abc",
    payments: [{ method: "dinheiro", amount: 20 }],
  });
  check(!!error, `acréscimo inválido (não-numérico) é rejeitado (${error?.message || "sem erro — FALHA"})`);
}

// 7. Simula sincronização offline (mesmo caminho: supabase.from("sales").insert()) com acréscimo
{
  const { data, error } = await sb
    .from("sales")
    .insert({
      company_id: companyId,
      client_id: `s7-offline-${Date.now()}`,
      items: itens(10, 3),
      discount: 2,
      addition: 4,
      payments: [{ method: "pix", amount: 32 }],
      terminal_id: "terminal-1",
    })
    .select()
    .single();
  check(!error && data.total === 32, `sincronização offline com acréscimo: total=32 (30-2+4) (${JSON.stringify({ total: data?.total, err: error?.message })})`);
}

await admin.from("companies").delete().eq("id", companyId);

console.log("\nSmoke — acréscimo na venda (sales.addition)\n");
for (const m of ok) console.log(`  PASS  ${m}`);
for (const m of falhas) console.log(`  FAIL  ${m}`);
console.log(`\n${ok.length} passaram, ${falhas.length} falharam\n`);
process.exit(falhas.length ? 1 : 0);
