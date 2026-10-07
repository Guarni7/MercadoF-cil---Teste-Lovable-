/**
 * Smoke da configuração de pagamento por empresa.
 *
 * O PIX dependia de um único MERCADO_PAGO_ACCESS_TOKEN da plataforma: todo
 * pagamento de todas as lojas cairia na mesma conta. Agora o token é da
 * empresa, guardado em company_payment_secrets — tabela sem policy, invisível
 * até para o dono da loja.
 *
 * Verifica:
 *  1. admin salva config e token pela Edge Function;
 *  2. a loja lê a própria config, mas só o final do token ("••••1234");
 *  3. o token em si não sai do servidor por nenhuma via do cliente;
 *  4. a loja B não enxerga a config nem o segredo da loja A;
 *  5. loja sem token recebe erro claro em vez de cair no token de outra conta.
 *
 * Uso: node scripts/smoke-pagamento-tenant.mjs
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
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    )
      v = v.slice(1, -1);
    env[m[1].trim()] = v;
  }
  return env;
}

async function makeTenant(env, tag) {
  const stamp = Date.now() + Math.floor(Math.random() * 1000);
  const email = `guarni07+mf.pay.${tag}.${stamp}@gmail.com`;
  const password = `Pay-${stamp}aA1!`;
  const admin = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
  await admin.auth.admin.createUser({ email, password, email_confirm: true });
  const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  await sb.auth.signInWithPassword({ email, password });
  const { data: company, error } = await sb.rpc("bootstrap_company", {
    p_trade_name: `Pagamento ${tag} ${stamp}`,
    p_email: email,
  });
  if (error) throw error;
  return { sb, company, email, admin };
}

const env = loadEnvLocal();
const a = await makeTenant(env, "a");
const b = await makeTenant(env, "b");

const TOKEN_A = "TEST-1111111111111111-smoke-loja-a-9999";
const TOKEN_B = "TEST-2222222222222222-smoke-loja-b-8888";

const salvar = (tenant, body) =>
  tenant.sb.functions.invoke("save-payment-settings", { body });

const { data: salvoA, error: erroSalvoA } = await salvar(a, {
  pix_mode: "mercadopago",
  merchant_name: "Loja A",
  mp_access_token: TOKEN_A,
  mp_webhook_secret: "segredo-a",
});
await salvar(b, { pix_mode: "mercadopago", mp_access_token: TOKEN_B });

// A loja lê a própria configuração...
const { data: configA } = await a.sb
  .from("company_payment_settings")
  .select("*")
  .eq("company_id", a.company.id)
  .maybeSingle();

// ...mas nunca o token inteiro.
const hint = configA?.mp_token_hint || "";
const hintSeguro = hint === `••••${TOKEN_A.slice(-4)}`;
const respostaSemToken = !JSON.stringify(salvoA || {}).includes(TOKEN_A);

// Segredo é invisível mesmo para o dono.
// mp_access_token saiu da tabela (Vault, migration 039) — select("*") prova
// a mesma coisa (RLS sem policy pro dono da loja).
const { data: segredoProprio, error: erroSegredo } = await a.sb
  .from("company_payment_secrets")
  .select("*")
  .eq("company_id", a.company.id);
const segredoBloqueado = !segredoProprio?.length;

// Loja B não enxerga a config da loja A.
const { data: vazamento } = await b.sb
  .from("company_payment_settings")
  .select("company_id,mp_token_hint")
  .eq("company_id", a.company.id);
const isolado = !vazamento?.length;

// Loja sem token: precisa dizer que falta configurar, não usar token alheio.
const c = await makeTenant(env, "c");
const { data: semToken } = await c.sb.functions.invoke("generate-pix-payment", {
  body: { amount: 1.5, description: "smoke sem token" },
});
const erroClaro =
  semToken?.configured === false &&
  /não configurado/i.test(semToken?.error || "");

// Operador do caixa não troca a conta que recebe o dinheiro da loja.
const service = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const operador = await makeTenant(env, "op");
await service
  .from("profiles")
  .update({ role: "user" })
  .eq("company_id", operador.company.id);
const TOKEN_OPERADOR = "TEST-3333333333333333-invasor-7777";
const tentativaOperador = await salvar(operador, {
  mp_access_token: TOKEN_OPERADOR,
});
// A prova é o segredo não ter mudado; a Edge devolve 403, que o cliente
// entrega como error em vez de data.
// mp_access_token saiu da tabela (Vault, migration 039) — lê pelo RPC
// SECURITY DEFINER, mesmo caminho que a Edge Function usa.
const { data: segredoOperador } = await service
  .rpc("get_payment_secrets", { p_company_id: operador.company.id })
  .maybeSingle();
const operadorBloqueado =
  !!tentativaOperador.error && segredoOperador?.mp_access_token !== TOKEN_OPERADOR;

// Cada loja continua com o token dela depois das duas gravações.
const [{ data: segredoA }, { data: segredoB }] = await Promise.all([
  service.rpc("get_payment_secrets", { p_company_id: a.company.id }).maybeSingle(),
  service.rpc("get_payment_secrets", { p_company_id: b.company.id }).maybeSingle(),
]);
const porEmpresa = {
  [a.company.id]: segredoA?.mp_access_token,
  [b.company.id]: segredoB?.mp_access_token,
};
const tokensSeparados =
  porEmpresa[a.company.id] === TOKEN_A && porEmpresa[b.company.id] === TOKEN_B;

const ok =
  !erroSalvoA &&
  hintSeguro &&
  respostaSemToken &&
  segredoBloqueado &&
  isolado &&
  erroClaro &&
  operadorBloqueado &&
  tokensSeparados;

console.log(
  JSON.stringify(
    {
      ok,
      salvou_config: !erroSalvoA ? "ok" : erroSalvoA.message,
      token_mascarado: hintSeguro ? hint : `inesperado: ${hint}`,
      resposta_sem_token_completo: respostaSemToken,
      segredo_invisivel_para_o_dono: segredoBloqueado,
      erro_leitura_segredo: erroSegredo?.message || null,
      config_isolada_entre_lojas: isolado,
      loja_sem_token_tem_erro_claro: erroClaro,
      mensagem_sem_token: semToken?.error || null,
      operador_nao_troca_token: operadorBloqueado,
      resposta_operador: tentativaOperador.error?.message || "sem erro",
      token_apos_tentativa_operador: segredoOperador?.mp_access_token || null,
      tokens_separados_por_loja: tokensSeparados,
    },
    null,
    2,
  ),
);
process.exit(ok ? 0 : 1);
