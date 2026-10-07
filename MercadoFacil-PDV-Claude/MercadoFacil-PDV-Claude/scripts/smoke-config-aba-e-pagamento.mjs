/**
 * Smoke de Configurações: aba na URL e aba Pagamento sem piscar nem salvar padrões (sem rede).
 *
 * 1. Aba ativa na URL (?aba=): valor válido fica, ausente/inválido cai em "empresa", trocar de aba
 *    mantém os outros parâmetros e não empilha histórico.
 * 2. Aba Pagamento: a primeira pintura vem do espelho local (smartpos já aparece como smartpos).
 * 3. Salvar só depois de ler o servidor: leitura estrita que LANÇA erro, e nenhum botão de salvar
 *    habilitado enquanto carrega ou se a carga falhar (comportamento no navegador: ver o PR).
 *
 * Uso: node scripts/smoke-config-aba-e-pagamento.mjs
 */
import { readFileSync } from "fs";
import { resolve } from "path";
import { register } from "node:module";
import { ABAS_CONFIGURACOES, abaDaUrl, paramsComAba } from "../src/lib/abasConfiguracoes.js";
import { estadoDaConfig, podeSalvarPagamento } from "../src/lib/pagamentoTabEstado.js";

const falhas = [];
const ok = [];
const check = (cond, msg) => (cond ? ok.push(msg) : falhas.push(msg));
const ler = (p) => readFileSync(resolve(process.cwd(), p), "utf8").split("\r\n").join("\n");

// ---------- 1. aba na URL ----------
check(
  ABAS_CONFIGURACOES.join(",") === "empresa,pagamento,vendas,fiscal,aparencia,suporte" && ABAS_CONFIGURACOES.every((a) => abaDaUrl(a) === a),
  "as 6 abas reais são aceitas como vieram na URL",
);
check(abaDaUrl("pagamento") === "pagamento", "?aba=pagamento fica em pagamento (é o que o F5 relê)");
check(
  [null, undefined, "", "xyz", "PAGAMENTO", "extras", "balanca", "etiqueta", "impressora", "financeiro", "__proto__", "constructor"].every((v) => abaDaUrl(v) === "empresa"),
  "valor ausente, inválido ou de painel flutuante (extras, balança, etiqueta…) cai em empresa",
);
check(paramsComAba("", "fiscal").toString() === "aba=fiscal", "trocar de aba escreve ?aba=<aba>");
check(paramsComAba("x=1&aba=empresa", "vendas").toString() === "x=1&aba=vendas", "trocar de aba preserva os outros parâmetros e troca só o aba");
check(paramsComAba(new URLSearchParams("aba=pagamento"), "inexistente").get("aba") === "empresa", "aba inválida nunca vai para a URL");

// ---------- 2. primeira pintura pelo espelho ----------
const smart = estadoDaConfig({ card_channel: "smartpos", card_enabled: true, pix_mode: "mercadopago", pix_key: "k", mp_token_hint: "1234" });
check(
  smart.cardChannel === "smartpos" && smart.canalSalvo === "smartpos" && smart.temSmartPos === true && smart.pixMode === "mercadopago" && smart.pixKey === "k" && smart.pixConfigured === true,
  "configuração com canal smartpos aparece como smartpos (e com Smart POS) já na primeira pintura, sem passar pelo padrão",
);
check(estadoDaConfig({ card_channel: "tef", tef_enabled: true, tef_agent_url: "http://agente:9" }).cardChannel === "tef", "canal tef gravado aparece como tef");
check(estadoDaConfig({ card_channel: "maquininha" }).cardChannel === "maquininha" && estadoDaConfig({ card_channel: "maquininha" }).temSmartPos === false, "canal maquininha gravado aparece como maquininha");
check(estadoDaConfig(null).cardChannel === "maquininha" && estadoDaConfig(undefined).pixMode === "manual" && estadoDaConfig({}).tefAgentUrl === "http://localhost:8080", "sem configuração, o padrão é o de antes (maquininha, PIX manual, agente local)");
check(estadoDaConfig({ card_channel: "smartpos" }, { temSmartPos: false }).temSmartPos === false, "o servidor manda: se ele diz que não há Smart POS vinculado, vale o servidor");
check(estadoDaConfig({ card_channel: "maquininha" }, { temSmartPos: true }).cardChannel === "maquininha", "Smart POS vinculado não troca o canal gravado");
check(estadoDaConfig({ card_enabled: false }).cardEnabled === false && estadoDaConfig({}).cardEnabled === true, "cartão desativado é respeitado; sem valor, ativado (como antes)");

