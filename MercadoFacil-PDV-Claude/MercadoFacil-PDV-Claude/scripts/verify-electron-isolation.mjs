/**
 * Prova que o modo de teste do Electron (MF_ELECTRON_TEST=1) NÃO usa o perfil real do usuário.
 *
 * Por que existe: o main faz app.setPath("userData", %APPDATA%\MercadoFacilPDV), o que sobrescreve o
 * --user-data-dir, e o APPDATA do ambiente é ignorado (o Electron usa a API do Windows). Sem o modo de
 * teste, qualquer execução automatizada grava no perfil real. Detalhes em electron/userDataPath.cjs.
 *
 *   1. execução normal  → userData = <appData>\MercadoFacilPDV (função pura, sem abrir o app);
 *   2. modo de teste    → pasta temporária nova, diferente da real, recusada se estiver dentro dela;
 *   3. app de verdade (electron + MF_ELECTRON_TEST=1 + MF_SELFTEST=1, rede bloqueada por proxy morto):
 *      o relatório aponta para %TEMP%, o perfil de teste começa SEM sessão e SEM linhas no IndexedDB, e
 *      nenhum arquivo dele contém identificadores da sessão real;
 *   4. o perfil real (só metadados: caminho, tamanho, mtime) é idêntico antes e depois.
 *
 * Não abre o perfil real, não acessa Supabase (proxy morto), não faz login nem operação de negócio.
 * Uso: node scripts/verify-electron-isolation.mjs   (precisa de dist/: npm run build)
 */
import { spawnSync } from "child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "fs";
import { createRequire } from "module";
import { homedir, tmpdir } from "os";
import { join, relative, resolve } from "path";

const require = createRequire(import.meta.url);
const { resolveUserData } = require("../electron/userDataPath.cjs");

const falhas = [];
const ok = [];
const check = (cond, msg) => (cond ? ok.push(msg) : falhas.push(msg));

const appData = process.env.APPDATA || join(homedir(), "AppData", "Roaming");
const realDir = join(appData, "MercadoFacilPDV");

// ---------- 1. execução normal ----------
const normal = resolveUserData({ appData, env: {} });
check(normal.dir === realDir && normal.test === false, `normal: userData = ${realDir}`);
check(resolveUserData({ appData, env: { MF_ELECTRON_TEST: "0" } }).dir === realDir, "MF_ELECTRON_TEST diferente de 1 não ativa o modo de teste");

// ---------- 2. modo de teste (função pura, tudo dentro de %TEMP%) ----------
const falso = mkdtempSync(join(tmpdir(), "mf-iso-unit-"));
const a = resolveUserData({ appData: falso, env: { MF_ELECTRON_TEST: "1" } });
const b = resolveUserData({ appData: falso, env: { MF_ELECTRON_TEST: "1" } });
check(a.test && a.dir !== join(falso, "MercadoFacilPDV") && a.dir.startsWith(tmpdir()), "teste: pasta temporária, diferente da real");
check(a.dir !== b.dir && existsSync(a.dir) && readdirSync(a.dir).length === 0, "cada execução recebe um perfil novo e vazio");
let recusou = false;
try {
  resolveUserData({ appData: falso, env: { MF_ELECTRON_TEST: "1" }, tmpdir: join(falso, "MercadoFacilPDV") });
} catch {
  recusou = true;
}
check(recusou, "recusa um perfil de teste que caia dentro do perfil real");
rmSync(falso, { recursive: true, force: true });

