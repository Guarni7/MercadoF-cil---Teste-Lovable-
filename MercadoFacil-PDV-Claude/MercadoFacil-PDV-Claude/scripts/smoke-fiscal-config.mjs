/**
 * Smoke da tela Configurações → Fiscal.
 *
 * A tela não grava mais direto no banco nem no localStorage: ela chama a Edge
 * Function save-fiscal-settings, que é quem valida certificado, confere CNPJ e
 * decide se pode ligar produção. Este smoke exercita o mesmo caminho que o
 * navegador percorre.
 *
 * Verifica:
 *  1. Simples Nacional grava e volta com CRT 1 e documentos habilitados;
 *  2. MEI grava com CRT 4 e o escopo (mercadoria/serviço) que muda o documento;
 *  3. produção sem certificado é recusada com o motivo, não aceita em silêncio;
 *  4. operador de caixa não altera CNPJ nem ambiente de emissão;
 *  5. o diagnóstico responde item a item, sem verde sem checagem;
 *  6. a gravação fica registrada na trilha de auditoria fiscal;
 *  7. a tela nunca recebe certificado nem senha de volta.
 *
 * Uso: node scripts/smoke-fiscal-config.mjs
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
const BASE = `${env.VITE_SUPABASE_URL.replace(/\/$/, "")}/functions/v1/save-fiscal-settings`;
const DIAG = `${env.VITE_SUPABASE_URL.replace(/\/$/, "")}/functions/v1/fiscal-diagnostics`;

const falhas = [];
const ok = [];
const check = (cond, msg) => (cond ? ok.push(msg) : falhas.push(msg));

async function novoUsuario(tag) {
  const stamp = Date.now() + Math.floor(Math.random() * 1000);
  const email = `guarni07+mf.fisconf.${tag}.${stamp}@gmail.com`;
  const password = `Fisc-${stamp}aA1!`;
  await admin.auth.admin.createUser({ email, password, email_confirm: true });
  const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data } = await sb.auth.signInWithPassword({ email, password });
  return { sb, email, token: data.session.access_token, userId: data.user.id };
}

async function chamar(url, token, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: env.VITE_SUPABASE_ANON_KEY,
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body || {}),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  return { status: res.status, json };
}

// Dono da loja
const dono = await novoUsuario("dono");
const { data: empresa, error: erroEmpresa } = await dono.sb.rpc("bootstrap_company", {
  p_trade_name: `Fiscal Config ${Date.now()}`,
  p_email: dono.email,
});
if (erroEmpresa) {
  console.error("Não foi possível criar a empresa de teste:", erroEmpresa.message);
  process.exit(1);
}
const companyId = typeof empresa === "string" ? empresa : empresa?.id;

// 1. Simples Nacional
const simples = await chamar(BASE, dono.token, {
  cnpj: "11222333000181",
  legal_name: "Mercado Smoke Fiscal Ltda",
  trade_name: "Mercado Smoke",
  ie: "0011223344556",
  im: "9988776",
  uf: "MG",
  city_name: "Belo Horizonte",
  city_ibge_code: "3106200",
  cnae_main: "4711302",
  tax_regime: "simples",
  crt: "1",
  taxpayer_type: "contribuinte",
  environment: "homologacao",
  nfce_enabled: true,
  nfse_enabled: true,
  address: "Rua do Comércio",
  address_number: "100",
  neighborhood: "Centro",
  cep: "30110000",
});
check(
  simples.status === 200 && simples.json?.settings?.crt === "1",
  `Simples Nacional grava pela Edge Function (status ${simples.status}${
    simples.json?.error ? `: ${simples.json.error}` : ""
  })`,
);
check(
  simples.json?.settings?.nfce_enabled === true && simples.json?.settings?.nfse_enabled === true,
  "documentos habilitados voltam marcados na resposta",
);
check(
  simples.json?.settings?.city_ibge_code === "3106200",
  "código IBGE do município persiste (campo obrigatório no XML)",
);

// A tela lê com a sessão do usuário, não com service role.
const { data: lido } = await dono.sb
  .from("company_fiscal_settings")
  .select("*")
  .eq("company_id", companyId)
  .maybeSingle();
check(lido?.cnpj === "11222333000181", "a tela relê a configuração com a sessão do lojista");
check(
  !("certificate_pfx" in (lido || {})) && !("certificate_password" in (lido || {})),
  "certificado e senha não existem na tabela que a tela lê",
);

// 2. MEI
const mei = await chamar(BASE, dono.token, {
  tax_regime: "mei",
  crt: "4",
  mei_scope: "ambos",
});
check(
  mei.status === 200 && mei.json?.settings?.crt === "4" && mei.json?.settings?.mei_scope === "ambos",
  `MEI grava com CRT 4 e escopo mercadorias+serviços (status ${mei.status}${
    mei.json?.error ? `: ${mei.json.error}` : ""
  })`,
);

// 3. Produção sem certificado
const producao = await chamar(BASE, dono.token, { environment: "producao" });
check(
  producao.status === 422 && /certificado/i.test(producao.json?.error || ""),
  `produção sem certificado é recusada com o motivo (status ${producao.status}: ${
    producao.json?.error || "sem mensagem"
  })`,
);

const { data: aposTentativa } = await admin
  .from("company_fiscal_settings")
  .select("environment")
  .eq("company_id", companyId)
  .maybeSingle();
check(
  aposTentativa?.environment === "homologacao",
  "a recusa não deixou o ambiente meio trocado no banco",
);

// 4. Operador de caixa não altera fiscal
const caixa = await novoUsuario("caixa");
await admin
  .from("profiles")
  .update({ company_id: companyId, company_role: "cashier", role: "user" })
  .eq("id", caixa.userId);

const tentativaCaixa = await chamar(BASE, caixa.token, { cnpj: "99888777000166" });
check(
  tentativaCaixa.status === 403,
  `operador de caixa não altera a configuração fiscal (status ${tentativaCaixa.status})`,
);

const { data: cnpjIntacto } = await admin
  .from("company_fiscal_settings")
  .select("cnpj")
  .eq("company_id", companyId)
  .maybeSingle();
check(cnpjIntacto?.cnpj === "11222333000181", "CNPJ do emitente continua o do dono");

// 5. Sem autenticação nenhuma
const semAuth = await fetch(BASE, {
  method: "POST",
  headers: { "Content-Type": "application/json", apikey: env.VITE_SUPABASE_ANON_KEY },
  body: JSON.stringify({ cnpj: "00000000000000" }),
});
check(semAuth.status === 401, `requisição sem sessão é barrada (status ${semAuth.status})`);

// 6. Diagnóstico item a item
const diag = await chamar(DIAG, dono.token, {});
const itens = diag.json?.items || [];
const porId = Object.fromEntries(itens.map((i) => [i.id, i]));
check(diag.status === 200 && itens.length > 0, `diagnóstico responde com itens (${itens.length})`);
check(
  porId.certificate?.status === "pendente",
  `sem certificado o diagnóstico diz pendente, não configurado (${porId.certificate?.status})`,
);
check(
  porId.mtls?.status === "configurado",
  `runtime confirma suporte a mTLS (${porId.mtls?.status}: ${porId.mtls?.detail})`,
);
check(
  porId.tax_rules?.status === "pendente",
  "sem regra tributária vigente o diagnóstico avisa que a emissão será recusada",
);
// O diagnóstico tem que espelhar o banco, não um estado esperado: antes da
// importação a tabela oficial aparece como pendente; depois, como carregada com
// a contagem. Dizer "configurado" com a tabela vazia seria pior que não ter o
// item.
const { count: classTribNoBanco } = await admin
  .from("fiscal_class_trib_codes")
  .select("*", { count: "exact", head: true });

check(
  (classTribNoBanco ?? 0) > 0
    ? porId.class_trib?.status === "configurado" &&
        porId.class_trib?.detail?.includes(String(classTribNoBanco))
    : porId.class_trib?.status === "pendente",
  `diagnóstico da tabela cClassTrib reflete o banco (${classTribNoBanco ?? 0} códigos: ${porId.class_trib?.status})`,
);
check(
  diag.json?.status === "pendente" || diag.json?.status === "erro",
  `status geral reflete o pior item (${diag.json?.status})`,
);

// 7. Trilha de auditoria
const { data: auditoria } = await admin
  .from("fiscal_audit_log")
  .select("operation, user_id")
  .eq("company_id", companyId)
  .order("created_at", { ascending: false });
check(
  (auditoria || []).some((a) => a.operation === "settings_update"),
  `gravação fiscal fica registrada na auditoria (${(auditoria || []).length} entradas)`,
);
check(
  (auditoria || []).every((a) => a.user_id),
  "toda entrada de auditoria tem o usuário responsável",
);

// Limpeza
await admin.from("companies").delete().eq("id", companyId);
await admin.auth.admin.deleteUser(dono.userId).catch(() => {});
await admin.auth.admin.deleteUser(caixa.userId).catch(() => {});

console.log("\nSmoke fiscal — configuração pela tela\n");
for (const m of ok) console.log(`  PASS  ${m}`);
for (const m of falhas) console.log(`  FAIL  ${m}`);
console.log(`\n${ok.length} passaram, ${falhas.length} falharam\n`);
process.exit(falhas.length ? 1 : 0);
