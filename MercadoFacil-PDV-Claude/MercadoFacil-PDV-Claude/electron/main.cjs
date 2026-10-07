const { app, BrowserWindow, Menu, protocol, net, dialog, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");
const { pathToFileURL } = require("url");
const { autoUpdater } = require("electron-updater");
const { SerialPort } = require("serialport");
const { resolveUserData } = require("./userDataPath.cjs");
const { createPrintApi } = require("./printing.cjs");
const { createCloseFlow } = require("./closeFlow.cjs");

// Dados locais (IndexedDB da fila offline) sobrevivem a atualizações.
// Em teste (MF_ELECTRON_TEST=1) a pasta é uma temporária nova: ver userDataPath.cjs.
const userDataInfo = resolveUserData({ appData: app.getPath("appData") });
app.setPath("userData", userDataInfo.dir);

const APP_SCHEME = "mercadofacil";
const APP_ORIGIN = `${APP_SCHEME}://app`;
const DIST_DIR = app.isPackaged
  ? path.join(process.resourcesPath, "app.asar", "dist")
  : path.join(__dirname, "..", "dist");

// Origin estável garante que o banco local continue o mesmo entre versões.
protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
]);

let mainWindow;
let closeFlow = null; // fechar com backup (closeFlow.cjs)

/** SPA servida do disco: rotas do React Router caem no index.html. */
function registerAppProtocol() {
  protocol.handle(APP_SCHEME, (request) => {
    const { pathname } = new URL(request.url);
    const relative = decodeURIComponent(pathname).replace(/^\/+/, "");
    const candidate = path.join(DIST_DIR, relative);
    const isInsideDist = candidate.startsWith(DIST_DIR);
    const target =
      isInsideDist && relative && fs.existsSync(candidate) && fs.statSync(candidate).isFile()
        ? candidate
        : path.join(DIST_DIR, "index.html");
    return net.fetch(pathToFileURL(target).toString());
  });
}

/**
 * MF_URL aponta para uma URL publicada (usado em testes contra o preview).
 * Sem ele o app roda a cópia empacotada — é o que mantém o PDV funcionando
 * quando o mercado fica sem internet.
 */
function resolveStartUrl() {
  if (process.env.MF_URL) return process.env.MF_URL;
  if (!app.isPackaged && process.env.MF_DEV_SERVER) return "http://localhost:5173";
  if (fs.existsSync(path.join(DIST_DIR, "index.html"))) return APP_ORIGIN;
  return null;
}