// ---------- código ----------
const main = readFileSync(resolve("electron/main.cjs"), "utf8");
check((main.match(/setPath\(\s*["']userData["']/g) || []).length === 1 && main.includes("resolveUserData("), "main.cjs define userData uma única vez, via resolveUserData");
check(readFileSync(resolve("electron-builder.yml"), "utf8").includes("electron/userDataPath.cjs"), "userDataPath.cjs vai no pacote (electron-builder.yml)");

// ---------- 3 e 4. app de verdade ----------
const snapshot = (dir) => {
  const out = {};
  const varre = (d) => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      const s = statSync(p);
      if (s.isDirectory()) varre(p);
      else out[relative(dir, p)] = `${s.size}:${s.mtimeMs}`;
    }
  };
  if (existsSync(dir)) varre(dir);
  return out;
};
const antes = snapshot(realDir);

const electron = resolve("node_modules", "electron", "dist", process.platform === "win32" ? "electron.exe" : "electron");
const boot = mkdtempSync(join(tmpdir(), "mf-electron-test-boot-")); // início do Chromium, antes do setPath
const relatorio = join(boot, "relatorio.json");
let rel = null;
if (!existsSync(join(resolve("dist"), "index.html"))) {
  falhas.push("dist/index.html não existe: rode `npm run build` antes");
} else {
  const r = spawnSync(electron, [".", `--user-data-dir=${boot}`, "--proxy-server=127.0.0.1:9"], {
    cwd: resolve("."),
    timeout: 90000,
    stdio: "ignore",
    env: { ...process.env, MF_ELECTRON_TEST: "1", MF_SELFTEST: "1", MF_SELFTEST_OUT: relatorio, MF_URL: "", MF_UPDATE_URL: "", MF_DEV_SERVER: "" },
  });
  check(existsSync(relatorio), `o app rodou até o fim e gravou o relatório (exit ${r.status})`);
  if (existsSync(relatorio)) rel = JSON.parse(readFileSync(relatorio, "utf8"));
}

let perfilDeTeste = null;
if (rel) {
  perfilDeTeste = rel.user_data;
  check(rel.test_profile === true, "relatório: modo de teste ativo");
  check(rel.real_user_data === realDir, `relatório: perfil real reconhecido = ${realDir}`);
  check(perfilDeTeste !== realDir && relative(realDir, perfilDeTeste).startsWith(".."), "relatório: userData efetivo é diferente do real e está fora dele");
  check(perfilDeTeste.startsWith(tmpdir()) && /mf-electron-test-/.test(perfilDeTeste), `relatório: userData efetivo em %TEMP% (${perfilDeTeste})`);
  const ls = rel.probe?.local_storage_keys || [];
  check(!ls.some((k) => /^sb-.*auth-token$/.test(k) || k === "company_data"), "perfil de teste começa sem sessão (nenhuma chave de auth/empresa no Local Storage)");
  const linhas = Object.values(rel.probe?.idb_rows || {}).flatMap((t) => Object.values(t));
  check(linhas.every((n) => n === 0), `IndexedDB do teste começa vazio (${JSON.stringify(rel.probe?.idb_rows)})`);
  check(rel.ok === true, "o app (electron . em modo de teste) abriu e renderizou");

  // nenhum arquivo do perfil de teste contém identificadores da sessão real
  // marcadores genéricos de uma sessão/empresa logada (chave de auth do Supabase e dados de empresa em cache)
  const proibidos = [/sb-[a-z0-9]+-auth-token/, /company_data/, /connecttef_ativo:/];
  let achou = [];
  const procura = (d) => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      const s = statSync(p);
      if (s.isDirectory()) procura(p);
      else if (s.size < 20e6) {
        const t = readFileSync(p).toString("latin1");
        for (const k of proibidos) if (k.test(t)) achou.push(`${relative(perfilDeTeste, p)}:${k.source}`);
      }
    }
  };
  if (existsSync(perfilDeTeste)) procura(perfilDeTeste);
  check(achou.length === 0, `perfil de teste sem marcadores de sessão/empresa logada${achou.length ? " (achou: " + achou.slice(0, 3).join(", ") + ")" : ""}`);
  if (perfilDeTeste && existsSync(perfilDeTeste)) rmSync(perfilDeTeste, { recursive: true, force: true });
}
rmSync(boot, { recursive: true, force: true });

const depois = snapshot(realDir);
const mudou = [...new Set([...Object.keys(antes), ...Object.keys(depois)])].filter((k) => antes[k] !== depois[k]);
check(mudou.length === 0, `perfil real idêntico antes e depois (${Object.keys(antes).length} arquivos conferidos${mudou.length ? "; mudaram: " + mudou.slice(0, 5).join(", ") : ""})`);

console.log("\nIsolamento do Electron em teste\n");
for (const m of ok) console.log(`  PASS  ${m}`);
for (const m of falhas) console.log(`  FAIL  ${m}`);
console.log(`\n${ok.length} passaram, ${falhas.length} falharam\n`);
process.exit(falhas.length ? 1 : 0);
