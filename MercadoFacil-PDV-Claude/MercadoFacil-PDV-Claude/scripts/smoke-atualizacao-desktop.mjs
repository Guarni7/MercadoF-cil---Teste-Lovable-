/**
 * Smoke do painel e da verificação da atualização REAL do desktop (electron-updater), sem Electron nem rede:
 *   estado a partir dos eventos do main, textos do painel (versão atual/nova, percentual, MB baixados/total,
 *   "Atualização pronta", "será instalada ao fechar"), verificação manual com resultado/erro/prazo,
 *   e a fiação: autoDownload/autoInstallOnAppQuit intactos, progresso com transferred/total/bytesPerSecond,
 *   botão "Reiniciar e instalar agora" → backup → instalação, Verificar Atualizações → checkNow real.
 *
 * Uso: node scripts/smoke-atualizacao-desktop.mjs
 */
import { readFileSync } from "fs";
import { resolve } from "path";
import { MSG_ERRO_ATUALIZACAO, aplicarEvento, descreverPainel, estadoInicial, formatarMB, painelVisivel, progressoEmMB, resultadoDaVerificacao, verificarAtualizacao } from "../src/lib/atualizacaoDesktop.js";

const falhas = [];
const ok = [];
const check = (cond, msg) => (cond ? ok.push(msg) : falhas.push(msg));
const ler = (p) => readFileSync(resolve(process.cwd(), p), "utf8").split("\r\n").join("\n");
const MB = 1024 * 1024;

// ---------- formatação ----------
check(formatarMB(105883823) === "101,0 MB" && formatarMB(0) === "0,0 MB" && formatarMB(12.3 * MB) === "12,3 MB", "formatarMB: base 1024, vírgula, 1 casa");
check(formatarMB(undefined) === "" && formatarMB(-1) === "" && formatarMB(NaN) === "", "formatarMB: valor ausente/inválido → vazio");

// ---------- estado a partir dos eventos ----------
let e = estadoInicial();
check(e.status === "idle" && !painelVisivel(e), "começa sem painel");
e = aplicarEvento(e, { status: "checking" });
check(!painelVisivel(e), "verificando: sem painel (não incomoda)");
e = aplicarEvento(e, { status: "available", info: "1.4.1" });
check(e.status === "available" && e.info === "1.4.1" && painelVisivel(e), "disponível: painel com a nova versão");
e = aplicarEvento(e, { status: "downloading", percent: 37.4, transferred: 38 * MB, total: 101 * MB, bytesPerSecond: 2 * MB });
check(e.status === "downloading" && e.percent === 37 && e.info === "1.4.1" && e.transferred === 38 * MB && e.total === 101 * MB, "baixando: percentual, bytes e a versão nova são mantidos");
check(progressoEmMB(e) === "38,0 MB / 101,0 MB", "MB baixados / MB total");
const pDown = descreverPainel(e, "1.4.0");
check(pDown.titulo === "Baixando atualização..." && pDown.detalhe === "37%" && pDown.percentual === 37 && pDown.versaoAtual === "1.4.0" && pDown.versaoNova === "1.4.1" && pDown.mostrarBarra && !pDown.pronta, "painel baixando: título, 37%, versão atual → nova, barra");
check(aplicarEvento(e, { status: "downloading", percent: 250 }).percent === 100 && aplicarEvento(e, { status: "downloading", percent: -5 }).percent === 0, "percentual limitado a 0–100");
check(aplicarEvento(e, { status: "downloading", percent: 10 }).total === null && progressoEmMB(aplicarEvento(e, { status: "downloading", percent: 10 })) === "", "sem total conhecido não inventa MB");
e = aplicarEvento(e, { status: "downloaded", info: "1.4.1" });
const pOk = descreverPainel(e, "1.4.0");
check(e.status === "downloaded" && pOk.pronta && pOk.titulo === "Atualização pronta" && pOk.detalhe === "Será instalada ao fechar o MercadoFácil." && pOk.percentual === 100, "pronta: 'Atualização pronta' e 'Será instalada ao fechar'");
check(pOk.progresso === "101,0 MB / 101,0 MB", "pronta: mostra o total baixado");
check(aplicarEvento(e, { status: "not-available" }).info === null && !painelVisivel(aplicarEvento(e, { status: "not-available" })), "sem atualização: painel some e a versão nova é esquecida");
check(!painelVisivel(aplicarEvento(e, { status: "error", error: "net::ERR" })) && aplicarEvento(e, { status: "error", error: "x" }).error === "x", "erro: não abre painel (o detalhe técnico fica no estado/log)");
check(aplicarEvento(e, null) === e && aplicarEvento(e, {}) === e, "evento vazio é ignorado");

// ---------- verificação manual ----------
check(resultadoDaVerificacao({ status: "not-available" }, "1.4.1").mensagem === "O sistema já está na versão mais recente (1.4.1).", "sem atualização: mensagem com a versão atual");
check(/1\.4\.1 encontrada/.test(resultadoDaVerificacao({ status: "available", info: "1.4.1" }, "1.4.0").mensagem), "encontrada: avisa a versão");
check(resultadoDaVerificacao({ status: "downloaded" }, "1.4.0").mensagem.includes("instalada ao fechar"), "pronta: avisa que instala ao fechar");
const erroUsuario = resultadoDaVerificacao({ status: "error", error: "net::ERR_INTERNET_DISCONNECTED at https://x" }, "1.4.0");
check(erroUsuario.tipo === "erro" && erroUsuario.mensagem === MSG_ERRO_ATUALIZACAO && !/net::|https/.test(erroUsuario.mensagem), "erro: mensagem útil, sem texto técnico");
check(resultadoDaVerificacao({ status: "checking" }, "1.4.0") === null && resultadoDaVerificacao({ status: "downloading" }, "1.4.0") === null, "checking/downloading ainda não são resultado");