function createWindow() {
  const url = resolveStartUrl();
  if (!url) {
    dialog.showErrorBox(
      "MercadoFácil PDV",
      "Build do app não encontrado. Rode `npm run build` antes de empacotar, ou defina MF_URL."
    );
    app.quit();
    return;
  }

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 600,
    title: "MercadoFácil PDV",
    icon: path.join(__dirname, "build", "icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  Menu.setApplicationMenu(null);
  mainWindow.loadURL(url);

  // Verificação automatizada do empacotamento (scripts/verify-electron.mjs).
  if (process.env.MF_SELFTEST) {
    runSelfTest(url);
  }

  setupAutoUpdate();

  // Fechar a janela pede o backup ao renderer antes (src/components/updates/FechamentoComBackupHost.jsx); só fecha quando ele confirma.
  closeFlow = createCloseFlow({
    enviar: (canal, payload) => {
      if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isCrashed()) throw new Error("janela indisponível");
      mainWindow.webContents.send(canal, payload);
    },
    fecharJanela: () => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
    },
    contexto: () => ({ updateReady: updateState.status === "downloaded", version: updateState.info || null }),
    // Teste automatizado (MF_SELFTEST) fecha sozinho, sem diálogo.
    podePerguntar: () => !process.env.MF_SELFTEST,
  });
  mainWindow.on("close", (event) => closeFlow.aoFechar(event));

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function runSelfTest(url) {
  const report = {
    url,
    packaged: app.isPackaged,
    dist_dir: DIST_DIR,
    user_data: app.getPath("userData"),
    real_user_data: userDataInfo.real,
    test_profile: userDataInfo.test,
  };
  const finish = (extra) => {
    const out = JSON.stringify({ ...report, ...extra });
    if (process.env.MF_SELFTEST_OUT) {
      try {
        fs.writeFileSync(process.env.MF_SELFTEST_OUT, out);
      } catch {
        /* segue e imprime no stdout */
      }
    }
    process.stdout.write(`MF_SELFTEST ${out}\n`);
    app.exit(extra.ok ? 0 : 1);
  };

  const timeout = setTimeout(() => finish({ ok: false, error: "timeout ao carregar" }), 30000);

  mainWindow.webContents.on("did-finish-load", async () => {
    clearTimeout(timeout);
    try {
      const probe = await mainWindow.webContents.executeJavaScript(`(async () => ({
        title: document.title,
        origin: location.origin,
        has_root: !!document.querySelector('#root'),
        rendered: (document.querySelector('#root')?.innerHTML || '').length,
        indexed_db: typeof indexedDB !== 'undefined',
        databases: (await indexedDB.databases()).map((d) => d.name),
        local_storage_keys: Object.keys(localStorage),
        idb_rows: Object.fromEntries(await Promise.all((await indexedDB.databases()).map(async (d) => {
          const db = await new Promise((ok, no) => { const r = indexedDB.open(d.name); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); });
          const rows = {};
          for (const s of db.objectStoreNames) {
            rows[s] = await new Promise((ok, no) => { const r = db.transaction(s, 'readonly').objectStore(s).count(); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); });
          }
          db.close();
          return [d.name, rows];
        }))),
      }))()`);

      // Modo persistência: grava/lê um marcador local para provar que o banco
      // do terminal sobrevive à atualização do app.
      const mode = process.env.MF_SELFTEST_PERSIST;
      let persist = null;
      if (mode === "write" || mode === "read") {
        persist = await mainWindow.webContents.executeJavaScript(
          persistScript(mode, process.env.MF_SELFTEST_MARKER || "")
        );
      }

      // Modo atualização: espera o desfecho da checagem no feed.
      let update = null;
      if (process.env.MF_SELFTEST_UPDATE) {
        update = await Promise.race([
          updateOutcome,
          new Promise((r) => setTimeout(() => r({ status: "timeout" }), 120000)),
        ]);
      }

      finish({
        ok:
          !!probe.has_root &&
          probe.rendered > 0 &&
          (!persist || persist.ok) &&
          (!update || update.status === process.env.MF_SELFTEST_UPDATE),
        probe,
        persist,
        update,
      });
    } catch (e) {
      finish({ ok: false, error: e.message });
    }
  });

  mainWindow.webContents.on("did-fail-load", (_e, code, desc) => {
    clearTimeout(timeout);
    finish({ ok: false, error: `${code} ${desc}` });
  });
}

const updateState = { status: "idle", info: null, error: null };
let updateSettled;
const updateOutcome = new Promise((resolve) => {
  updateSettled = resolve;
});

/**
 * Atualização automática: o app baixa a nova versão em segundo plano e instala
 * ao fechar, para o caixa não precisar rebaixar o instalador a cada release.
 * O feed padrão vem do app-update.yml gerado no empacotamento; MF_UPDATE_URL
 * sobrescreve (usado nos testes).
 */
