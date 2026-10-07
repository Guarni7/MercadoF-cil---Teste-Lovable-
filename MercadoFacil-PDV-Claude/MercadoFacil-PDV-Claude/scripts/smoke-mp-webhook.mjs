/**
 * Smoke do webhook Mercado Pago — caminhos de recusa.
 *
 * O webhook agora resolve a loja pela cobrança registrada em pix_charges e só
 * então valida a assinatura com o segredo daquela loja. Um POST forjado não
 * pode fechar venda de ninguém, então checamos três recusas:
 *   1. id de pagamento sem formato válido → 400;
 *   2. pagamento que não existe em pix_charges → não identifica a loja;
 *   3. cobrança real de uma loja sem assinatura válida → recusa.
 *
 * Uso: node scripts/smoke-mp-webhook.mjs
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
const url = `${env.VITE_SUPABASE_URL.replace(/\/$/, "")}/functions/v1/mercadopago-webhook`;

async function chamar(payload) {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: env.VITE_SUPABASE_ANON_KEY,
    },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text.slice(0, 200) };
  }
  return { status: res.status, body };
}

const idInvalido = await chamar({ type: "payment", data: { id: "smoke-invalid-0" } });
const okIdInvalido = idInvalido.status === 400;

// Pagamento sem cobrança registrada: não dá para saber a loja, então nada é
// confirmado. A resposta fica em 2xx de propósito, para o Mercado Pago não
// ficar reenviando uma notificação que nunca vai casar.
const desconhecido = await chamar({ type: "payment", data: { id: 999999999999 } });
const okDesconhecido = /loja não identificada|loja nao identificada/i.test(
  JSON.stringify(desconhecido.body),
);

// Cobrança real de uma loja, mas sem x-signature: precisa recusar.
const service = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const { data: empresa } = await service.from("companies").select("id").limit(1).maybeSingle();

let semAssinatura = { status: 0, body: null };
let okSemAssinatura = false;
// O webhook exige id numérico (é o formato do Mercado Pago), então a cobrança
// de teste também precisa de um.
const paymentId = String(9_000_000_000_000 + (Date.now() % 1_000_000_000));
if (empresa?.id) {
  await service.from("pix_charges").insert({
    company_id: empresa.id,
    payment_id: paymentId,
    external_reference: `mf:${empresa.id}:smoke`,
    amount: 1,
    status: "pending",
  });
  semAssinatura = await chamar({ type: "payment", data: { id: paymentId } });
  okSemAssinatura =
    semAssinatura.status >= 400 &&
    /assinatura|webhook não configurado|webhook nao configurado/i.test(
      JSON.stringify(semAssinatura.body),
    );
  await service.from("pix_charges").delete().eq("payment_id", paymentId);
}

const ok = okIdInvalido && okDesconhecido && okSemAssinatura;
console.log(
  JSON.stringify(
    {
      ok,
      id_invalido_recusado: okIdInvalido,
      pagamento_sem_cobranca_recusado: okDesconhecido,
      cobranca_sem_assinatura_recusada: okSemAssinatura,
      respostas: { idInvalido, desconhecido, semAssinatura },
      next: ok
        ? "Recusas OK. Teste real exige token e secret cadastrados pela loja."
        : "Resposta inesperada — revisar webhook",
    },
    null,
    2,
  ),
);
process.exit(ok ? 0 : 1);
