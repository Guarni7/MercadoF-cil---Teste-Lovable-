/**
 * Smoke de sangria/suprimento (apply_cash_movement, 063) — operação atômica,
 * idempotente por client_id, protegida contra corrida entre terminais.
 *
 * A fila offline em si (enqueue/syncCashMovement) é lógica de browser
 * (Dexie/navigator.onLine), não testável por um script Node direto contra o
 * Supabase — este smoke cobre o que o RPC garante: o mesmo client_id que
 * viaja na fila offline não duplica ao sincronizar (retry), e a
 * concorrência entre dois terminais nunca perde uma movimentação.
 *
 * Uso: node scripts/smoke-cash-movements.mjs
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
const email = `guarni07+mf.caixamov.${stamp}@gmail.com`;
const password = `Cxm-${stamp}aA1!`;
await admin.auth.admin.createUser({ email, password, email_confirm: true });
const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
await sb.auth.signInWithPassword({ email, password });
const { data: bootstrap } = await sb.rpc("bootstrap_company", { p_trade_name: `Cxm ${stamp}`, p_email: email });
const companyId = typeof bootstrap === "string" ? bootstrap : bootstrap?.id;

const novoCaixa = async () => {
  const { data, error } = await sb
    .from("cash_registers")
    .insert({ company_id: companyId, status: "aberto", opening_balance: 100 })
    .select()
    .single();
  if (error) throw error;
  return data;
};

const mover = async (clientId, cashRegisterId, type, amount, reason) => {
  const { data, error } = await sb.rpc("apply_cash_movement", {
    p_client_id: clientId,
    p_cash_register_id: cashRegisterId,
    p_type: type,
    p_amount: amount,
    p_reason: reason,
  });
  if (error) throw error;
  return data;
};

// 1. Sangria normal.
{
  const caixa = await novoCaixa();
  const resultado = await mover(`sangria-${caixa.id}`, caixa.id, "sangria", 50, "Pagamento fornecedor");
  check(resultado?.applied === true && resultado?.total === 50, `sangria normal aplica e retorna total correto (${JSON.stringify(resultado)})`);
  const { data: registro } = await sb.from("cash_registers").select("withdrawals_total").eq("id", caixa.id).single();
  check(registro.withdrawals_total === 50, `withdrawals_total do caixa reflete a sangria (${registro.withdrawals_total})`);
}

// 2. Suprimento normal.
{
  const caixa = await novoCaixa();
  const resultado = await mover(`suprimento-${caixa.id}`, caixa.id, "suprimento", 30, "Troco inicial");
  check(resultado?.applied === true && resultado?.total === 30, `suprimento normal aplica e retorna total correto (${JSON.stringify(resultado)})`);
  const { data: registro } = await sb.from("cash_registers").select("supplies_total").eq("id", caixa.id).single();
  check(registro.supplies_total === 30, `supplies_total do caixa reflete o suprimento (${registro.supplies_total})`);
}

// 3. Duas operações simultâneas (dois "terminais") no mesmo caixa — nenhuma
// pode perder a outra (o bug do read-modify-write antigo).
{
  const caixa = await novoCaixa();
  const [r1, r2] = await Promise.all([
    mover(`conc-a-${caixa.id}`, caixa.id, "sangria", 20, "Terminal A"),
    mover(`conc-b-${caixa.id}`, caixa.id, "sangria", 15, "Terminal B"),
  ]);
  check(r1?.applied === true && r2?.applied === true, `duas sangrias simultâneas aplicam as duas (${JSON.stringify({ r1, r2 })})`);
  const { data: registro } = await sb.from("cash_registers").select("withdrawals_total").eq("id", caixa.id).single();
  check(registro.withdrawals_total === 35, `nenhuma sangria simultânea se perde: total = 20+15=35 (veio ${registro.withdrawals_total})`);
}

// 4. Offline simulado: mesma chamada que syncCashMovement faz ao reconectar
// (client_id gerado no momento da operação offline, RPC chamado depois).
{
  const caixa = await novoCaixa();
  const clientId = `offline-${caixa.id}`;
  // A operação "aconteceu" offline (não passou pelo RPC ainda); ao
  // reconectar, syncCashMovement chama o RPC com o mesmo client_id.
  const resultado = await mover(clientId, caixa.id, "suprimento", 40, "Reforço registrado offline");
  check(resultado?.applied === true && resultado?.total === 40, `sincronização pós-reconexão aplica a movimentação feita offline (${JSON.stringify(resultado)})`);
}

// 5. Retry duplicado — reenvio do mesmo client_id (fila reprocessada, ou
// timeout que fez o cliente reenviar sem saber se already tinha aplicado)
// não soma de novo.
{
  const caixa = await novoCaixa();
  const clientId = `retry-${caixa.id}`;
  await mover(clientId, caixa.id, "sangria", 25, "Pagamento");
  const segunda = await mover(clientId, caixa.id, "sangria", 25, "Pagamento");
  check(segunda?.applied === false && segunda?.reason === "already_applied", `reenvio do mesmo client_id não duplica (${JSON.stringify(segunda)})`);
  const { data: registro } = await sb.from("cash_registers").select("withdrawals_total").eq("id", caixa.id).single();
  check(registro.withdrawals_total === 25, `total final é 25, não 50 — retry não soma de novo (veio ${registro.withdrawals_total})`);
}

// 6. Saldo final correto com sangria + suprimento misturados no mesmo caixa.
{
  const caixa = await novoCaixa();
  await mover(`misto-s1-${caixa.id}`, caixa.id, "sangria", 10, "a");
  await mover(`misto-p1-${caixa.id}`, caixa.id, "suprimento", 40, "b");
  await mover(`misto-s2-${caixa.id}`, caixa.id, "sangria", 5, "c");
  const { data: registro } = await sb
    .from("cash_registers")
    .select("opening_balance, withdrawals_total, supplies_total")
    .eq("id", caixa.id)
    .single();
  const saldoEsperado = registro.opening_balance + registro.supplies_total - registro.withdrawals_total;
  check(registro.withdrawals_total === 15 && registro.supplies_total === 40, `sangrias e suprimentos somam corretamente (retiradas=${registro.withdrawals_total}, reforços=${registro.supplies_total})`);
  check(saldoEsperado === 100 + 40 - 15, `saldo final do caixa correto (${saldoEsperado})`);
}

// 7. Auditoria: cada movimentação fica registrada em cash_movements com tipo,
// valor e motivo — não some depois de aplicada.
{
  const caixa = await novoCaixa();
  await mover(`audit-${caixa.id}`, caixa.id, "sangria", 12, "Depósito bancário");
  const { data: mov } = await sb
    .from("cash_movements")
    .select("type, amount, reason, cash_register_id")
    .eq("client_id", `audit-${caixa.id}`)
    .maybeSingle();
  check(
    mov?.type === "sangria" && Number(mov?.amount) === 12 && mov?.reason === "Depósito bancário" && mov?.cash_register_id === caixa.id,
    `movimentação fica auditada em cash_movements (${JSON.stringify(mov)})`
  );
}

// 8. Valor inválido (zero/negativo) é recusado pelo banco, não só pela tela.
{
  const caixa = await novoCaixa();
  let erro = null;
  try {
    await mover(`invalido-${caixa.id}`, caixa.id, "sangria", 0, "x");
  } catch (e) {
    erro = e;
  }
  check(!!erro, `valor zero é recusado no banco (${erro?.message || "sem erro — FALHA"})`);
}

// 9. RLS multi-tenant: outra empresa não move nem enxerga o caixa desta.
{
  const caixa = await novoCaixa();
  const stamp2 = Date.now() + 1;
  const email2 = `guarni07+mf.caixamov.outra.${stamp2}@gmail.com`;
  const password2 = `Cxm2-${stamp2}aA1!`;
  await admin.auth.admin.createUser({ email: email2, password: password2, email_confirm: true });
  const sbOutra = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  await sbOutra.auth.signInWithPassword({ email: email2, password: password2 });
  const { data: bootstrap2 } = await sbOutra.rpc("bootstrap_company", { p_trade_name: `Cxm outra ${stamp2}`, p_email: email2 });
  const companyId2 = typeof bootstrap2 === "string" ? bootstrap2 : bootstrap2?.id;

  let erroRls = null;
  try {
    const { error } = await sbOutra.rpc("apply_cash_movement", {
      p_client_id: `rls-${caixa.id}`,
      p_cash_register_id: caixa.id,
      p_type: "sangria",
      p_amount: 10,
      p_reason: "tentativa de outra empresa",
    });
    if (error) throw error;
  } catch (e) {
    erroRls = e;
  }
  check(!!erroRls, `outra empresa não consegue mover o caixa desta (${erroRls?.message || "sem erro — FALHA"})`);

  const { data: registro } = await sb.from("cash_registers").select("withdrawals_total").eq("id", caixa.id).single();
  check(registro.withdrawals_total === 0, "caixa continua com withdrawals_total 0 após a tentativa recusada");

  await admin.from("companies").delete().eq("id", companyId2);
}

await admin.from("companies").delete().eq("id", companyId);

console.log("\nSmoke — sangria/suprimento (apply_cash_movement)\n");
for (const m of ok) console.log(`  PASS  ${m}`);
for (const m of falhas) console.log(`  FAIL  ${m}`);
console.log(`\n${ok.length} passaram, ${falhas.length} falharam\n`);
process.exit(falhas.length ? 1 : 0);