function setupAutoUpdate() {
  if (!app.isPackaged && !process.env.MF_UPDATE_URL) return;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = null;

  if (process.env.MF_UPDATE_URL) {
    autoUpdater.forceDevUpdateConfig = true;
    autoUpdater.setFeedURL({ provider: "generic", url: process.env.MF_UPDATE_URL });
  }

  const publish = (status, extra = {}) => {
    updateState.status = status;
    Object.assign(updateState, extra);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("mf:update", { status, ...extra });
    }
    if (status === "downloaded" || status === "not-available" || status === "error") {
      updateSettled({ status, ...extra });
    }
  };

  autoUpdater.on("checking-for-update", () => publish("checking"));
  autoUpdater.on("update-available", (info) => publish("available", { info: info?.version || null }));
  autoUpdater.on("update-not-available", () => publish("not-available"));
  autoUpdater.on("download-progress", (p) =>
    publish("downloading", {
      percent: Math.round(p.percent),
      transferred: p.transferred,
      total: p.total,
      bytesPerSecond: Math.round(p.bytesPerSecond),
    })
  );
  autoUpdater.on("update-downloaded", (info) =>
    publish("downloaded", { info: info?.version || null })
  );
  autoUpdater.on("error", (err) => publish("error", { error: err?.message || String(err) }));

  ipcMain.handle("mf:update:status", () => updateState);
  ipcMain.handle("mf:update:install", () => {
    closeFlow?.liberar(); // o backup já foi feito pelo renderer; a saída para instalar não pergunta de novo
    autoUpdater.quitAndInstall();
    return true;
  });
  // Sob demanda (ex.: renderer detectou que a internet voltou) — não espera
  // o próximo tick do setInterval de 6h.
  ipcMain.handle("mf:update:check", () => {
    autoUpdater.checkForUpdates().catch(() => {
      /* sem internet ainda: ignora, o próximo evento "online" tenta de novo */
    });
    return true;
  });

  autoUpdater.checkForUpdates().catch(() => {
    /* sem internet: o PDV segue funcionando offline */
  });
  // Uma verificação a cada 6h cobre o turno inteiro da loja.
  setInterval(() => {
    autoUpdater.checkForUpdates().catch(() => {});
  }, 6 * 60 * 60 * 1000);
}

/** Marcador em IndexedDB usado para verificar persistência entre versões. */
function persistScript(mode, marker) {
  return `(async () => {
    const open = () => new Promise((resolve, reject) => {
      const req = indexedDB.open('mf_selftest', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('marker');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const db = await open();
    const run = (mode) => new Promise((resolve, reject) => {
      const tx = db.transaction('marker', mode === 'write' ? 'readwrite' : 'readonly');
      const store = tx.objectStore('marker');
      const req = mode === 'write'
        ? store.put(${JSON.stringify(marker)}, 'value')
        : store.get('value');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const result = await run(${JSON.stringify(mode)});
    const stored = ${JSON.stringify(mode)} === 'write' ? ${JSON.stringify(marker)} : result;
    return {
      ok: ${JSON.stringify(mode)} === 'write' ? true : stored === ${JSON.stringify(marker)},
      mode: ${JSON.stringify(mode)},
      stored: stored || null,
    };
  })()`;
}

/**
 * Balança Toledo Prix 8217 (protocolo P05A) via porta serial.
 *
 * O navegador (Web Serial API) não é confiável para isso em produção — some
 * quando empacotado, e a versão web pura nunca teria acesso à porta COM. O
 * processo main do Electron é quem fala com o hardware; o renderer só troca
 * mensagens por IPC (mesmo padrão de mf:update:* já usado pro auto-update).
 *
 * P05A = balança aguarda ENQ (0x05) do computador, então responde com um
 * único frame [STX 0x02][peso][ETX 0x03 ou CR 0x0D]. Peso sem separador
 * decimal é dividido por 10^decimalPlaces (padrão 3 casas na 8217); com
 * separador (',' ou '.'), é lido direto. Primeiro caractere I/N/S indica
 * instável/negativo/sobrecarga em vez de um peso válido — mesmo mapeamento
 * usado pela biblioteca ACBr (referência real de mercado para esse protocolo,
 * não uma interpretação própria).
 */
const STX = 0x02;
const ETX = 0x03;
const CR = 0x0d;
const ENQ = Buffer.from([0x05]);

let scalePort = null;
let scaleReadBuffer = Buffer.alloc(0);

