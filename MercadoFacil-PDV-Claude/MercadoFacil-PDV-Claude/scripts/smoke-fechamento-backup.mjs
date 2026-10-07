/**
 * Smoke do fechamento com backup (sem Electron, sem banco, sem rede):
 *
 *   electron/closeFlow.cjs        — o main segura o fechamento, pergunta ao renderer e não fica preso.
 *   src/lib/fechamentoComBackup.js — limite de tempo do backup, máquina de estados do diálogo, pendências de sync.
 *   Fiação — main/preload/host: backup → fechamento (ou reinício para instalar), nunca o contrário.
 *
 * Uso: node scripts/smoke-fechamento-backup.mjs
 */
import { readFileSync } from "fs";
import { createRequire } from "module";
import { resolve } from "path";
import { MSG_BACKUP_DEMOROU, MSG_BACKUP_NAO_SUBSTITUI_SYNC, contarPendenciasDeSync, executarBackupComLimite, proximoEstado } from "../src/lib/fechamentoComBackup.js";

const require = createRequire(import.meta.url);
const { createCloseFlow } = require("../electron/closeFlow.cjs");

const falhas = [];
const ok = [];
const check = (cond, msg) => (cond ? ok.push(msg) : falhas.push(msg));
const ler = (p) => readFileSync(resolve(process.cwd(), p), "utf8").split("\r\n").join("\n");

// ---------- closeFlow (processo main) ----------
function novoFluxo(extra = {}) {
  const log = { enviados: [], fechou: 0, agenda: [] };
  const flow = createCloseFlow({
    enviar: (canal, payload) => {
      if (extra.enviarFalha) throw new Error("janela destruída");
      log.enviados.push([canal, payload]);
    },
    fecharJanela: () => log.fechou++,
    contexto: () => ({ updateReady: true, version: "1.4.1" }),
    podePerguntar: extra.podePerguntar,
    agendar: (fn, ms) => {
      const t = { fn, ms, cancelado: false };
      log.agenda.push(t);
      return t;
    },
    cancelarAgenda: (t) => t && (t.cancelado = true),
  });
  const fechar = () => {
    const ev = { prevenido: false, preventDefault() { this.prevenido = true; } };
    flow.aoFechar(ev);
    return ev;
  };
  return { flow, log, fechar };
}

{
  const { flow, log, fechar } = novoFluxo();
  const ev = fechar();
  check(ev.prevenido === true && log.fechou === 0, "fechar a janela é segurado (preventDefault) até o renderer responder");
  check(log.enviados.length === 1 && log.enviados[0][0] === "mf:close:request" && log.enviados[0][1].updateReady === true && log.enviados[0][1].version === "1.4.1", "o renderer recebe o pedido com o estado da atualização (pronta/versão)");
  check(log.agenda.length === 1 && log.agenda[0].ms === 5000, "há limite de 5 s para o renderer confirmar o recebimento");
  flow.ack();
  check(log.agenda[0].cancelado === true && log.fechou === 0, "depois do ack o limite sai: quem decide é o operador");
  const de_novo = fechar();
  check(de_novo.prevenido === true && log.enviados.length === 2 && log.agenda.length === 1, "outro clique no X reenvia o pedido (traz o diálogo de volta), sem criar outro limite");
  flow.confirmar();
  check(log.fechou === 1, "confirmar fecha a janela");
  const passa = fechar();
  check(passa.prevenido === false, "a tentativa de fechar que vem da confirmação passa direto (ordem: backup → fechamento)");
}
{
  const { flow, log, fechar } = novoFluxo();
  fechar();
  flow.ack();
  flow.cancelar();
  const ev = fechar();
  check(log.fechou === 0 && ev.prevenido === true && log.enviados.length === 2 && log.agenda.length === 2, "cancelar: nada fecha e a próxima tentativa pergunta de novo, com novo limite");
}
{
  const { log, fechar } = novoFluxo();
  fechar();
  log.agenda[0].fn(); // renderer não respondeu em 5 s
  check(log.fechou === 1, "renderer travado: depois do limite o app fecha mesmo assim (não fica preso)");
  check(fechar().prevenido === false, "e o fechamento seguinte passa");
}
{
  const { log, fechar } = novoFluxo({ enviarFalha: true });
  const ev = fechar();
  check(ev.prevenido === true && log.fechou === 1, "janela destruída/crashada (envio falha): fecha na hora, sem esperar");
}
{
  const { log, fechar } = novoFluxo({ podePerguntar: () => false });
  fechar();
  check(log.fechou === 1 && log.enviados.length === 0, "sem condição de perguntar (ex.: teste automatizado): fecha direto");
}
{
  const { flow, log, fechar } = novoFluxo();
  fechar();
  flow.liberar();
  check(log.agenda[0].cancelado === true && fechar().prevenido === false, "liberar (app.quit / reiniciar para instalar) não prende em diálogo");
}

// ---------- backup com limite de tempo ----------
check((await executarBackupComLimite({ runBackup: async () => ({ ok: true, at: "x" }) })).ok === true, "backup ok → { ok: true }");
{
  const r = await executarBackupComLimite({ runBackup: async () => ({ ok: false, error: "disco cheio" }) });
  check(r.ok === false && r.error === "disco cheio", "backup que falha devolve o erro");
  const t = await executarBackupComLimite({ runBackup: async () => { throw new Error("quebrou"); } });
  check(t.ok === false && t.error === "quebrou", "backup que lança vira { ok: false } (nunca propaga)");
  const ini = Date.now();
  const lento = await executarBackupComLimite({ runBackup: () => new Promise(() => {}), timeoutMs: 60 });
  check(lento.ok === false && lento.error === MSG_BACKUP_DEMOROU && Date.now() - ini < 2000, "backup que trava é interrompido pelo limite de tempo");
}

