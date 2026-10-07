/**
 * Smoke do PIX de verdade (opcional).
 *
 * O isolamento entre lojas é coberto por smoke-pagamento-tenant.mjs. Este aqui
 * é o teste que só o Mercado Pago pode responder: cadastra um Access Token de
 * sandbox numa loja nova, gera um PIX de R$ 0,01 e confere se veio QR Code.
 *
 * Sem token, o smoke é pulado — não há como simular a resposta do Mercado Pago
 * sem inventar um mock, que esconderia justamente o que precisa ser validado.
 *
 * Para rodar: coloque MERCADO_PAGO_TEST_TOKEN=TEST-... no .env.local
 * (Access Token de teste do painel do Mercado Pago).
 *
 * Uso: node scripts/smoke-pix-edge.mjs
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

const env = loadEnvLocal();
const token = (env.MERCADO_PAGO_TEST_TOKEN || "").trim();

if (!token) {
  console.log(
    JSON.stringify(
      {
        ok: true,
        skipped: true,
        motivo: "MERCADO_PAGO_TEST_TOKEN ausente no .env.local",
        next:
          "Cadastre um Access Token de teste (TEST-...) do Mercado Pago para validar a geração real do QR Code.",
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

const stamp = Date.now();
const email = `guarni07+mf.pix.${stamp}@gmail.com`;
const password = `Pix-${stamp}aA1!`;
const admin = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
await admin.auth.admin.createUser({ email, password, email_confirm: true });

const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
await sb.auth.signInWithPassword({ email, password });
const { data: company, error: bootErr } = await sb.rpc("bootstrap_company", {
  p_trade_name: `PIX real ${stamp}`,
  p_email: email,
});
if (bootErr) throw bootErr;

const { error: saveErr } = await sb.functions.invoke("save-payment-settings", {
  body: { pix_mode: "mercadopago", mp_access_token: token },
});

const { data: pix, error: pixErr } = await sb.functions.invoke("generate-pix-payment", {
  body: { amount: 0.01, description: "Smoke PIX real", externalReference: `smoke-${stamp}` },
});

const gerou = !!(pix?.configured && pix?.qrCode);

// A cobrança precisa ficar registrada, senão o webhook não descobre a loja.
const { data: cobranca } = await admin
  .from("pix_charges")
  .select("company_id,payment_id,purpose,amount")
  .eq("payment_id", String(pix?.paymentId || ""))
  .maybeSingle();

const registrou = cobranca?.company_id === company.id && cobranca?.purpose === "sale";

const referenciaComEmpresa = String(pix?.externalReference || "").startsWith(
  `mf:${company.id}:`,
);

let consultou = false;
if (gerou) {
  const { data: status } = await sb.functions.invoke("check-pix-payment", {
    body: { paymentId: pix.paymentId },
  });
  consultou = !!status?.status;
}

const ok = !saveErr && gerou && registrou && referenciaComEmpresa && consultou;
console.log(
  JSON.stringify(
    {
      ok,
      sandbox: pix?.sandbox ?? null,
      salvou_token: !saveErr ? "ok" : saveErr.message,
      gerou_qr_code: gerou,
      erro_geracao: pixErr?.message || pix?.error || null,
      cobranca_registrada: registrou,
      referencia_com_empresa: referenciaComEmpresa,
      consulta_de_status: consultou,
    },
    null,
    2,
  ),
);
process.exit(ok ? 0 : 1);