function parseToledoP05AFrame(buffer, decimalPlaces) {
  const stxIdx = buffer.lastIndexOf(STX);
  if (stxIdx === -1) return null;
  let endIdx = buffer.indexOf(ETX, stxIdx + 1);
  if (endIdx === -1) endIdx = buffer.indexOf(CR, stxIdx + 1);
  if (endIdx === -1) return null; // frame ainda incompleto — espera mais bytes

  const field = buffer.slice(stxIdx + 1, endIdx).toString("ascii").trim();
  const consumedThrough = endIdx + 1;

  if (!field) return { consumedThrough, status: "invalid", weight: null, raw: field };

  const firstChar = field[0].toUpperCase();
  if (firstChar === "I") return { consumedThrough, status: "unstable", weight: null, raw: field };
  if (firstChar === "N") return { consumedThrough, status: "negative", weight: null, raw: field };
  if (firstChar === "S") return { consumedThrough, status: "overload", weight: null, raw: field };

  // Variante do modelo 9098 manda "kg" junto — mesmo tratamento do ACBr.
  const cleaned = field.replace(/kg/i, "").trim();
  let value;
  if (/[.,]/.test(cleaned)) {
    value = parseFloat(cleaned.replace(",", "."));
  } else {
    const intVal = parseInt(cleaned, 10);
    value = Number.isNaN(intVal) ? NaN : intVal / Math.pow(10, decimalPlaces);
  }

  if (!Number.isFinite(value) || value <= 0) {
    return { consumedThrough, status: "invalid", weight: null, raw: field };
  }
  return { consumedThrough, status: "stable", weight: value, raw: field };
}

function closeScalePort() {
  if (!scalePort) return;
  try {
    scalePort.removeAllListeners();
    if (scalePort.isOpen) scalePort.close();
  } catch {
    /* já pode estar fechada (desconexão física) */
  }
  scalePort = null;
  scaleReadBuffer = Buffer.alloc(0);
}

function sendScaleStatus(status, extra = {}) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("mf:scale:status", { status, ...extra });
  }
}

/**
 * Backup local automático — diferente da fila de sincronização (sync_queue):
 * sync manda operações pendentes pra nuvem; backup é uma foto local dos
 * dados operacionais, pra recuperação se o IndexedDB corromper ou a máquina
 * precisar ser restaurada, sem depender de internet nenhuma.
 */
const BACKUP_DIR = path.join(app.getPath("userData"), "backups");
const BACKUP_RETENTION = 5;

