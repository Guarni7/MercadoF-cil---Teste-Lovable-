/**
 * Smoke da proteção de cancelamento no banco (migration 076): venda com devolução
 * (parcial ou total) não pode virar 'cancelada', por nenhum caminho — usuário comum
 * (RLS) nem service role. Venda sem devolução continua cancelável.
 * Supabase real; empresa de teste apagada no fim.
 *
 * Uso: node scripts/smoke-sale-cancel-guard.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";
import { readFileSync } from "fs";
import { resolve } from "path";

const falhas = [];
const ok = [];
const check = (cond, msg) => (cond ? ok.push(msg) : falhas.push(msg));

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
  const email = `guarni07+mf.cancelguard.${stamp}@gmail.com`;
  const password = `Cnl-${stamp}aA1!`;
  const { data: u } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  userId = u.user.id;
  const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  await sb.auth.signInWithPassword({ email, password });
  const { data: c } = await sb.rpc("bootstrap_company", { p_trade_name: `Cancel guard ${stamp}`, p_email: email });
  companyId = typeof c === "string" ? c : c?.id;

  const produto = randomUUID();
  const novaVenda = async () => {
    const { data, error } = await admin.from("sales").insert({
      company_id: companyId, status: "concluida", payment_method: "dinheiro", client_id: randomUUID(),
      payments: [{ method: "dinheiro", amount: 100 }], items: [{ product_id: produto, name: "item", quantity: 5, price: 20, total: 100 }],
    }).select("id").single();
    if (error) throw new Error(`venda de teste: ${error.message}`);
    return data.id;
  };
  const devolver = (saleId, qtd) => sb.from("sale_returns").insert({
    company_id: companyId, sale_id: saleId, refund_method: "dinheiro",
    items: [{ product_id: produto, name: "item", quantity: qtd, unit_price: 20, total: qtd * 20 }],
  });
  const status = async (id) => (await admin.from("sales").select("status").eq("id", id).single()).data.status;

  // 1. sem devolução: pode cancelar (usuário e service role)
  const livre = await novaVenda();
  const c1 = await sb.from("sales").update({ status: "cancelada" }).eq("id", livre).select("id");
  check(!c1.error && c1.data.length === 1 && (await status(livre)) === "cancelada", `venda sem devolução pode ser cancelada pelo usuário (${c1.error?.message || "ok"})`);
  const livre2 = await novaVenda();
  const c1b = await admin.from("sales").update({ status: "cancelada" }).eq("id", livre2);
  check(!c1b.error && (await status(livre2)) === "cancelada", "venda sem devolução pode ser cancelada pelo service role");
  // repetir o cancelamento de uma venda já cancelada não é barrado
  const c1c = await sb.from("sales").update({ status: "cancelada" }).eq("id", livre).select("id");
  check(!c1c.error, "cancelar de novo uma venda já cancelada não dá erro");

  // 2. devolução parcial: não pode cancelar
  const parcial = await novaVenda();
  const d = await devolver(parcial, 2);
  check(!d.error, `devolução parcial registrada (${d.error?.message || "ok"})`);
  const c2 = await sb.from("sales").update({ status: "cancelada" }).eq("id", parcial).select("id");
  check(!!c2.error && /devolução registrada/.test(c2.error.message), `venda com devolução parcial não pode ser cancelada pelo usuário (${c2.error?.message || "cancelou!"})`);
  const c2b = await admin.from("sales").update({ status: "cancelada" }).eq("id", parcial);
  check(!!c2b.error && (await status(parcial)) === "concluida", "nem pelo service role; a venda continua concluída");

  // 3. totalmente devolvida: não pode cancelar
  const total = await novaVenda();
  const dt = await devolver(total, 5);
  check(!dt.error, `devolução total registrada (${dt.error?.message || "ok"})`);
  const c3 = await sb.from("sales").update({ status: "cancelada" }).eq("id", total).select("id");
  check(!!c3.error && (await status(total)) === "concluida", `venda totalmente devolvida não pode ser cancelada (${c3.error?.message || "cancelou!"})`);

  // 4. outras alterações da venda com devolução continuam funcionando
  const outra = await admin.from("sales").update({ customer_name: "Fulano" }).eq("id", parcial);
  check(!outra.error, "alterar outros campos de uma venda com devolução não é barrado");
  // 5. venda sem devolução de OUTRA venda não é afetada pela devolução da primeira
  const isolada = await novaVenda();
  const c5 = await sb.from("sales").update({ status: "cancelada" }).eq("id", isolada).select("id");
  check(!c5.error && c5.data.length === 1, "a devolução de uma venda não bloqueia o cancelamento de outra");
} catch (e) {
  falhas.push(`abortou: ${e.message}`);
} finally {
  if (companyId) {
    await admin.from("sale_returns").delete().eq("company_id", companyId);
    await admin.from("companies").delete().eq("id", companyId);
  }
  if (userId) await admin.auth.admin.deleteUser(userId);
}

console.log("\nSmoke — proteção de cancelamento no banco\n");
for (const m of ok) console.log(`  PASS  ${m}`);
for (const m of falhas) console.log(`  FAIL  ${m}`);
console.log(`\n${ok.length} passaram, ${falhas.length} falharam\n`);
process.exit(falhas.length ? 1 : 0);
