/**
 * Prova que o app desktop se atualiza sozinho: empacota 1.3.0 e uma versão
 * maior, serve os artefatos novos num feed local e verifica se a versão antiga
 * baixa a atualização sem intervenção.
 *
 * Uso: node scripts/verify-electron-update.mjs
 */
import { spawn, spawnSync } from "child_process";
import { createServer } from "http";
import { readFileSync, existsSync, statSync, readdirSync, rmSync, mkdirSync } from "fs";
import { join, extname } from "path";
import { tmpdir } from "os";

const root = process.cwd();
const baseOut = join(tmpdir(), "mf-update-base");
const nextOut = join(tmpdir(), "mf-update-next");
const BASE_VERSION = "1.3.0";
const NEXT_VERSION = "1.3.1";

function build(outDir, version) {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const res = spawnSync(
    process.execPath,
    [
      join(root, "node_modules", "electron-builder", "out", "cli", "cli.js"),
      "--win",
      "--config",
      "electron-builder.yml",
      `--config.directories.output=${outDir}`,
      `--config.extraMetadata.version=${version}`,
      "--config.win.target=nsis",
    ],
    { cwd: root, encoding: "utf8", shell: false }
  );
  if (res.status !== 0) {
    throw new Error(`build ${version} falhou: ${(res.stderr || res.stdout || "").slice(-600)}`);
  }
}

const report = { ok: false, steps: {} };

// 1) Versão instalada no caixa e a versão publicada depois.
build(baseOut, BASE_VERSION);
build(nextOut, NEXT_VERSION);
report.steps.builds = {
  installed: existsSync(join(baseOut, "win-unpacked", "MercadoFacilPDV.exe")),
  published_artifacts: readdirSync(nextOut).filter((f) => /\.(exe|yml|blockmap)$/.test(f)),
};

// 2) Feed estático, igual ao que a Vercel serve em /downloads/.
const server = createServer((req, res) => {
  const name = decodeURIComponent(new URL(req.url, "http://local").pathname).replace(/^\/+/, "");
  const file = join(nextOut, name);
  if (!file.startsWith(nextOut) || !existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404).end("not found");
    return;
  }
  const type = extname(file) === ".yml" ? "text/yaml" : "application/octet-stream";
  res.writeHead(200, { "content-type": type, "content-length": statSync(file).size });
  res.end(readFileSync(file));
});
const port = await new Promise((resolve) => server.listen(0, () => resolve(server.address().port)));
const feedUrl = `http://127.0.0.1:${port}/`;
report.steps.feed = { url: feedUrl, latest_yml: existsSync(join(nextOut, "latest.yml")) };

// 3) A versão instalada deve enxergar e baixar a nova sozinha.
const selftestOut = join(tmpdir(), `mf-update-${Date.now()}.json`);
const child = spawn(join(baseOut, "win-unpacked", "MercadoFacilPDV.exe"), [], {
  env: {
    ...process.env,
    MF_SELFTEST: "1",
    MF_SELFTEST_OUT: selftestOut,
    MF_SELFTEST_UPDATE: "downloaded",
    MF_UPDATE_URL: feedUrl,
    MF_URL: "",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let stdout = "";
child.stdout.on("data", (d) => (stdout += d));
child.stderr.on("data", (d) => (stdout += d));

const exitCode = await new Promise((resolve) => {
  const killer = setTimeout(() => {
    child.kill();
    resolve(-1);
  }, 180000);
  child.on("exit", (code) => {
    clearTimeout(killer);
    resolve(code);
  });
});
server.close();

let selftest = null;
if (existsSync(selftestOut)) {
  selftest = JSON.parse(readFileSync(selftestOut, "utf8"));
  rmSync(selftestOut, { force: true });
} else {
  const m = stdout.match(/MF_SELFTEST (\{.*\})/);
  if (m) selftest = JSON.parse(m[1]);
}

report.steps.update = {
  exit_code: exitCode,
  status: selftest?.update?.status ?? null,
  version_offered: selftest?.update?.info ?? null,
  error: selftest?.update?.error || selftest?.error || (selftest ? null : stdout.slice(-400)),
};

report.ok =
  report.steps.update.status === "downloaded" && report.steps.update.version_offered === NEXT_VERSION;
report.note = report.ok
  ? `Versão ${BASE_VERSION} instalada baixou sozinha a ${NEXT_VERSION} do feed publicado`
  : "Auto-update não concluiu";

console.log(JSON.stringify(report, null, 2));
process.exit(report.ok ? 0 : 1);
