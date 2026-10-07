/**
 * Smoke do RLS de UPDATE em storage.objects (public_bucket_update_own_company,
 * 064_storage_update_with_check.sql) — a policy tinha USING mas nenhum WITH
 * CHECK. Postgres só valida USING contra a linha ANTES do update; sem WITH
 * CHECK, o valor NOVO de `name` nunca era conferido. Um usuário dono de um
 * objeto na própria pasta (passa no USING) podia mover/renomear esse objeto
 * para dentro da pasta de OUTRA empresa.
 *
 * Complementa scripts/smoke-storage-rls.mjs (que já cobre INSERT/leitura/
 * bloqueio de INSERT cross-tenant, mas não testava UPDATE) — não o substitui.
 *
 * Uso: node scripts/smoke-storage-update-rls.mjs
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
  const email = `guarni07+mf.stgu.${tag}.${stamp}@gmail.com`;
  const password = `Stgu-${stamp}aA1!`;
  await admin.auth.admin.createUser({ email, password, email_confirm: true });
  const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  await sb.auth.signInWithPassword({ email, password });
  const { data: bootstrap } = await sb.rpc("bootstrap_company", { p_trade_name: `Stgu ${tag} ${stamp}`, p_email: email });
  const companyId = typeof bootstrap === "string" ? bootstrap : bootstrap?.id;
  return { sb, companyId, stamp };
}

const { sb: sbA, companyId: companyA, stamp } = await novaEmpresa("a");
const { companyId: companyB } = await novaEmpresa("b");

const conteudo = new Blob(["conteudo de teste"], { type: "text/plain" });
const caminhoA = `${companyA}/arquivo-${stamp}.txt`;

// 1. INSERT continua funcionando.
{
  const { error } = await sbA.storage.from("public").upload(caminhoA, conteudo, { upsert: true });
  check(!error, `INSERT (upload) dentro da própria empresa continua funcionando (${error?.message || "ok"})`);
}

// 2. Leitura continua pública.
{
  const { data } = sbA.storage.from("public").getPublicUrl(caminhoA);
  const resposta = await fetch(data.publicUrl);
  check(resposta.ok, `leitura pública continua funcionando (HTTP ${resposta.status})`);
}

// 3. UPDATE (mover/renomear) dentro da própria empresa → permitido.
{
  const destino = `${companyA}/arquivo-renomeado-${stamp}.txt`;
  const { error } = await sbA.storage.from("public").move(caminhoA, destino);
  check(!error, `UPDATE (mover) dentro da própria empresa é permitido (${error?.message || "ok"})`);
  await sbA.storage.from("public").move(destino, caminhoA);
}

// 4. UPDATE tentando mover para a pasta de OUTRA empresa → bloqueado (o gap
// que 064 fecha — antes, só o USING era checado, e isso passava).
{
  const destinoForaDaEmpresa = `${companyB}/invadido-${stamp}.txt`;
  const { error } = await sbA.storage.from("public").move(caminhoA, destinoForaDaEmpresa);
  check(!!error, `UPDATE tentando mover para pasta de outra empresa é bloqueado (${error ? "bloqueado" : "PASSOU — FALHA"})`);

  const { data: listaB } = await admin.storage.from("public").list(companyB);
  const vazou = (listaB || []).some((f) => f.name === `invadido-${stamp}.txt`);
  check(!vazou, "arquivo não foi parar na pasta de outra empresa");

  const { data: listaA } = await admin.storage.from("public").list(companyA);
  const continuaLa = (listaA || []).some((f) => f.name === `arquivo-${stamp}.txt`);
  check(continuaLa, "arquivo original continua na própria pasta após a tentativa recusada");
}

// 5. DELETE (policy irmã) sem regressão.
{
  const { error } = await sbA.storage.from("public").remove([caminhoA]);
  check(!error, `DELETE dentro da própria empresa continua funcionando (${error?.message || "ok"})`);
}

await admin.from("companies").delete().eq("id", companyA);
await admin.from("companies").delete().eq("id", companyB);

console.log("\nSmoke — RLS de UPDATE em storage.objects (public_bucket_update_own_company)\n");
for (const m of ok) console.log(`  PASS  ${m}`);
for (const m of falhas) console.log(`  FAIL  ${m}`);
console.log(`\n${ok.length} passaram, ${falhas.length} falharam\n`);
process.exit(falhas.length ? 1 : 0);
