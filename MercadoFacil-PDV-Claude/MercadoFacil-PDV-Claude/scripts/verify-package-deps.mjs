/**
 * Confere as dependências de RUNTIME do processo main do app desktop (Electron).
 *
 * O electron-builder.yml empacota só os pacotes de node_modules listados em `files`. Faltar um
 * (o caso real: `node-gyp-build`, exigido por @serialport/bindings-cpp) gera um instalador que
 * não abre: "Cannot find module ..." no main process. Este script pega isso ANTES de publicar.
 *
 * Duas verificações:
 *   1. Configuração (sempre, roda no CI): todo pacote `require`-ado por electron/*.cjs e todas as
 *      suas dependências de runtime (transitivas) têm um padrão em `files`; `npmRebuild: false`
 *      (o serialport usa binário N-API pré-compilado); o asar não foi desligado.
 *   2. Pacote gerado (--package=<pasta win-unpacked>): o app.asar tem esses pacotes, o `.node` do
 *      serialport está fora do asar, e `require("serialport")` carrega a partir do app empacotado,
 *      rodando o próprio executável com ELECTRON_RUN_AS_NODE (sem abrir janela nem tocar nos dados
 *      do usuário).
 *
 * Uso: node scripts/verify-package-deps.mjs [--package=<dir win-unpacked>]
 */
import { builtinModules, createRequire } from "module";
import { existsSync, readFileSync, readdirSync } from "fs";
import { join, resolve } from "path";
import { spawnSync } from "child_process";

const raiz = process.cwd();
const falhas = [];
const ok = [];
const check = (cond, msg) => (cond ? ok.push(msg) : falhas.push(msg));
const ler = (p) => readFileSync(join(raiz, p), "utf8").split("\r\n").join("\n");

// ---------- pacotes de runtime do main/preload ----------
const nativos = new Set([...builtinModules, ...builtinModules.map((m) => `node:${m}`), "electron"]);
const nomeDoPacote = (spec) => (spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0]);
const raizes = new Set();
for (const arq of readdirSync(join(raiz, "electron")).filter((f) => f.endsWith(".cjs"))) {
  for (const m of ler(`electron/${arq}`).matchAll(/require\(\s*["']([^"']+)["']\s*\)/g)) {
    const spec = m[1];
    if (spec.startsWith(".") || nativos.has(spec) || nativos.has(nomeDoPacote(spec))) continue;
    raizes.add(nomeDoPacote(spec));
  }
}

const fechamento = new Map(); // pacote -> quem exigiu
const semInstalar = [];
const visitar = (nome, de) => {
  if (fechamento.has(nome)) return;
  fechamento.set(nome, de);
  const pj = join(raiz, "node_modules", nome, "package.json");
  if (!existsSync(pj)) {
    semInstalar.push(nome);
    return;
  }
  for (const dep of Object.keys(JSON.parse(readFileSync(pj, "utf8")).dependencies || {})) visitar(dep, nome);
};
for (const r of [...raizes].sort()) visitar(r, "electron/*.cjs");

