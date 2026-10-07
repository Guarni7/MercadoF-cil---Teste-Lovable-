/**
 * Smoke da impressão do cupom no Electron (electron/printing.cjs) com janelas FALSAS: nada é impresso.
 *
 *   mf:print:list  → impressoras do Windows no formato { name, displayName, isDefault }; falha vira lista vazia.
 *   mf:print:html  → valida o pedido; confere o nome da impressora; carrega o HTML numa janela oculta sem
 *                    JavaScript; chama webContents.print com silent/deviceName; devolve erro real em português;
 *                    fecha a janela sempre; tem limite de tempo; um cupom por vez.
 *   Fiação: main.cjs registra os dois IPC, o preload expõe listPrinters/printHtml, o arquivo vai no pacote.
 *
 * Uso: node scripts/smoke-electron-impressao.mjs
 */
import { readFileSync } from "fs";
import { createRequire } from "module";
import { resolve } from "path";

const require = createRequire(import.meta.url);
const { createPrintApi, MAX_HTML, MSG_CANCELADA, MSG_NAO_ENCONTRADA } = require("../electron/printing.cjs");

const falhas = [];
const ok = [];
const check = (cond, msg) => (cond ? ok.push(msg) : falhas.push(msg));
const ler = (p) => readFileSync(resolve(process.cwd(), p), "utf8").split("\r\n").join("\n");

/** Janela falsa: registra o que o código faz e nunca toca no spooler. */
function fabrica({ loadErro, printa = (cb) => cb(true, ""), travaPrint = false, impressoras = [{ name: "EPSON TM-T20", displayName: "Epson", isDefault: true }, { name: "Microsoft Print to PDF" }], listaFalha = false } = {}) {
  const registro = { janelas: [], prints: [], urls: [] };
  class FakeWindow {
    constructor(opts) {
      this.opts = opts;
      this.destruida = false;
      registro.janelas.push(this);
      this.webContents = {
        print: (o, cb) => {
          registro.prints.push(o);
          if (!travaPrint) printa(cb);
        },
      };
    }
    async loadURL(url) {
      registro.urls.push(url);
      if (loadErro) throw new Error(loadErro);
    }
    isDestroyed() {
      return this.destruida;
    }
    destroy() {
      this.destruida = true;
    }
  }
  const listarImpressoras = async () => {
    if (listaFalha) throw new Error("spooler parado");
    return impressoras;
  };
  return { registro, api: (extra = {}) => createPrintApi({ BrowserWindow: FakeWindow, listarImpressoras, ...extra }) };
}

const HTML = "<html><body>CUPOM</body></html>";

// ---------- lista ----------
{
  const f = fabrica();
  const l = await f.api().list();
  check(l.length === 2 && l[0].name === "EPSON TM-T20" && l[0].isDefault === true && l[1].displayName === "Microsoft Print to PDF" && l[1].isDefault === false, "list: devolve name/displayName/isDefault de cada impressora");
  check((await fabrica({ listaFalha: true }).api().list()).length === 0, "list: se o spooler falhar devolve lista vazia (sem lançar)");
}

// ---------- validação do pedido ----------
{
  const f = fabrica();
  const api = f.api();
  for (const [rotulo, opts] of [["sem opções", undefined], ["html vazio", { html: "  " }], ["html não texto", { html: 123 }]]) {
    const r = await api.printHtml(opts);
    check(r.ok === false && /Nada para imprimir/.test(r.error), `printHtml: ${rotulo} → erro claro`);
  }
  const grande = await api.printHtml({ html: "x".repeat(MAX_HTML + 1) });
  check(grande.ok === false && /grande demais/.test(grande.error), "printHtml: documento enorme é recusado");
  check(f.registro.janelas.length === 0 && f.registro.prints.length === 0, "pedido inválido não abre janela nem imprime");
}