// ---------- pendências de sync ----------
{
  const fakeDb = (p, e) => ({ sync_queue: { where: () => ({ equals: (s) => ({ count: async () => (s === "pending" ? p : e) }) }) } });
  check((await contarPendenciasDeSync(fakeDb(3, 2))) === 5, "pendências = pendentes + com erro");
  check((await contarPendenciasDeSync({ sync_queue: { where: () => { throw new Error("db fechado"); } } })) === 0, "falha ao contar não impede o fechamento (0)");
  check(/NÃO substitui a sincronização/.test(MSG_BACKUP_NAO_SUBSTITUI_SYNC), "aviso deixa claro que backup não substitui a sincronização");
}

// ---------- máquina de estados ----------
const t = (e, ev) => proximoEstado(e, ev);
check(t("pergunta", "fazerBackup").estado === "salvando" && t("pergunta", "fazerBackup").acao === null, "pergunta → fazer backup → salvando");
check(t("salvando", "backupOk").acao === "concluir", "backup ok → concluir (fechar/instalar)");
check(t("salvando", "backupFalhou").estado === "falhou" && t("salvando", "backupFalhou").acao === null, "backup falhou → falhou (não fecha sozinho)");
check(t("falhou", "tentarNovamente").estado === "salvando", "falhou → tentar novamente → salvando");
check(t("falhou", "fecharSemBackup").acao === "concluir" && t("pergunta", "fecharSemBackup").acao === "concluir", "fechar sem backup conclui (na pergunta e depois da falha)");
check(t("falhou", "cancelar").acao === "cancelar" && t("pergunta", "cancelar").acao === "cancelar", "cancelar vale na pergunta e depois da falha");
check(t("salvando", "cancelar").acao === null && t("salvando", "fecharSemBackup").acao === null && t("salvando", "fazerBackup").estado === "salvando", "durante o backup nada cancela nem fecha por engano");
check(t("pergunta", "backupOk").acao === null && t("pergunta", "tentarNovamente").estado === "pergunta", "eventos fora de hora são ignorados");

// ---------- fiação ----------
const main = ler("electron/main.cjs");
check(main.includes('closeFlow = createCloseFlow(') && main.includes('mainWindow.on("close", (event) => closeFlow.aoFechar(event))'), "main.cjs segura o fechamento da janela pelo closeFlow");
check(main.includes('ipcMain.handle("mf:close:ack"') && main.includes('ipcMain.handle("mf:close:confirm"') && main.includes('ipcMain.handle("mf:close:cancel"') && main.includes("setupCloseBridge();"), "main.cjs registra ack/confirm/cancel");
check(/closeFlow\?\.liberar\(\);[^\n]*\n\s*autoUpdater\.quitAndInstall\(\);/.test(main), "reiniciar e instalar libera o fechamento e só então chama quitAndInstall");
check(/app\.on\("before-quit", \(\) => \{\n\s*closeFlow\?\.liberar\(\);/.test(main), "before-quit libera (nenhum caminho de saída fica preso)");
check(main.includes("autoInstallOnAppQuit = true") && main.includes("autoDownload = true"), "updater segue com autoDownload e autoInstallOnAppQuit ligados");
check(main.includes("podePerguntar: () => !process.env.MF_SELFTEST"), "o teste automatizado (MF_SELFTEST) não abre diálogo");
const preload = ler("electron/preload.cjs");
check(preload.includes('"mf:close:request"') && preload.includes('invoke("mf:close:ack")') && preload.includes('invoke("mf:close:confirm")') && preload.includes('invoke("mf:close:cancel")'), "preload expõe closeFlow (onRequest/ack/confirm/cancel)");
check(ler("electron-builder.yml").includes("electron/closeFlow.cjs"), "closeFlow.cjs vai no pacote");
const host = ler("src/components/updates/FechamentoComBackupHost.jsx");
check(host.includes('import { runBackup } from "@/lib/localBackup"') && !/BACKUP_TABLES|db\.(products|sales)/.test(host), "usa o backup que já existe (runBackup), sem criar outro mecanismo");
check(host.includes("bridge.ack()") && host.includes("closeFlow?.confirm") && host.includes("update?.installNow"), "host: confirma o fechamento ou chama installNow só em `concluir`");
check(/const concluir[\s\S]*installNow[\s\S]*confirm/.test(host) && !/installNow\?\.\(\)[\s\S]{0,40}runBackup/.test(host), "o instalar só é chamado dentro de concluir (depois do backup ou de 'sem backup')");
check(ler("src/App.jsx").includes("<FechamentoComBackupHost />"), "App monta o host");

console.log("\nSmoke — fechar/instalar com backup antes\n");
for (const m of ok) console.log(`  PASS  ${m}`);
for (const m of falhas) console.log(`  FAIL  ${m}`);
console.log(`\n${ok.length} passaram, ${falhas.length} falharam\n`);
process.exit(falhas.length ? 1 : 0);