// ---------- 3. só salva com a configuração real ----------
check(podeSalvarPagamento({ carregando: false, erroCarga: null }) === true, "carregou sem erro → pode salvar");
check(podeSalvarPagamento({ carregando: true, erroCarga: null }) === false, "carregando → não salva");
check(podeSalvarPagamento({ carregando: false, erroCarga: "rede" }) === false, "falha de carga → não salva");
check(podeSalvarPagamento({ carregando: true, erroCarga: "rede" }) === false, "carregando com erro antigo → não salva");

// leitura estrita do servidor, executada de verdade (api simulada)
// lê o mock a cada acesso: cada caso monta o seu
const mocks = { "@/api/dataClient": "export const api = new Proxy({}, { get: (_, k) => globalThis.__mockApi[k] });" };
const raiz = new URL("../src/", import.meta.url).href;
register(
  "data:text/javascript," +
    encodeURIComponent(`const mocks = ${JSON.stringify(mocks)};
export async function resolve(s, c, n) {
  if (mocks[s]) return { url: "data:text/javascript," + encodeURIComponent(mocks[s]), shortCircuit: true };
  if (s.startsWith("@/")) return { url: ${JSON.stringify(raiz)} + s.slice(2) + ".js", shortCircuit: true };
  return n(s, c);
}`),
);
const armazenamento = new Map();
globalThis.localStorage = { getItem: (k) => armazenamento.get(k) ?? null, setItem: (k, v) => armazenamento.set(k, String(v)) };
const montarApi = ({ me = { company_id: "c1" }, linhas = [], falha = null }) => {
  globalThis.__mockApi = {
    auth: { me: async () => { if (falha === "me") throw new Error("sem sessão"); return me; } },
    entities: { CompanyPaymentSettings: { filter: async () => { if (falha === "filter") throw new Error("rede"); return linhas; } } },
  };
};
montarApi({});
const { lerPaymentConfigDoServidor, syncPaymentConfig, getCachedPaymentConfig } = await import("../src/lib/paymentConfig.js");
const silencio = console.error;
console.error = () => {};

montarApi({ linhas: [{ company_id: "c1", card_channel: "smartpos", pix_mode: "mercadopago" }] });
let cfg = await lerPaymentConfigDoServidor();
check(cfg.card_channel === "smartpos" && getCachedPaymentConfig().card_channel === "smartpos", "leitura do servidor traz a configuração real e atualiza o espelho");
for (const falha of ["me", "filter"]) {
  montarApi({ falha });
  let erro = null;
  try {
    await lerPaymentConfigDoServidor();
  } catch (e) {
    erro = e;
  }
  check(erro instanceof Error, `falha na leitura (${falha === "me" ? "sessão" : "rede"}) LANÇA erro: a tela sabe que não carregou`);
}
montarApi({ me: { company_id: null } });
let semEmpresa = null;
try {
  await lerPaymentConfigDoServidor();
} catch (e) {
  semEmpresa = e;
}
check(semEmpresa instanceof Error, "sem empresa identificada também lança erro (não vira padrão)");
armazenamento.clear();
montarApi({ linhas: [] });
cfg = await lerPaymentConfigDoServidor();
check(cfg.card_channel === null && cfg.pix_mode === "manual", "empresa nova, sem linha ainda, é legítima: devolve o padrão (a tela libera salvar)");
montarApi({ falha: "filter" });
armazenamento.set("payment_config", JSON.stringify({ card_channel: "smartpos" }));
check((await syncPaymentConfig()).card_channel === "smartpos", "syncPaymentConfig (PDV, offline) continua devolvendo o espelho quando a leitura falha: comportamento antigo preservado");
console.error = silencio;
delete globalThis.localStorage;
delete globalThis.__mockApi;

