/**
 * Smoke de mensagemDeErro(err, contexto): erro técnico vira mensagem útil; mensagem de negócio em português
 * passa como está; o erro original continua no console de quem chama. Nada de rede.
 *
 * Uso: node scripts/smoke-mensagem-erro.mjs
 */
import { readFileSync } from "fs";
import { resolve } from "path";
import {
  MSG_DADOS_INVALIDOS,
  MSG_DEMOROU,
  MSG_EM_USO,
  MSG_JA_EXISTE,
  MSG_SEM_CONEXAO,
  MSG_SERVIDOR_INDISPONIVEL,
  MSG_SESSAO_EXPIRADA,
  mensagemDeErro,
} from "../src/lib/mensagemErro.js";

const falhas = [];
const ok = [];
const check = (cond, msg) => (cond ? ok.push(msg) : falhas.push(msg));
const ler = (p) => readFileSync(resolve(process.cwd(), p), "utf8").split("\r\n").join("\n");
const e = (message, extra = {}) => Object.assign(new Error(message), extra);

// ---------- rede / servidor ----------
check(mensagemDeErro(e("Failed to send a request to the Edge Function"), "salvar o produto") === MSG_SEM_CONEXAO, "'Failed to send a request to the Edge Function' → sem conexão");
check(mensagemDeErro(e("Failed to fetch"), "x") === MSG_SEM_CONEXAO && mensagemDeErro(e("NetworkError when attempting to fetch resource."), "x") === MSG_SEM_CONEXAO && mensagemDeErro(e("Load failed"), "x") === MSG_SEM_CONEXAO, "fetch/NetworkError/Load failed → sem conexão");
check(mensagemDeErro(Object.assign(new Error("x"), { name: "FunctionsFetchError" }), "x") === MSG_SEM_CONEXAO, "FunctionsFetchError → sem conexão");
check(mensagemDeErro(e("Edge Function returned a non-2xx status code"), "x") === MSG_SERVIDOR_INDISPONIVEL && mensagemDeErro(e("boom", { status: 502 }), "x") === MSG_SERVIDOR_INDISPONIVEL, "non-2xx / HTTP 5xx → servidor indisponível");
check(mensagemDeErro(Object.assign(new Error("signal timed out"), { name: "TimeoutError" }), "x") === MSG_DEMOROU && mensagemDeErro(Object.assign(new Error("x"), { name: "AbortError" }), "x") === MSG_DEMOROU, "timeout/AbortError → demorou");

// ---------- sessão / permissão ----------
check(mensagemDeErro(e("JWT expired"), "x") === MSG_SESSAO_EXPIRADA && mensagemDeErro(e("invalid JWT: unable to parse"), "x") === MSG_SESSAO_EXPIRADA && mensagemDeErro(e("Not authenticated"), "x") === MSG_SESSAO_EXPIRADA && mensagemDeErro(e("x", { status: 401 }), "x") === MSG_SESSAO_EXPIRADA, "JWT expirado / não autenticado / 401 → sessão expirou");
check(mensagemDeErro(e("new row violates row-level security policy for table \"products\""), "salvar o produto") === "Você não tem permissão para salvar o produto.", "RLS → 'Você não tem permissão para <contexto>.'");
check(mensagemDeErro(e("x", { code: "42501" }), "remover a logo") === "Você não tem permissão para remover a logo." && mensagemDeErro(e("x", { status: 403 }), "criar o usuário") === "Você não tem permissão para criar o usuário.", "42501 e 403 → permissão, com o contexto da tela");

// ---------- banco ----------
check(mensagemDeErro(e("duplicate key value violates unique constraint \"products_code_key\"", { code: "23505" }), "salvar o produto") === MSG_JA_EXISTE, "23505 duplicado → 'Já existe um cadastro...'");
check(mensagemDeErro(e("update or delete on table violates foreign key constraint", { code: "23503" }), "x") === MSG_EM_USO, "23503 FK → registro em uso");
check(mensagemDeErro(e("null value in column \"name\" violates not-null constraint", { code: "23502" }), "x") === MSG_DADOS_INVALIDOS && mensagemDeErro(e("invalid input syntax for type uuid: \"abc\""), "x") === MSG_DADOS_INVALIDOS, "not-null / sintaxe inválida → dados inválidos");

// ---------- mensagem de negócio em português passa ----------
for (const m of ["Usuário sem empresa vinculada.", "Estoque insuficiente para ARROZ 5KG (disponível: 2).", "Preencha o nome do produto.", "Já existe um produto com este código de barras.", "Selecione ao menos um item."]) {
  check(mensagemDeErro(e(m), "salvar o produto") === m, `mensagem de negócio passa: "${m}"`);
}

