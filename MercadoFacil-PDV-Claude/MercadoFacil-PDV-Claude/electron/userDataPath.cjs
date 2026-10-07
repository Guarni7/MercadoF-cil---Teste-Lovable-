const fs = require("fs");
const os = require("os");
const path = require("path");

/**
 * Pasta de dados do app (IndexedDB da fila offline, sessão, backups).
 *
 * Normal: %APPDATA%\MercadoFacilPDV, igual a sempre (sobrevive a atualizações).
 *
 * Teste: com MF_ELECTRON_TEST=1 usa uma pasta NOVA e vazia em %TEMP%\mf-electron-test-XXXX, nunca a real.
 * É necessário porque o main faz app.setPath("userData", ...) e isso sobrescreve tanto o
 * --user-data-dir quanto a sessão: sem este desvio, qualquer execução de teste grava no perfil real.
 * (APPDATA no ambiente não adianta: o Electron obtém a pasta pela API do Windows, não pela variável.)
 */
function resolveUserData({ appData, env = process.env, tmpdir = os.tmpdir() }) {
  const real = path.join(appData, "MercadoFacilPDV");
  if (env.MF_ELECTRON_TEST !== "1") return { dir: real, real, test: false };

  const dir = fs.mkdtempSync(path.join(tmpdir, "mf-electron-test-"));
  const rel = path.relative(real, dir);
  if (!rel || (!rel.startsWith("..") && !path.isAbsolute(rel))) {
    throw new Error(`Modo de teste recusado: ${dir} é o perfil real ou está dentro dele.`);
  }
  return { dir, real, test: true };
}

module.exports = { resolveUserData };