// ---------- 4. código ----------
const pagina = ler("src/pages/Configuracoes.jsx");
check(
  pagina.includes('import { useSearchParams } from "react-router-dom";') &&
    pagina.includes('const activeTab = abaDaUrl(searchParams.get("aba"));') &&
    pagina.includes("setSearchParams((atuais) => paramsComAba(atuais, aba), { replace: true })"),
  "Configurações lê a aba da URL, e trocar de aba substitui a entrada do histórico (replace)",
);
check(!/useState\("empresa"\)/.test(pagina) && /<Tabs value=\{activeTab\} onValueChange=\{setActiveTab\}>/.test(pagina), "a aba deixou de viver só em useState; as abas continuam controladas");
check(
  ["extras", "balanca", "etiqueta", "impressora", "financeiro"].every((t) => pagina.includes(`target === "${t}"`)) && pagina.includes("openFloat(target);"),
  "os painéis flutuantes (extras, balança, etiqueta, impressora, financeiro) continuam como estavam",
);
const aba = ler("src/components/config/PagamentoTab.jsx");
check(aba.includes("useState(() => estadoDaConfig(getCachedPaymentConfig()))") && aba.includes("useState(inicial.cardChannel)") && aba.includes("useState(inicial.temSmartPos)"), "os estados da aba nascem do espelho local (nenhum valor padrão fixo no useState)");
check(!/useState\("maquininha"\)|useState\("mercadopago"\)\s*;?\s*\/\/ "mercadopago/.test(aba), 'o canal não nasce mais fixo em "maquininha"');
check(aba.includes("lerPaymentConfigDoServidor(),") && !aba.includes("syncPaymentConfig"), "a carga da aba é a leitura estrita (falha lança erro), não a que esconde o erro");
check(/listarSmartPos\(\)\.then\(\(rows\) => \(rows \|\| \[\]\)\.some\(\(r\) => r\.status === "vinculado"\)\),/.test(aba) && !/listarSmartPos\(\)[^\n]*\.catch\(\(\) => false\)/.test(aba), "falha ao listar o Smart POS também conta como falha de carga (não vira 'não vinculado')");
check(aba.split("disabled={salvando || bloqueadoSalvar}").length - 1 === 5 && !aba.includes("disabled={salvando}"), "TODOS os 5 botões de salvar ficam desabilitados enquanto carrega ou após falha");
const iSalvar = aba.indexOf("const salvar = async (campos, mensagem) => {");
check(iSalvar !== -1 && aba.slice(iSalvar, iSalvar + 400).includes("if (bloqueadoSalvar) {") && aba.indexOf("return null;", iSalvar) < aba.indexOf("setSalvando(true)", iSalvar), "o ponto único de gravação recusa salvar antes de qualquer chamada ao servidor");
check(aba.includes('role="status"') && aba.includes('role="alert"') && aba.includes("Tentar de novo") && aba.includes("setTentativaCarga((n) => n + 1)"), "a tela mostra 'carregando', o erro de carga e o 'Tentar de novo'");
check(aba.includes("return () => {\n      vivo = false;") && aba.includes("[tentativaCarga]"), "a carga ignora resposta de tela já fechada e pode ser repetida");

console.log("\nSmoke — aba na URL e Pagamento sem piscar nem salvar padrões\n");
for (const m of ok) console.log(`  PASS  ${m}`);
for (const m of falhas) console.log(`  FAIL  ${m}`);
console.log(`\n${ok.length} passaram, ${falhas.length} falharam\n`);
process.exit(falhas.length ? 1 : 0);