function setupLocalBackup() {
  ipcMain.handle("mf:backup:write", async (_event, payload) => {
    try {
      await fs.promises.mkdir(BACKUP_DIR, { recursive: true });
      const fileName = `backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
      await fs.promises.writeFile(path.join(BACKUP_DIR, fileName), JSON.stringify(payload), "utf-8");

      // Nomes com timestamp ISO ordenam cronologicamente por string — mantém
      // só os mais recentes pra não crescer o disco indefinidamente.
      const files = (await fs.promises.readdir(BACKUP_DIR)).filter((f) => f.endsWith(".json")).sort();
      if (files.length > BACKUP_RETENTION) {
        const toRemove = files.slice(0, files.length - BACKUP_RETENTION);
        await Promise.all(
          toRemove.map((f) => fs.promises.unlink(path.join(BACKUP_DIR, f)).catch(() => {}))
        );
      }
      return { ok: true, fileName, at: new Date().toISOString() };
    } catch (err) {
      return { ok: false, error: err?.message || String(err) };
    }
  });

  ipcMain.handle("mf:backup:list", async () => {
    try {
      await fs.promises.mkdir(BACKUP_DIR, { recursive: true });
      const files = (await fs.promises.readdir(BACKUP_DIR)).filter((f) => f.endsWith(".json"));
      const stats = await Promise.all(
        files.map(async (f) => {
          const st = await fs.promises.stat(path.join(BACKUP_DIR, f));
          return { fileName: f, size: st.size, mtime: st.mtime.toISOString() };
        })
      );
      return stats.sort((a, b) => b.mtime.localeCompare(a.mtime));
    } catch {
      return [];
    }
  });
}

/** Impressão do cupom (mf:print:*): lógica em printing.cjs, aqui só liga ao Electron. */
function setupPrinting() {
  const api = createPrintApi({
    BrowserWindow,
    listarImpressoras: () => {
      if (!mainWindow || mainWindow.isDestroyed()) return Promise.resolve([]);
      return mainWindow.webContents.getPrintersAsync();
    },
  });
  ipcMain.handle("mf:print:list", () => api.list());
  ipcMain.handle("mf:print:html", (_event, opts) => api.printHtml(opts));
}

/** Respostas do renderer ao pedido de fechamento (mf:close:request). */
function setupCloseBridge() {
  ipcMain.handle("mf:close:ack", () => closeFlow?.ack());
  ipcMain.handle("mf:close:confirm", () => closeFlow?.confirmar());
  ipcMain.handle("mf:close:cancel", () => closeFlow?.cancelar());
}

function setupScaleBridge() {
  ipcMain.handle("mf:scale:list-ports", async () => {
    try {
      const ports = await SerialPort.list();
      return ports.map((p) => ({ path: p.path, manufacturer: p.manufacturer || null }));
    } catch (e) {
      return [];
    }
  });

  ipcMain.handle("mf:scale:connect", async (_event, config) => {
    closeScalePort();
    const {
      comport,
      baudrate = 9600,
      dataBits = 8,
      parity = "none",
      stopBits = 1,
    } = config || {};
    if (!comport) throw new Error("Porta COM não informada.");

    return new Promise((resolve, reject) => {
      const port = new SerialPort(
        {
          path: comport,
          baudRate: parseInt(baudrate, 10) || 9600,
          dataBits: parseInt(dataBits, 10) || 8,
          parity: parity || "none",
          stopBits: parseInt(stopBits, 10) || 1,
          autoOpen: false,
        },
        (err) => {
          if (err) {
            scalePort = null;
            reject(new Error(`Não foi possível abrir ${comport}: ${err.message}`));
            return;
          }
          scalePort = port;
          scaleReadBuffer = Buffer.alloc(0);

          port.on("data", (chunk) => {
            scaleReadBuffer = Buffer.concat([scaleReadBuffer, chunk]);
            if (scaleReadBuffer.length > 4096) scaleReadBuffer = scaleReadBuffer.subarray(-256);
          });
          port.on("error", (e) => {
            sendScaleStatus("error", { error: e.message });
            closeScalePort();
          });
          port.on("close", () => {
            sendScaleStatus("disconnected");
          });

          sendScaleStatus("connected", { comport });
          resolve({ ok: true, comport });
        }
      );
      port.open();
    });
  });

  ipcMain.handle("mf:scale:disconnect", async () => {
    closeScalePort();
    sendScaleStatus("disconnected");
    return true;
  });

  ipcMain.handle("mf:scale:read-weight", async (_event, options) => {
    if (!scalePort || !scalePort.isOpen) {
      throw new Error("Balança não conectada. Configure e conecte antes de ler o peso.");
    }
    const decimalPlaces = Number.isFinite(options?.decimalPlaces) ? options.decimalPlaces : 3;
    scaleReadBuffer = Buffer.alloc(0);

    return new Promise((resolve, reject) => {
      let settled = false;
      const timeoutMs = 3000;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error("Tempo esgotado aguardando resposta da balança."));
      }, timeoutMs);

      const onData = () => {
        if (settled) return;
        const parsed = parseToledoP05AFrame(scaleReadBuffer, decimalPlaces);
        if (!parsed) return; // frame incompleto, aguarda mais dados
        settled = true;
        cleanup();
        if (parsed.status === "stable") {
          resolve({ status: "stable", weight: parsed.weight, raw: parsed.raw });
        } else if (parsed.status === "unstable") {
          reject(new Error("Peso instável — aguarde a balança estabilizar."));
        } else if (parsed.status === "negative") {
          reject(new Error("Balança leu peso negativo — verifique a tara."));
        } else if (parsed.status === "overload") {
          reject(new Error("Peso acima da capacidade da balança."));
        } else {
          reject(new Error("Dados inválidos recebidos da balança."));
        }
      };

      function cleanup() {
        clearTimeout(timer);
        if (scalePort) scalePort.off("data", onData);
      }

      scalePort.on("data", onData);
      scalePort.write(ENQ, (err) => {
        if (err && !settled) {
          settled = true;
          cleanup();
          reject(new Error(`Falha ao enviar comando à balança: ${err.message}`));
        }
      });
    });
  });
}

app.whenReady().then(() => {
  registerAppProtocol();
  setupScaleBridge();
  setupLocalBackup();
  setupPrinting();
  setupCloseBridge();
  createWindow();
});

app.on("before-quit", () => {
  closeFlow?.liberar(); // app.quit() por outro caminho não fica preso no diálogo
  closeScalePort();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (mainWindow === null) createWindow();
});
