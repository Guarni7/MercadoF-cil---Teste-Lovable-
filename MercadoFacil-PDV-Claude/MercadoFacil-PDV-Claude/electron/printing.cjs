/**
 * Impressão do cupom no app desktop: mf:print:list (impressoras do Windows) e mf:print:html (imprime um HTML).
 *
 * O renderer só pede (preload → IPC); quem fala com o spooler é o processo main, numa janela OCULTA
 * sem JavaScript, que carrega o HTML e chama webContents.print. Com `silent` o cupom vai direto para a
 * impressora (a configurada em `deviceName`, ou a padrão do Windows); sem `silent` abre o diálogo do sistema.
 *
 * Fábrica com dependências injetadas (BrowserWindow e a lista de impressoras) para o smoke testar tudo
 * com janelas falsas, sem disparar impressão real: scripts/smoke-electron-impressao.mjs.
 */
const MAX_HTML = 1_500_000; // vai por data: URL; cupom de venda tem poucos KB
const TIMEOUT_PADRAO_MS = 30_000;

const MSG_NAO_ENCONTRADA = (nome) => `Impressora "${nome}" não encontrada. Verifique o nome em Configurações > Impressora.`;
const MSG_CANCELADA = "Impressão cancelada.";

/** @returns {{ html: string, silent: boolean, deviceName: string | undefined }} */
function validar(opts) {
  const html = opts?.html;
  if (typeof html !== "string" || !html.trim()) throw new Error("Nada para imprimir.");
  if (html.length > MAX_HTML) throw new Error("O documento é grande demais para imprimir.");
  const deviceName = typeof opts.deviceName === "string" && opts.deviceName.trim() ? opts.deviceName.trim() : undefined;
  return { html, silent: opts.silent !== false, deviceName };
}

/** Motivo devolvido pelo Electron (callback do print) → texto para o operador. */
function mensagemDaFalha(motivo) {
  const m = String(motivo || "").toLowerCase();
  if (m.includes("cancel")) return MSG_CANCELADA;
  return `Falha ao imprimir${motivo ? ` (${motivo})` : ""}. Verifique se a impressora está ligada e sem fila travada.`;
}

/**
 * @param {{
 *   BrowserWindow: new (opts: object) => any,
 *   listarImpressoras: () => Promise<Array<{ name: string, displayName?: string, isDefault?: boolean }>>,
 *   timeoutMs?: number,
 * }} deps
 */
function createPrintApi({ BrowserWindow, listarImpressoras, timeoutMs = TIMEOUT_PADRAO_MS }) {
  let fila = Promise.resolve(); // um cupom por vez: dois cliques não embaralham o spooler

  async function list() {
    try {
      const impressoras = await listarImpressoras();
      return (impressoras || []).map((p) => ({ name: p.name, displayName: p.displayName || p.name, isDefault: !!p.isDefault }));
    } catch {
      return [];
    }
  }

  async function imprimir(opts) {
    let dados;
    try {
      dados = validar(opts);
    } catch (e) {
      return { ok: false, error: e.message };
    }

    if (dados.deviceName) {
      const existentes = await list();
      if (!existentes.some((p) => p.name === dados.deviceName)) return { ok: false, error: MSG_NAO_ENCONTRADA(dados.deviceName) };
    }

    let janela = null;
    try {
      janela = new BrowserWindow({
        show: false,
        webPreferences: { javascript: false, sandbox: true, contextIsolation: true, nodeIntegration: false },
      });
      const resultado = await new Promise((resolve) => {
        let encerrado = false;
        const fim = (r) => {
          if (encerrado) return;
          encerrado = true;
          clearTimeout(limite);
          resolve(r);
        };
        const limite = setTimeout(() => fim({ ok: false, error: "A impressora não respondeu. Tente de novo." }), timeoutMs);
        janela
          .loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(dados.html)}`)
          .then(() => {
            janela.webContents.print({ silent: dados.silent, deviceName: dados.deviceName, printBackground: true }, (sucesso, motivo) => {
              fim(sucesso ? { ok: true } : { ok: false, error: mensagemDaFalha(motivo) });
            });
          })
          .catch((e) => fim({ ok: false, error: `Não foi possível preparar o cupom para impressão (${e?.message || e}).` }));
      });
      return resultado;
    } catch (e) {
      return { ok: false, error: `Falha ao imprimir (${e?.message || e}).` };
    } finally {
      try {
        if (janela && !janela.isDestroyed?.()) janela.destroy();
      } catch {
        /* já fechada */
      }
    }
  }

  const printHtml = (opts) => {
    const vez = fila.then(() => imprimir(opts));
    fila = vez.catch(() => {});
    return vez;
  };

  return { list, printHtml };
}

module.exports = { createPrintApi, validar, mensagemDaFalha, MSG_NAO_ENCONTRADA, MSG_CANCELADA, MAX_HTML };