function fakeUpdater({ emite = [], checkNowFalha = false } = {}) {
  const log = { checkNow: 0, inscritos: 0, saiu: 0 };
  let handler;
  return {
    log,
    deps: {
      checkNow: async () => {
        log.checkNow++;
        if (checkNowFalha) throw new Error("sem internet");
        for (const ev of emite) handler(ev);
        return true;
      },
      onChange: (h) => {
        handler = h;
        log.inscritos++;
        return () => log.saiu++;
      },
    },
  };
}
{
  const f = fakeUpdater({ emite: [{ status: "checking" }, { status: "not-available" }] });
  const r = await verificarAtualizacao({ ...f.deps, versaoAtual: "1.4.1" });
  check(r.tipo === "sucesso" && f.log.checkNow === 1 && f.log.saiu === 1, "verificar: chama checkNow real UMA vez, ignora 'checking', devolve o resultado e se desinscreve");
  const g = fakeUpdater({ emite: [{ status: "available", info: "1.4.1" }] });
  check((await verificarAtualizacao({ ...g.deps, versaoAtual: "1.4.0" })).tipo === "info", "verificar: atualização encontrada → info");
  const h = fakeUpdater({ checkNowFalha: true });
  const rh = await verificarAtualizacao({ ...h.deps, versaoAtual: "1.4.0" });
  check(rh.tipo === "erro" && rh.mensagem === MSG_ERRO_ATUALIZACAO && h.log.saiu === 1, "verificar: checkNow falhou → erro amigável (nunca rejeita)");
  const i = fakeUpdater({ emite: [] });
  const ini = Date.now();
  const ri = await verificarAtualizacao({ ...i.deps, versaoAtual: "1.4.0", timeoutMs: 60 });
  check(ri.tipo === "info" && /demorando/.test(ri.mensagem) && Date.now() - ini < 2000 && i.log.saiu === 1, "verificar: sem resposta no prazo → aviso neutro e desinscreve");
}

// ---------- fiação ----------
const main = ler("electron/main.cjs");
check(main.includes("autoUpdater.autoDownload = true") && main.includes("autoUpdater.autoInstallOnAppQuit = true"), "main: autoDownload e autoInstallOnAppQuit continuam ligados");
check(/download-progress[\s\S]{0,200}transferred: p\.transferred[\s\S]{0,60}total: p\.total[\s\S]{0,60}bytesPerSecond/.test(main), "main: o progresso do download leva transferred, total e bytesPerSecond");
const painel = ler("src/components/updates/ElectronUpdatePanel.jsx");
check(painel.includes("Reiniciar e instalar agora") && painel.includes("EVENTO_INSTALAR_AGORA") && !painel.includes("installNow"), "painel: o botão pede o reinício pelo fluxo com backup (não chama installNow direto)");
check(painel.includes("update.onChange") && painel.includes("update\n      .status()") && !/releaseNotes|PENDING/.test(painel), "painel: usa os eventos reais do updater e não a simulação 3.79.2");
const host = ler("src/components/updates/FechamentoComBackupHost.jsx");
check(/EVENTO_INSTALAR_AGORA[\s\S]*abrir\("instalar"/.test(host) && /modoRef\.current === "instalar"\) api\?\.update\?\.installNow/.test(host), "host: 'instalar' abre o diálogo de backup e só então chama installNow");
const suporte = ler("src/components/config/SuporteTab.jsx");
check(suporte.includes("verificarAtualizacaoAgora(APP_VERSION)") && /if \(!hasElectronUpdate\(\)\) return requestUpdateCheck\(\)/.test(suporte), "Suporte: no desktop chama a verificação real; na web segue a tela de novidades");
const eu = ler("src/lib/electronUpdate.js");
check(eu.includes("checkNow: checkForUpdateNow") && /checkForUpdateNow = \(\) =>[\s\S]*update\.checkNow\(\)/.test(eu), "verificar → checkNow do preload");
const app = ler("src/App.jsx");
check(app.includes("<ElectronUpdatePanel />") && app.includes("<FechamentoComBackupHost />"), "App monta o painel e o host em toda rota");
const flow = ler("src/components/updates/UpdateFlowHost.jsx");
check(!flow.includes("toast.info(\"Nova atualização disponível") && flow.includes("checkForUpdateNow()"), "o toast antigo saiu (o painel avisa); a re-checagem ao voltar a internet continua");

console.log("\nSmoke — atualização real do desktop (painel, progresso, verificação)\n");
for (const m of ok) console.log(`  PASS  ${m}`);
for (const m of falhas) console.log(`  FAIL  ${m}`);
console.log(`\n${ok.length} passaram, ${falhas.length} falharam\n`);
process.exit(falhas.length ? 1 : 0);
