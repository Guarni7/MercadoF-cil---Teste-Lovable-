/**
 * Smoke do bloqueio fiscal (devolução/cancelamento) — replica exatamente a
 * consulta que bloqueioFiscalDaVenda() (src/lib/fiscalConfig.js) faz:
 * fiscal_documents por sale_id, status='authorized', model 55/65 bloqueia,
 * NFS-e não bloqueia, rejected/cancelled não bloqueia. Roda a consulta com o
 * client anon-autenticado da empresa (RLS normal), não com service role —
 * é exatamente o caminho que a tela usa.
 *
 * Uso: node scripts/smoke-fiscal-block.mjs
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
  const password = `Blk-${stamp}aA1!`;
  await admin.auth.admin.createUser({ email, password, email_confirm: true });
  const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  await sb.auth.signInWithPassword({ email, password });
  const { data: bootstrap } = await sb.rpc("bootstrap_company", { p_trade_name: `Blk ${tag} ${stamp}`, p_email: email });
  const companyId = typeof bootstrap === "string" ? bootstrap : bootstrap?.id;
  return { sb, companyId };
}

// Mesma lógica de bloqueioFiscalDaVenda(), rodando com o client RLS-scoped.
async function bloqueio(sb, saleId) {
  const { data: docs, error } = await sb.from("fiscal_documents").select("*").eq("sale_id", saleId).eq("status", "authorized");
  if (error) throw error;
  const doc = (docs || []).find((d) => d.model === "55" || d.model === "65");
  return doc || null;
}

async function novaVenda(sb, companyId) {
  const { data } = await sb.from("sales").insert({
    company_id: companyId,
    items: [{ product_id: null, name: "Item", quantity: 1, total: 10 }],
    subtotal: 10,
    total: 10,
    payment_method: "dinheiro",
    status: "concluida",
  }).select().single();
  return data;
}

async function novoDocumento(companyId, saleId, { model, status }) {
  const { error } = await admin.from("fiscal_documents").insert({
    company_id: companyId,
    sale_id: saleId,
    model,
    environment: "homologacao",
    status,
    number: 123,
  });
  if (error) throw error;
}

const { sb, companyId } = await novaEmpresa("fiscal");

// 1. Venda sem documento fiscal — não bloqueia
{
  const venda = await novaVenda(sb, companyId);
  const b = await bloqueio(sb, venda.id);
  check(b === null, "venda sem fiscal_documents não bloqueia");
}

// 2. Venda com NFC-e (65) authorized — bloqueia
{
  const venda = await novaVenda(sb, companyId);
  await novoDocumento(companyId, venda.id, { model: "65", status: "authorized" });
  const b = await bloqueio(sb, venda.id);
  check(b !== null && b.model === "65", "venda com NFC-e authorized bloqueia");
}

// 3. Venda com NF-e (55) authorized — bloqueia
{
  const venda = await novaVenda(sb, companyId);
  await novoDocumento(companyId, venda.id, { model: "55", status: "authorized" });
  const b = await bloqueio(sb, venda.id);
  check(b !== null && b.model === "55", "venda com NF-e authorized bloqueia");
}

// 4. Documento rejected não bloqueia (não está authorized)
{
  const venda = await novaVenda(sb, companyId);
  await novoDocumento(companyId, venda.id, { model: "65", status: "rejected" });
  const b = await bloqueio(sb, venda.id);
  check(b === null, "NFC-e rejected não bloqueia");
}

// 5. Documento cancelled não bloqueia
{
  const venda = await novaVenda(sb, companyId);
  await novoDocumento(companyId, venda.id, { model: "65", status: "cancelled" });
  const b = await bloqueio(sb, venda.id);
  check(b === null, "NFC-e cancelled não bloqueia");
}

// 6. NFS-e authorized NÃO bloqueia (cancelamento já funcional, não é alvo)
{
  const venda = await novaVenda(sb, companyId);
  await novoDocumento(companyId, venda.id, { model: "nfse", status: "authorized" });
  const b = await bloqueio(sb, venda.id);
  check(b === null, "NFS-e authorized não bloqueia (preservada, tem cancelamento próprio)");
}

// 7. Documento em draft/transmitting (não authorized ainda) não bloqueia
{
  const venda = await novaVenda(sb, companyId);
  await novoDocumento(companyId, venda.id, { model: "65", status: "transmitting" });
  const b = await bloqueio(sb, venda.id);
  check(b === null, "NFC-e ainda transmitting não bloqueia");
}

// 8. Multi-tenant: empresa B não vê o documento fiscal da venda da empresa A
{
  const vendaA = await novaVenda(sb, companyId);
  await novoDocumento(companyId, vendaA.id, { model: "65", status: "authorized" });

  const { sb: sbB } = await novaEmpresa("outra");
  const { data: docsB, error: erroB } = await sbB.from("fiscal_documents").select("*").eq("sale_id", vendaA.id).eq("status", "authorized");
  check(!erroB, `empresa B consulta sem erro (RLS filtra, não bloqueia a query) (${erroB?.message || "ok"})`);
  check((docsB || []).length === 0, "RLS impede empresa B de ver o documento fiscal da venda da empresa A");
}

await admin.from("companies").delete().eq("id", companyId);

console.log("\nSmoke — bloqueio fiscal (devolução/cancelamento)\n");
for (const m of ok) console.log(`  PASS  ${m}`);
for (const m of falhas) console.log(`  FAIL  ${m}`);
console.log(`\n${ok.length} passaram, ${falhas.length} falharam\n`);
process.exit(falhas.length ? 1 : 0);
