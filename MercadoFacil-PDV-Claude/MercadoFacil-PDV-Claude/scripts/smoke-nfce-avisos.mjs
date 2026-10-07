/**
 * Smoke dos avisos da NFC-e no detalhe da venda: o que o operador lê quando NÃO há botão de emitir.
 * Só exibição (sem rede, sem SEFAZ, sem emissão): a lógica fiscal de acoesFiscaisVenda.js não muda.
 *
 * Uso: node scripts/smoke-nfce-avisos.mjs
 */
import { readFileSync } from "fs";
import { resolve } from "path";
import {
  ACAO_FISCAL,
  MSG_CONFIG_FISCAL_INDISPONIVEL,
  MSG_NFCE_DESATIVADA,
  MSG_NFCE_NAO_CONFIGURADA,
  MSG_VENDA_AGUARDANDO_SYNC,
  analisarNfceDaVenda,
  avisoNfceDaVenda,
  vendaSincronizada,
} from "../src/lib/acoesFiscaisVenda.js";

const falhas = [];
const ok = [];
const check = (cond, msg) => (cond ? ok.push(msg) : falhas.push(msg));
const ler = (p) => readFileSync(resolve(process.cwd(), p), "utf8").split("\r\n").join("\n");

const UUID = "11111111-2222-4333-8444-555555555555";
const vendaOk = { id: UUID, status: "concluida" };
const vendaOffline = { id: "local-sale-17", status: "concluida" };
const cfgLigada = { nfce_enabled: true };
const cfgDesligada = { nfce_enabled: false };
const aviso = (docs, sale, { config, configFalhou, carregando } = {}) => {
  const nfceHabilitada = !!config?.nfce_enabled && !configFalhou;
  return avisoNfceDaVenda(analisarNfceDaVenda(docs, sale, { nfceHabilitada }), { sale, config, configFalhou, carregando });
};

check(vendaSincronizada(vendaOk) && !vendaSincronizada(vendaOffline) && !vendaSincronizada({}) && !vendaSincronizada(null), "venda sincronizada = id UUID do servidor");

// ---------- os três avisos pedidos ----------
const a = aviso([], vendaOk, { config: cfgDesligada });
check(a?.codigo === "desativada" && a.mensagem === MSG_NFCE_DESATIVADA && /Configurações > Fiscal/.test(a.mensagem) && a.podeTentarDeNovo === false, "NFC-e desativada → aviso que diz onde ativar");
check(aviso([], vendaOk, { config: null })?.mensagem === MSG_NFCE_NAO_CONFIGURADA, "empresa sem configuração fiscal → aviso de 'ainda não configurada' (diferente de desativada)");
const f = aviso([], vendaOk, { configFalhou: true });
check(f?.codigo === "config_indisponivel" && f.mensagem === MSG_CONFIG_FISCAL_INDISPONIVEL && f.podeTentarDeNovo === true && /Nada foi enviado à SEFAZ/.test(f.mensagem), "configuração não carregou → aviso claro, com 'Tentar novamente', sem enviar nada");
const s = aviso([], vendaOffline, { config: cfgLigada });
check(s?.codigo === "aguardando_sincronizacao" && s.mensagem === MSG_VENDA_AGUARDANDO_SYNC && s.podeTentarDeNovo === false, "venda offline ainda não sincronizada → 'aguardando sincronização'");
check(aviso([], vendaOffline, { config: cfgDesligada })?.codigo === "aguardando_sincronizacao" && aviso([], vendaOffline, { configFalhou: true })?.codigo === "aguardando_sincronizacao", "aguardando sincronização vale sobre os outros avisos (é o que impede a emissão primeiro)");

// ---------- quando NÃO avisa ----------
check(aviso([], vendaOk, { config: cfgLigada }) === null, "NFC-e ligada e venda sincronizada: sem aviso (o botão Emitir NFC-e aparece)");
check(aviso([], vendaOk, { config: cfgDesligada, carregando: true }) === null && aviso([], vendaOk, { configFalhou: true, carregando: true }) === null, "enquanto a configuração carrega não afirma nada (sem aviso piscando)");
check(aviso([], { id: UUID, status: "cancelada" }, { config: cfgDesligada }) === null, "venda cancelada: sem aviso");
for (const status of ["authorized", "transmitting", "rejected", "error", "pending", "cancelled"]) {
  const doc = { model: "65", status, access_key: "5".repeat(44), rejection_code: "539", xml_signed: status === "error" ? "<Signature/>" : null };
  check(aviso([doc], vendaOk, { config: cfgDesligada }) === null && aviso([doc], vendaOk, { configFalhou: true }) === null, `com documento '${status}' o aviso não interfere (o detalhe já explica)`);
}

// ---------- a lógica fiscal não mudou ----------
check(analisarNfceDaVenda([], vendaOk, { nfceHabilitada: false }).acao === ACAO_FISCAL.NENHUMA && analisarNfceDaVenda([], vendaOk, { nfceHabilitada: true }).acao === ACAO_FISCAL.EMITIR, "analisarNfceDaVenda: sem documento continua EMITIR (ligada) / NENHUMA (desligada)");
check(analisarNfceDaVenda([{ model: "65", status: "authorized" }], vendaOk).acao === ACAO_FISCAL.AUTORIZADA, "analisarNfceDaVenda: autorizada continua AUTORIZADA");

// ---------- fiação ----------
const dialog = ler("src/components/sales/SaleDetailDialog.jsx");
check(dialog.includes("avisoNfceDaVenda(analise,") && dialog.includes('data-testid="aviso-nfce"') && dialog.includes("Tentar novamente"), "detalhe da venda mostra o aviso (com 'Tentar novamente' quando cabe)");
check(dialog.includes("carregarConfigFiscal().catch((e) => {") && dialog.includes("console.error(\"Falha ao carregar a configuração fiscal:\", e)") && dialog.includes("__falhou"), "falha ao ler a configuração não vira mais 'desativada' em silêncio; o erro técnico vai ao console");
check(/emissaoAguardaSync = analise\.acao === ACAO_FISCAL\.EMITIR && !vendaSincronizada\(sale\)/.test(dialog) && dialog.includes("disabled={emissaoAguardaSync}"), "Emitir NFC-e fica desabilitado para venda que o servidor ainda não conhece");
check(!/nfce_enabled\s*[:=]\s*true|setNfceHab\(true\)|update\(.*nfce_enabled/.test(dialog + ler("src/lib/acoesFiscaisVenda.js")), "nada liga a NFC-e automaticamente");
check(!/^import /m.test(ler("src/lib/acoesFiscaisVenda.js")), "o módulo de ações é puro (sem imports): não chama emissão nem SEFAZ");

console.log("\nSmoke — avisos da NFC-e no detalhe da venda\n");
for (const m of ok) console.log(`  PASS  ${m}`);
for (const m of falhas) console.log(`  FAIL  ${m}`);
console.log(`\n${ok.length} passaram, ${falhas.length} falharam\n`);
process.exit(falhas.length ? 1 : 0);
