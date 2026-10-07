/**
 * Gera o instalador Windows e reúne os arquivos do feed de atualização:
 *   MercadoFacilPDV-Setup-<versão>.exe   — download manual
 *   latest.yml + .blockmap               — usados pelo auto-update
 *
 * Os artefatos ficam fora do deploy (o .exe tem ~99 MB): publique-os com
 * `node scripts/publish-github-release.mjs --dir=<dir impresso aqui>`.
 *
 * Uso: node scripts/release-desktop.mjs [--skip-build]
 */
import { spawnSync } from "child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const root = process.cwd();
const outDir = join(tmpdir(), "mf-desktop-release");
// Fora de public/: o instalador não vai para o deploy nem para o repositório.
const publicDir = join(root, "release-artifacts");
const version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
const skipBuild = process.argv.includes("--skip-build");

function run(cmd, args) {
  const res = spawnSync(process.execPath, [cmd, ...args], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (res.status !== 0) {
    console.error(JSON.stringify({ ok: false, error: (res.stderr || res.stdout).slice(-800) }));
    process.exit(1);
  }
  return res.stdout;
}

if (!skipBuild) {
  rmSync(outDir, { recursive: true, force: true });
  run(join(root, "node_modules", "vite", "bin", "vite.js"), ["build"]);
  run(join(root, "node_modules", "electron-builder", "out", "cli", "cli.js"), [
    "--win",
    "--config",
    "electron-builder.yml",
    `--config.directories.output=${outDir}`,
    "--config.win.target=nsis",
  ]);
}

// Instalador que não abre (dependência de runtime fora do app.asar, ex.: node-gyp-build) não pode
// chegar ao feed de atualização: confere o pacote gerado antes de reunir os artefatos.
run(join(root, "scripts", "verify-package-deps.mjs"), [`--package=${join(outDir, "win-unpacked")}`]);

mkdirSync(publicDir, { recursive: true });

// Limpa artefatos de versões anteriores para não publicar binário defasado.
for (const old of readdirSync(publicDir)) {
  if (/\.(exe|zip|blockmap)$/.test(old) && !old.includes(version)) {
    rmSync(join(publicDir, old), { force: true });
  }
}

const wanted = [
  `MercadoFacilPDV-Setup-${version}.exe`,
  `MercadoFacilPDV-Setup-${version}.exe.blockmap`,
  "latest.yml",
];
const published = [];
for (const name of wanted) {
  const src = join(outDir, name);
  if (!existsSync(src)) {
    console.error(JSON.stringify({ ok: false, error: `artefato ausente: ${name}` }));
    process.exit(1);
  }
  copyFileSync(src, join(publicDir, name));
  published.push({ file: name, mb: +(statSync(src).size / 1024 / 1024).toFixed(1) });
}

const installerMb = published.find((p) => p.file.endsWith(".exe")).mb;
console.log(
  JSON.stringify(
    {
      ok: true,
      version,
      published,
      installer_mb: installerMb,
      dir: publicDir,
      next: `node scripts/publish-github-release.mjs --dir=${publicDir}`,
    },
    null,
    2
  )
);
