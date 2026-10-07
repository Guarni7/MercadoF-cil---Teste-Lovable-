/**
 * Smoke da versão única do app: package.json → Vite (__APP_VERSION__) → APP_VERSION → telas.
 * Garante que não sobrou "v1.0.0" escrito à mão e que o fluxo de atualização (isUpdateAvailable) segue igual.
 *
 * Uso: node scripts/smoke-app-version.mjs
 */
import { existsSync, readFileSync, readdirSync } from "fs";
import { join, resolve } from "path";

const falhas = [];
const ok = [];
const check = (cond, msg) => (cond ? ok.push(msg) : falhas.push(msg));
const ler = (p) => readFileSync(resolve(process.cwd(), p), "utf8").split("\r\n").join("\n");
const pkg = JSON.parse(ler("package.json"));

// ---------- 1. APP_VERSION vem do build (simula o define do Vite) ----------
globalThis.__APP_VERSION__ = pkg.version;
const v = await import("../src/lib/appVersion.js");
check(v.APP_VERSION === pkg.version, `APP_VERSION = package.json (${pkg.version})`);
const [maj, min, pat] = pkg.version.split(".").map(Number);
check(v.APP_VERSION_CODE === maj * 10000 + min * 100 + pat, `APP_VERSION_CODE derivado da versão (${v.APP_VERSION_CODE})`);
check(v.PENDING_VERSION_CODE === 37902 && v.PENDING_VERSION === "3.79.2", "PENDING_VERSION / código seguem iguais (esquema do código confere com 3.79.2 → 37902)");

// ---------- 2. fluxo de atualização inalterado ----------
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
check(v.getInstalledVersion() === pkg.version, "sem valor salvo, a versão instalada é a do app");
check(v.isUpdateAvailable(v.PENDING_VERSION) === true, "3.79.2 continua > versão instalada (mesmo resultado de antes com 1.0.0)");
check(v.isUpdateAvailable(pkg.version) === false, "a própria versão instalada não é 'atualização disponível'");
check(v.compareVersions("1.4.0", "1.10.0") === -1 && v.compareVersions("1.4.0", "1.4") === 0 && v.compareVersions("2.0.0", "1.99.99") === 1, "compareVersions compara por número, não por texto");
globalThis.localStorage = { getItem: (k) => (k === "mf_app_version" ? "3.79.2" : null), setItem() {}, removeItem() {} };
check(v.isUpdateAvailable(v.PENDING_VERSION) === false, "valor salvo pelo fluxo de teste (mf_app_version) segue valendo só dentro do fluxo de atualização");
delete globalThis.localStorage;

// ---------- 3. sem versão fixa antiga nas telas ----------
const layout = ler("src/components/Layout.jsx");
check(layout.includes("v{APP_VERSION}") && layout.includes('from "@/lib/appVersion"') && !/v\d+\.\d+\.\d+/.test(layout), "rodapé (Layout) usa APP_VERSION, sem 'vX.Y.Z' escrito");
check(ler("src/components/config/SuporteTab.jsx").includes("Versão atual: {APP_VERSION}"), "Suporte mostra APP_VERSION");
check(ler("src/components/config/VersionHistory.jsx").includes("v{APP_VERSION}"), "Histórico mostra APP_VERSION");
const fonte = ler("src/lib/appVersion.js");
check(!/APP_VERSION\s*=\s*"\d/.test(fonte), "appVersion.js não tem versão escrita à mão");
const cfg = ler("vite.config.js");
check(cfg.includes("__APP_VERSION__") && cfg.includes("package.json"), "vite.config.js injeta package.json.version");
check(!ler("src/lib/electronUpdate.js").includes("getVersion") && !ler("src/components/Layout.jsx").includes("getVersion"), "não usa electronAPI.getVersion (versão do Electron, não do app)");

// ---------- 4. build gerado (se existir) ----------
const assets = resolve(process.cwd(), "dist/assets");
if (existsSync(assets)) {
  const js = readdirSync(assets).filter((f) => f.endsWith(".js")).map((f) => readFileSync(join(assets, f), "utf8")).join("\n");
  check(["\"", "`", "'"].some((q) => js.includes(`${q}${pkg.version}${q}`)), `dist contém a versão ${pkg.version}`);
  check(!js.includes("v1.0.0"), "dist sem 'v1.0.0'");
}

console.log("\nSmoke — versão única do app\n");
for (const m of ok) console.log(`  PASS  ${m}`);
for (const m of falhas) console.log(`  FAIL  ${m}`);
console.log(`\n${ok.length} passaram, ${falhas.length} falharam\n`);
process.exit(falhas.length ? 1 : 0);
