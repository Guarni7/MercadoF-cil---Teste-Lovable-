const { contextBridge, ipcRenderer } = require("electron");

// Bridge seguro entre o renderer (app web) e o main process
contextBridge.exposeInMainWorld("electronAPI", {
  platform: process.platform,
  isElectron: true,
  getVersion: () => process.versions.electron,
  // Impressão do cupom: o main imprime numa janela oculta (electron/printing.cjs).
  listPrinters: () => ipcRenderer.invoke("mf:print:list"),
  printHtml: (opts) => ipcRenderer.invoke("mf:print:html", opts),
  update: {
    status: () => ipcRenderer.invoke("mf:update:status"),
    installNow: () => ipcRenderer.invoke("mf:update:install"),
    checkNow: () => ipcRenderer.invoke("mf:update:check"),
    onChange: (handler) => {
      const listener = (_event, payload) => handler(payload);
      ipcRenderer.on("mf:update", listener);
      return () => ipcRenderer.removeListener("mf:update", listener);
    },
  },
  // Fechar a janela: o main pede o backup ao renderer e só fecha quando ele confirma (electron/closeFlow.cjs).
  closeFlow: {
    onRequest: (handler) => {
      const listener = (_event, payload) => handler(payload);
      ipcRenderer.on("mf:close:request", listener);
      return () => ipcRenderer.removeListener("mf:close:request", listener);
    },
    ack: () => ipcRenderer.invoke("mf:close:ack"),
    confirm: () => ipcRenderer.invoke("mf:close:confirm"),
    cancel: () => ipcRenderer.invoke("mf:close:cancel"),
  },
  // Backup local automático — arquivo JSON com os dados operacionais, na
  // pasta do usuário. Não é sincronização (não mexe em sync_queue).
  backup: {
    write: (payload) => ipcRenderer.invoke("mf:backup:write", payload),
    list: () => ipcRenderer.invoke("mf:backup:list"),
  },
  // Balança serial (Toledo Prix 8217, protocolo P05A) — só existe dentro do
  // Electron; a versão web usa Web Serial API (src/lib/scale.js) como
  // alternativa, nunca acesso direto à porta COM pelo navegador.
  scale: {
    listPorts: () => ipcRenderer.invoke("mf:scale:list-ports"),
    connect: (config) => ipcRenderer.invoke("mf:scale:connect", config),
    disconnect: () => ipcRenderer.invoke("mf:scale:disconnect"),
    readWeight: (options) => ipcRenderer.invoke("mf:scale:read-weight", options),
    onStatusChange: (handler) => {
      const listener = (_event, payload) => handler(payload);
      ipcRenderer.on("mf:scale:status", listener);
      return () => ipcRenderer.removeListener("mf:scale:status", listener);
    },
  },
});