// ---------- técnico nunca vai para a tela ----------
const tecnicas = [
  "TypeError: Cannot read properties of undefined (reading 'id')",
  "relation \"public.sales\" does not exist",
  "PGRST116: JSON object requested, multiple (or no) rows returned",
  "{\"code\":\"XX000\",\"message\":\"boom\"}",
  "supabase: unexpected response",
  "ECONNRESET at TLSSocket.onConnectEnd",
  "column \"foo\" of relation \"bar\" does not exist",
];
for (const m of tecnicas) {
  const r = mensagemDeErro(e(m), "salvar o produto");
  check(r === "Não foi possível salvar o produto. Tente novamente; se continuar, fale com o suporte." && !r.includes(m), `técnico vira frase genérica com o contexto: ${m.slice(0, 40)}…`);
}
check(mensagemDeErro(undefined, "salvar") === "Não foi possível salvar. Tente novamente; se continuar, fale com o suporte." && mensagemDeErro(null) === "Não foi possível concluir a operação. Tente novamente; se continuar, fale com o suporte." && mensagemDeErro("texto qualquer em ingles", "x").startsWith("Não foi possível"), "sem erro / sem mensagem / inglês solto → genérica, sem quebrar");
check(mensagemDeErro(e("Falha na gravação do cupom"), "x", { fallback: "Falha ao imprimir. Verifique a impressora em Configurações." }) === "Falha na gravação do cupom" && mensagemDeErro(e("TypeError: x is not a function"), "imprimir o cupom", { fallback: "Falha ao imprimir. Verifique a impressora em Configurações." }) === "Falha ao imprimir. Verifique a impressora em Configurações.", "fallback: a frase de impressão existente é mantida para erro técnico");
check(mensagemDeErro(e("x".repeat(300) + " não"), "x").startsWith("Não foi possível"), "texto enorme não vai para a tela");

// ---------- fiação nos 10 pontos ----------
const pontos = [
  ["src/components/config/AparenciaTab.jsx", 2],
  ["src/components/delivery/DeliveryOrderDialog.jsx", 1],
  ["src/components/products/GroupsDialog.jsx", 1],
  ["src/components/products/ProductDialog.jsx", 1],
  ["src/components/sales/SaleDetailDialog.jsx", 1],
  ["src/components/users/InviteDialog.jsx", 1],
  ["src/pages/Configuracoes.jsx", 1],
  ["src/pages/Inventario.jsx", 1],
  ["src/pages/PlanSelection.jsx", 1],
];
let total = 0;
for (const [arq, n] of pontos) {
  const t = ler(arq);
  const usos = (t.match(/toast\.error\(mensagemDeErro\(/g) || []).length;
  total += usos;
  // SaleDetailDialog também tem os toasts de XML/DANFE (fiscais, já claros): ficam como estão
  const fiscalMantido = arq.endsWith("SaleDetailDialog.jsx");
  const semMessageCru = fiscalMantido || !/toast\.error\((e|err|error)\??\.message/.test(t);
  check(usos >= n && t.includes('from "@/lib/mensagemErro"') && semMessageCru, `${arq}: usa mensagemDeErro${fiscalMantido ? " (toasts fiscais de XML/DANFE mantidos)" : " e não despeja e.message na tela"}`);
}
check(total === 10, `os 10 pontos identificados usam mensagemDeErro (${total})`);
// o erro técnico segue no console em todos
for (const [arq] of pontos) {
  const t = ler(arq);
  const blocos = [...t.matchAll(/catch \((\w+)\) \{([\s\S]{0,260}?)toast\.error\(mensagemDeErro\(/g)];
  check(blocos.length > 0 && blocos.every((b) => /console\.error\(/.test(b[2])), `${arq}: o erro original é logado no console antes do toast`);
}
const detalhe = ler("src/components/sales/SaleDetailDialog.jsx");
check(detalhe.includes('mensagemDeErro(e, "imprimir o cupom", { fallback: MSG_FALHA_IMPRESSAO })'), "impressão: a mensagem existente (MSG_FALHA_IMPRESSAO) segue sendo o fallback");
check(ler("src/lib/reimpressaoVenda.js").includes("Falha ao imprimir. Verifique a impressora em Configurações.") && !ler("src/lib/acoesFiscaisVenda.js").includes("mensagemDeErro"), "mensagens de impressão e fiscais existentes não foram trocadas");

console.log("\nSmoke — mensagemDeErro\n");
for (const m of ok) console.log(`  PASS  ${m}`);
for (const m of falhas) console.log(`  FAIL  ${m}`);
console.log(`\n${ok.length} passaram, ${falhas.length} falharam\n`);
process.exit(falhas.length ? 1 : 0);
