/**
 * Smoke da duplicidade de emissão fiscal (fiscal-emit) — mesma venda não pode
 * gerar duas NFC-e/NF-e.
 *
 * Cobre:
 *  1. 1ª emissão sem documento prévio — segue normalmente (não bloqueada);
 *  2. 2ª tentativa depois que a 1ª terminou em erro/rejeitada (terminal) —
 *     retry legítimo, não bloqueado;
 *  3. duplo clique (duas requisições simultâneas para a mesma venda) — só uma
 *     cria o rascunho, a outra recebe 409 com o documento vencedor
 *     (fiscal_documents_sale_active_idx, 061);
 *  4. documento existente em 'pending' — bloqueia com 409;
 *  5. documento existente em 'transmitting' — bloqueia com 409;
 *  6. documento existente em 'authorized' — devolve o documento existente
 *     (status 200, already_authorized: true), não cria um novo;
 *  7. venda diferente — não é afetada pelo documento da outra venda.
 *
 * Não testa transmissão real à SEFAZ (sem certificado/CSC de empresa real) —
 * os estados pending/transmitting/authorized usados nos testes 4-6 são
 * inseridos diretamente via service role, para isolar exatamente a regra de
 * duplicidade sem depender do autorizador.
 *
 * Uso: node scripts/smoke-fiscal-emit-duplicidade.mjs
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
const email = `guarni07+mf.dupfiscal.${stamp}@gmail.com`;
const password = `Dup-${stamp}aA1!`;
await admin.auth.admin.createUser({ email, password, email_confirm: true });
const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
await sb.auth.signInWithPassword({ email, password });
const { data: bootstrap } = await sb.rpc("bootstrap_company", { p_trade_name: `Dup ${stamp}`, p_email: email });
const companyId = typeof bootstrap === "string" ? bootstrap : bootstrap?.id;

const novaVenda = async (tag) => {
  const { data, error } = await admin
    .from("sales")
    .insert({
      company_id: companyId,
      client_id: `dup-${tag}-${stamp}`,
      items: [{ product_id: null, name: "Item", price: 10, quantity: 1, total: 10 }],
      total: 10,
      payment_method: "dinheiro",
      status: "concluida",
    })
    .select()
    .single();
  if (error) throw error;
  return data;
};

const emitir = async (saleId) => {
  const { data, error } = await sb.functions.invoke("fiscal-emit", {
    body: { model: "65", sale_id: saleId },
  });
  if (data) return { status: 0, ...data };
  try {
    return { status: error.context?.status || 0, ...(await error.context.json()) };
  } catch {
    return { status: error.context?.status || 0, error: error?.message };
  }
};

// 1. 1ª emissão — sem documento prévio, não bloqueada (sem fiscal settings
// configuradas nesta empresa de teste, termina em erro de validação — o que
// importa aqui é que NÃO é um bloqueio de duplicidade).
const vendaA = await novaVenda("a");
const primeira = await emitir(vendaA.id);
check(
  primeira.error !== `Já existe uma emissão em andamento para esta venda${primeira.status ? "" : ""}` &&
    !String(primeira.error || "").startsWith("Já existe uma emissão"),
  `1ª emissão não é bloqueada por duplicidade (${JSON.stringify({ status: primeira.status, error: primeira.error })})`
);

// 2. 2ª tentativa depois que a 1ª terminou em estado terminal (error/rejected)
// — precisa ser tentativa legítima, não bloqueio de duplicidade.
const { data: docA } = await admin
  .from("fiscal_documents")
  .select("status")
  .eq("sale_id", vendaA.id)
  .order("created_at", { ascending: false })
  .limit(1)
  .maybeSingle();
check(
  docA && ["error", "rejected"].includes(docA.status),
  `1º documento terminou em estado terminal, liberando retry (${docA?.status})`
);
const segunda = await emitir(vendaA.id);
check(
  !String(segunda.error || "").startsWith("Já existe uma emissão"),
  `2ª tentativa após estado terminal não é bloqueada (retry legítimo) (${JSON.stringify({ status: segunda.status, error: segunda.error })})`
);

// 3. Duplo clique — duas requisições simultâneas para a mesma venda.
//
// Uma corrida via HTTP real (Promise.all de duas chamadas fiscal-emit) não é
// determinística neste ambiente de teste: sem certificado/config fiscal a
// validação falha rápido demais (poucos ms) para garantir overlap real entre
// as duas requisições — as duas terminam em 'error' (terminal, fora do
// índice) antes que a segunda tente inserir enquanto a primeira ainda está
// ativa, o que não prova nada sobre a proteção de concorrência em si.
// O mecanismo real que impede duplicidade sob concorrência é o índice único
// parcial (061_fiscal_documents_sale_unique.sql) — testado aqui direto, com
// dois inserts simultâneos de verdade (mesma corrida que duas requisições
// fiscal-emit fariam na linha 229-248 do index.ts, no insert do rascunho).
const vendaB = await novaVenda("b");
const draftPayload = (extra) => ({
  company_id: companyId,
  model: "65",
  environment: "homologacao",
  status: "draft",
  sale_id: vendaB.id,
  items: [],
  ...extra,
});
const [insert1, insert2] = await Promise.all([
  admin.from("fiscal_documents").insert(draftPayload()).select().single(),
  admin.from("fiscal_documents").insert(draftPayload()).select().single(),
]);
const sucessos = [insert1, insert2].filter((r) => !r.error).length;
const violacoesUnicidade = [insert1, insert2].filter((r) => r.error?.code === "23505").length;
check(sucessos === 1, `duplo clique: exatamente 1 dos 2 inserts simultâneos de rascunho é aceito (aceitos: ${sucessos})`);
check(violacoesUnicidade === 1, `o outro é rejeitado por unique_violation no índice de duplicidade (23505) (rejeitados: ${violacoesUnicidade})`);
const { data: docsB } = await admin.from("fiscal_documents").select("id").eq("sale_id", vendaB.id);
check(docsB.length === 1, `duplo clique: só 1 documento fiscal existe para a venda (${docsB.length})`);

// A chamada real via edge function, para o mesmo cenário, deve devolver 409
// (não criar um segundo rascunho) — confirma que fiscal-emit também respeita
// o documento já em andamento (mesmo sem depender de vencer a corrida).
const apósCorrida = await emitir(vendaB.id);
check(
  String(apósCorrida.error || "").startsWith("Já existe uma emissão"),
  `nova chamada para a mesma venda, com rascunho ativo, é bloqueada (${JSON.stringify(apósCorrida)})`
);

// 4. Documento existente em 'pending' bloqueia nova emissão.
const vendaC = await novaVenda("c");
await admin.from("fiscal_documents").insert({
  company_id: companyId,
  model: "65",
  environment: "homologacao",
  status: "pending",
  sale_id: vendaC.id,
  items: [],
});
const tentativaPending = await emitir(vendaC.id);
check(
  tentativaPending.status === "pending" && String(tentativaPending.error || "").startsWith("Já existe uma emissão"),
  `documento 'pending' bloqueia nova emissão (${JSON.stringify(tentativaPending)})`
);

// 5. Documento existente em 'transmitting' bloqueia nova emissão.
const vendaD = await novaVenda("d");
await admin.from("fiscal_documents").insert({
  company_id: companyId,
  model: "65",
  environment: "homologacao",
  status: "transmitting",
  sale_id: vendaD.id,
  items: [],
});
const tentativaTransmitting = await emitir(vendaD.id);
check(
  tentativaTransmitting.status === "transmitting",
  `documento 'transmitting' bloqueia nova emissão (${JSON.stringify(tentativaTransmitting)})`
);

// 6. Documento existente em 'authorized' devolve o mesmo documento, sem criar novo.
const vendaE = await novaVenda("e");
const { data: docAutorizado } = await admin
  .from("fiscal_documents")
  .insert({
    company_id: companyId,
    model: "65",
    environment: "homologacao",
    status: "authorized",
    sale_id: vendaE.id,
    protocol: "123456789012345",
    access_key: "1".repeat(44),
    authorized_at: new Date().toISOString(),
    items: [],
  })
  .select()
  .single();
const tentativaAutorizado = await emitir(vendaE.id);
check(
  tentativaAutorizado.status === "authorized" && tentativaAutorizado.already_authorized === true,
  `documento 'authorized' é devolvido em vez de reemitir (${JSON.stringify(tentativaAutorizado)})`
);
check(
  tentativaAutorizado.document_id === docAutorizado.id,
  "documento devolvido é exatamente o já autorizado (mesmo id)"
);
const { data: docsE } = await admin.from("fiscal_documents").select("id").eq("sale_id", vendaE.id);
check(docsE.length === 1, `nenhum documento novo foi criado para a venda já autorizada (${docsE.length})`);

// 7. Venda diferente não é afetada pelo bloqueio de outra venda.
const vendaF = await novaVenda("f");
const tentativaOutraVenda = await emitir(vendaF.id);
check(
  !String(tentativaOutraVenda.error || "").startsWith("Já existe uma emissão"),
  `venda diferente (sem documento próprio) não é bloqueada (${JSON.stringify({ status: tentativaOutraVenda.status, error: tentativaOutraVenda.error })})`
);

await admin.from("companies").delete().eq("id", companyId);

console.log("\nSmoke — duplicidade de emissão fiscal (fiscal-emit)\n");
for (const m of ok) console.log(`  PASS  ${m}`);
for (const m of falhas) console.log(`  FAIL  ${m}`);
console.log(`\n${ok.length} passaram, ${falhas.length} falharam\n`);
process.exit(falhas.length ? 1 : 0);