// ---------- caminho feliz ----------
{
  const f = fabrica();
  const r = await f.api().printHtml({ html: HTML, silent: true, deviceName: "EPSON TM-T20" });
  const j = f.registro.janelas[0];
  check(r.ok === true && !r.error, "printHtml: sucesso → { ok: true }");
  check(f.registro.prints.length === 1 && f.registro.prints[0].silent === true && f.registro.prints[0].deviceName === "EPSON TM-T20" && f.registro.prints[0].printBackground === true, "chama webContents.print com silent, deviceName e printBackground");
  check(decodeURIComponent(f.registro.urls[0].replace("data:text/html;charset=utf-8,", "")) === HTML, "o HTML do cupom vai para a janela por data: URL, sem alteração");
  check(j.opts.show === false && j.opts.webPreferences.javascript === false && j.opts.webPreferences.sandbox === true && j.opts.webPreferences.nodeIntegration === false && j.opts.webPreferences.contextIsolation === true, "janela oculta, sem JavaScript, com sandbox e sem Node");
  check(j.destruida === true, "a janela é destruída depois de imprimir");
}
{
  const f = fabrica();
  await f.api().printHtml({ html: HTML });
  check(f.registro.prints[0].silent === true && f.registro.prints[0].deviceName === undefined, "sem deviceName usa a impressora padrão do Windows (silencioso por padrão)");
  const g = fabrica();
  await g.api().printHtml({ html: HTML, silent: false });
  check(g.registro.prints[0].silent === false, "silent:false abre o diálogo do sistema");
}

// ---------- erros reais ----------
{
  const f = fabrica();
  const r = await f.api().printHtml({ html: HTML, deviceName: "Impressora Fantasma" });
  check(r.ok === false && r.error === MSG_NAO_ENCONTRADA("Impressora Fantasma") && f.registro.prints.length === 0 && f.registro.janelas.length === 0, "impressora inexistente → erro com o nome, sem abrir janela nem imprimir");
  const c = fabrica({ printa: (cb) => cb(false, "cancelled") });
  const rc = await c.api().printHtml({ html: HTML });
  check(rc.ok === false && rc.error === MSG_CANCELADA, "cancelado no diálogo → 'Impressão cancelada.'");
  const e = fabrica({ printa: (cb) => cb(false, "failed") });
  const re = await e.api().printHtml({ html: HTML });
  check(re.ok === false && /Falha ao imprimir \(failed\)/.test(re.error) && /ligada/.test(re.error), "falha do spooler → mensagem em português com o motivo técnico entre parênteses");
  check(e.registro.janelas[0].destruida === true, "mesmo com erro a janela é destruída");
  const l = fabrica({ loadErro: "ERR_FAILED" });
  const rl = await l.api().printHtml({ html: HTML });
  check(rl.ok === false && /Não foi possível preparar o cupom/.test(rl.error) && l.registro.prints.length === 0 && l.registro.janelas[0].destruida, "falha ao carregar o HTML → erro claro, não imprime, fecha a janela");
}

// ---------- limite de tempo ----------
{
  const t = fabrica({ travaPrint: true });
  const ini = Date.now();
  const r = await t.api({ timeoutMs: 80 }).printHtml({ html: HTML });
  check(r.ok === false && /não respondeu/.test(r.error) && Date.now() - ini < 2000 && t.registro.janelas[0].destruida, "impressora que não responde → erro por tempo limite e janela fechada");
}

// ---------- um por vez ----------
{
  const ordem = [];
  let liberar;
  const f = fabrica({
    printa: (cb) => {
      ordem.push("print");
      if (ordem.filter((x) => x === "print").length === 1) liberar = () => cb(true, "");
      else cb(true, "");
    },
  });
  const api = f.api();
  const p1 = api.printHtml({ html: HTML });
  const p2 = api.printHtml({ html: HTML });
  await new Promise((r) => setTimeout(r, 30));
  check(f.registro.prints.length === 1, "segundo cupom espera o primeiro terminar (fila)");
  liberar();
  const [a, b] = await Promise.all([p1, p2]);
  check(a.ok && b.ok && f.registro.prints.length === 2, "os dois cupons saem, em ordem");
}

// ---------- fiação ----------
const main = ler("electron/main.cjs");
check(main.includes('ipcMain.handle("mf:print:list"') && main.includes('ipcMain.handle("mf:print:html"') && main.includes("setupPrinting();") && main.includes("getPrintersAsync()"), "main.cjs registra mf:print:list e mf:print:html e usa getPrintersAsync");
const preload = ler("electron/preload.cjs");
check(preload.includes('listPrinters: () => ipcRenderer.invoke("mf:print:list")') && preload.includes('printHtml: (opts) => ipcRenderer.invoke("mf:print:html", opts)'), "preload expõe listPrinters e printHtml");
check(ler("electron-builder.yml").includes("electron/printing.cjs"), "printing.cjs vai no pacote (electron-builder.yml)");

console.log("\nSmoke — impressão do cupom no Electron (janelas falsas, nada é impresso)\n");
for (const m of ok) console.log(`  PASS  ${m}`);
for (const m of falhas) console.log(`  FAIL  ${m}`);
console.log(`\n${ok.length} passaram, ${falhas.length} falharam\n`);
process.exit(falhas.length ? 1 : 0);
