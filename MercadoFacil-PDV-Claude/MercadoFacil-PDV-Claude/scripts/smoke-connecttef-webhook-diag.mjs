/**
 * Smoke do diagnóstico do 401 do connecttef-webhook (sem rede).
 *
 * O PR só ADICIONA um log seguro ao 401; a autenticação continua igual. Garante, no código:
 * a decisão de autenticar não mudou, o diagnóstico fica só no ramo recusado e dentro de try/catch,
 * nenhum console.* recebe token/secret/cabeçalho, e o helper nunca devolve valores sensíveis.
 * O comportamento real do helper está em supabase/functions/_shared/connecttefAuthDiag.test.ts (deno).
 *
 * Uso: node scripts/smoke-connecttef-webhook-diag.mjs
 */
import { readFileSync } from "fs";
import { resolve } from "path";

const falhas = [];
const ok = [];
const check = (cond, msg) => (cond ? ok.push(msg) : falhas.push(msg));
const ler = (p) => readFileSync(resolve(process.cwd(), p), "utf8").split("\r\n").join("\n");

const webhook = ler("supabase/functions/connecttef-webhook/index.ts");
const helper = ler("supabase/functions/_shared/connecttefAuthDiag.ts");

// ---------- 1. a autenticação não mudou ----------
check(
  webhook.includes('const esperado = (Deno.env.get("CONNECTTEF_WEBHOOK_TOKEN") || "").trim();') &&
    webhook.includes('return json({ error: "Webhook não configurado" }, 503);'),
  "secret ausente continua recusando tudo (503)",
);
check(
  webhook.includes('const recebido = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";') &&
    webhook.includes("if (!recebido || !(await tokensIguais(recebido, esperado))) {"),
  "a regra continua: só 'Bearer <token>' igual ao secret autentica (mesma comparação em tempo constante)",
);
const iRecusa = webhook.indexOf("if (!recebido || !(await tokensIguais(recebido, esperado))) {");
const iResposta401 = webhook.indexOf('return json({ error: "Não autorizado" }, 401);', iRecusa);
const iAdmin = webhook.indexOf("const admin = adminClient();");
check(iRecusa !== -1 && iResposta401 > iRecusa && iResposta401 < iAdmin, "token inválido continua respondendo 401 antes de qualquer acesso ao banco");
const bloco = webhook.slice(iRecusa, iResposta401);
check(!/return json\(\{[^}]*\},\s*20\d\)/.test(bloco) && !/\bresolve|aceita|autorizado = true/i.test(bloco), "o ramo recusado só diagnostica e responde 401: não aceita nada");

// ---------- 2. o diagnóstico é seguro e isolado ----------
check(/try \{[\s\S]*diagnosticarAutorizacao\([\s\S]*\} catch \{/.test(bloco), "o diagnóstico fica dentro de try/catch: uma falha dele nunca muda a resposta");
check(webhook.split("diagnosticarAutorizacao(").length === 2 && webhook.split("nomesDosCabecalhos(").length === 2, "o diagnóstico roda só no ramo recusado (uma chamada)");
const consoles = webhook.split("\n").filter((l) => /console\.(log|warn|error|info|debug)/.test(l));
const sensivel = /esperado|recebido|\bauth\b|authorization|req\.headers\.get|Deno\.env/i;
check(consoles.every((l) => !sensivel.test(l)), "nenhum console.* do webhook recebe token, secret, Authorization ou variável de ambiente");
check(webhook.includes('console.warn("connecttef-webhook: 401", JSON.stringify({ ...diagnostico, cabecalhos: nomesDosCabecalhos(req.headers) }));'), "o log do 401 imprime só o diagnóstico (booleanos, tamanhos, esquema) e os nomes dos cabeçalhos");

// ---------- 3. o helper ----------
const codigoHelper = helper.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
check(!/console\.|fetch\(|Deno\.|import /.test(codigoHelper), "o helper é puro: sem log, rede, ambiente nem imports");
check(/ESQUEMAS_CONHECIDOS = \["bearer", "basic", "token", "apikey", "api-key"\]/.test(helper), "o nome do esquema só aparece se estiver numa lista fixa (senão 'outro')");
const retorno = codigoHelper.match(/return \{\n([\s\S]*?)\n  \};/)?.[1] || "";
const linhas = retorno.split("\n").map((l) => l.trim()).filter(Boolean);
const campos = linhas.map((l) => l.replace(/[:,].*$/, ""));
check(
  JSON.stringify(campos) === JSON.stringify(["presente", "esquema", "tamanhoRecebido", "tamanhoEsperado", "tamanhosIguais", "comEspacoInterno", "comAspasNasPontas", "valorBate", "cabecalhoInteiroBate", "valorSemAspasBate"]) &&
    !linhas.some((l) => /^(valor|bruto|esperado|authorization|partes)\b,?$/.test(l)) &&
    !linhas.some((l) => /:\s*(valor|bruto|esperado|authorization)\s*,?$/.test(l)),
  "o objeto devolvido tem só os campos seguros (booleanos, tamanhos, esquema) e nenhum carrega o valor recebido nem o secret",
);
check(helper.includes("headers.keys()") && !helper.includes("headers.get(") && !helper.includes("headers.values(") && !helper.includes("headers.entries("), "dos cabeçalhos saem só os nomes, nunca os valores");

console.log("\nSmoke — diagnóstico seguro do 401 do connecttef-webhook\n");
for (const m of ok) console.log(`  PASS  ${m}`);
for (const m of falhas) console.log(`  FAIL  ${m}`);
console.log(`\n${ok.length} passaram, ${falhas.length} falharam\n`);
process.exit(falhas.length ? 1 : 0);