// ---------- 1. configuração ----------
const yml = ler("electron-builder.yml");
const secaoFiles = yml.match(/^files:\n([\s\S]*?)(?=^\S)/m)?.[1] || "";
const padroes = [...secaoFiles.matchAll(/^\s*-\s+"?([^"\n#]+?)"?\s*$/gm)].map((m) => m[1]);
const incluidos = new Set(padroes.filter((p) => !p.startsWith("!")));
const excluidos = padroes.filter((p) => p.startsWith("!")).map((p) => p.slice(1));
const coberto = (nome) =>
  [`node_modules/${nome}/**/*`, nome.startsWith("@") ? `node_modules/${nome.split("/")[0]}/**/*` : null].some((p) => p && incluidos.has(p)) &&
  !excluidos.some((e) => e === `node_modules/${nome}/**/*`);

check(raizes.size > 0 && raizes.has("serialport") && raizes.has("electron-updater"), `o main.cjs exige ${[...raizes].sort().join(", ")} em runtime`);
check(semInstalar.length === 0, `node_modules completo para conferir o fechamento${semInstalar.length ? ` (faltam instalar: ${semInstalar.join(", ")}; rode npm ci)` : ""}`);
const naoListados = [...fechamento].filter(([nome]) => !coberto(nome));
check(
  naoListados.length === 0,
  `todas as ${fechamento.size} dependências de runtime estão em files do electron-builder.yml${naoListados.length ? `; FALTAM: ${naoListados.map(([n, de]) => `${n} (exigido por ${de})`).join(", ")}` : ""}`,
);
check(fechamento.has("node-gyp-build") && coberto("node-gyp-build"), "node-gyp-build (carregador do .node do serialport) está empacotado");
check(/^npmRebuild:\s*false\s*$/m.test(yml), "npmRebuild: false no electron-builder.yml (serialport usa binário N-API pré-compilado; sem toolchain de C++ no build)");
check(!/^asar:\s*false/m.test(yml), "o asar continua ligado (o .node sai do asar sozinho para app.asar.unpacked)");
check(existsSync(join(raiz, "node_modules/@serialport/bindings-cpp/prebuilds/win32-x64")), "o prebuild win32-x64 do serialport está instalado (sem rebuild nativo)");

// ---------- 2. pacote gerado ----------
const arg = process.argv.find((a) => a.startsWith("--package="));
if (arg) {
  const pasta = resolve(arg.slice("--package=".length));
  const asarPath = join(pasta, "resources", "app.asar");
  const exe = readdirSync(pasta).find((f) => f.toLowerCase().endsWith(".exe") && !/^(uninstall|elevate)/i.test(f));
  check(existsSync(asarPath) && !!exe, `pacote encontrado em ${pasta}`);
  if (existsSync(asarPath) && exe) {
    const asar = createRequire(join(raiz, "package.json"))("@electron/asar");
    const arquivos = new Set(asar.listPackage(asarPath).map((p) => p.split("\\").join("/").replace(/^\//, "")));
    const ausentes = [...fechamento.keys()].filter((n) => !arquivos.has(`node_modules/${n}/package.json`));
    check(ausentes.length === 0, `o app.asar tem todas as ${fechamento.size} dependências de runtime${ausentes.length ? `; AUSENTES: ${ausentes.join(", ")}` : ""}`);
    const desempacotado = join(pasta, "resources", "app.asar.unpacked", "node_modules", "@serialport", "bindings-cpp", "prebuilds", "win32-x64");
    check(existsSync(desempacotado) && readdirSync(desempacotado).some((f) => f.endsWith(".node")), "o .node do serialport está fora do asar (app.asar.unpacked)");
    const executar = (codigo) =>
      spawnSync(join(pasta, exe), ["-e", codigo], { env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" }, encoding: "utf8", timeout: 60000 });
    const caminho = join(pasta, "resources", "app.asar", "node_modules", "serialport").split("\\").join("/");
    const r = executar(`try { const { SerialPort } = require(${JSON.stringify(caminho)}); console.log("SERIALPORT_OK:" + typeof SerialPort.list); } catch (e) { console.log("SERIALPORT_ERRO:" + e.message.split("\\n")[0]); }`);
    const saida = `${r.stdout || ""}${r.stderr || ""}`.trim();
    check(saida.includes("SERIALPORT_OK:function"), `require("serialport") carrega a partir do app empacotado${saida.includes("SERIALPORT_OK") ? "" : ` (${saida.split("\n").pop()})`}`);
    const u = executar(`try { require(${JSON.stringify(join(pasta, "resources", "app.asar", "node_modules", "electron-updater").split("\\").join("/"))}); console.log("UPDATER_OK"); } catch (e) { console.log("UPDATER_ERRO:" + e.message.split("\\n")[0]); }`);
    check(`${u.stdout || ""}`.includes("UPDATER_OK"), `require("electron-updater") carrega a partir do app empacotado${`${u.stdout || ""}`.includes("UPDATER_OK") ? "" : ` (${`${u.stdout || ""}${u.stderr || ""}`.trim().split("\n").pop()})`}`);
  }
}

console.log("\nVerificação das dependências de runtime do app desktop\n");
for (const m of ok) console.log(`  PASS  ${m}`);
for (const m of falhas) console.log(`  FAIL  ${m}`);
console.log(`\n${ok.length} passaram, ${falhas.length} falharam\n`);
process.exit(falhas.length ? 1 : 0);
