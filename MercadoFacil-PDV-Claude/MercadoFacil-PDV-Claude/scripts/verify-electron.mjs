/**
 * Verifica o app desktop sem depender de inspeção manual:
 *  - o bundle empacotado aponta para o Supabase (e não para o Base44)
 *  - o Electron abre a SPA servida do disco (funciona sem internet)
 *  - o diretório de dados local é o mesmo entre versões
 *
 * Uso:
 *   node scripts/verify-electron.mjs            (usa a cópia local em dist/)
 *   node scripts/verify-electron.mjs --exe=<caminho do .exe instalado>
 *   node scripts/verify-electron.mjs --exe=<...> --persist=write --marker=<txt>
 *   node scripts/verify-electron.mjs --exe=<...> --persist=read  --marker=<txt>
 */
import { spawn } from "child_process";
import { readFileSync, readdirSync, existsSync, rmSync } from "fs";
import { resolve, join } from "path";
import { tmpdir } from "os";

function arg(name) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}

const root = process.cwd();
const distDir = resolve(root, "dist");
const report = { ok: false, steps: {} };

if (!existsSync(join(distDir, "index.html"))) {
  console.error(JSON.stringify({ ok: false, error: "dist/index.html ausente — rode npm run build" }));
  process.exit(1);
}

// 1) O bundle precisa falar com o Supabase e não carregar nada do Base44.
const assetsDir = join(distDir, "assets");
const bundles = existsSync(assetsDir)
  ? readdirSync(assetsDir).filter((f) => f.endsWith(".js"))
  : [];
let supabaseHits = 0;
const base44Hits = [];
for (const file of bundles) {
  const content = readFileSync(join(assetsDir, file), "utf8");
  if (/https:\/\/[a-z0-9]+\.supabase\.co/i.test(content)) supabaseHits += 1;
  const m = content.match(/[a-z0-9.-]*base44[a-z0-9.-]*/gi);
  if (m) base44Hits.push({ file, samples: [...new Set(m)].slice(0, 5) });
}
report.steps.bundle = {
  js_files: bundles.length,
  supabase_url_found: supabaseHits > 0,
  base44_references: base44Hits,
};

// 2) Abre o app de verdade e confirma que a SPA renderiza offline.
const selftestOut = join(tmpdir(), `mf-selftest-${Date.now()}.json`);
const exePath = arg("exe");
const command = exePath || process.execPath;
// --no-sandbox só no modo `electron .` (verificação interna, roda nosso
// próprio dist/ já confiável) — nunca no modo --exe, que testa o instalador
// real e deve manter o mesmo sandbox que o usuário final tem. Necessário em
// CI: o chrome-sandbox SUID helper não fica root+4755 num runner sem privilégio.
const args = exePath
  ? []
  : [resolve(root, "node_modules", "electron", "cli.js"), root, "--no-sandbox"];

const persistMode = arg("persist");
const marker = arg("marker") || "";

const child = spawn(command, args, {
  env: {
    ...process.env,
    MF_SELFTEST: "1",
    MF_SELFTEST_OUT: selftestOut,
    MF_SELFTEST_PERSIST: persistMode || "",
    MF_SELFTEST_MARKER: marker,
    MF_URL: "",
    ELECTRON_DISABLE_SECURITY_WARNINGS: "1",
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let stdout = "";
child.stdout.on("data", (d) => (stdout += d.toString()));
child.stderr.on("data", (d) => (stdout += d.toString()));

const exitCode = await new Promise((res) => {
  const killer = setTimeout(() => {
    child.kill();
    res(-1);
  }, 90000);
  child.on("exit", (code) => {
    clearTimeout(killer);
    res(code);
  });
});

let selftest = null;
if (existsSync(selftestOut)) {
  try {
    selftest = JSON.parse(readFileSync(selftestOut, "utf8"));
  } catch {
    /* cai no parser do stdout */
  }
  rmSync(selftestOut, { force: true });
}
if (!selftest) {
  const m = stdout.match(/MF_SELFTEST (\{.*\})/);
  if (m) selftest = JSON.parse(m[1]);
}

report.steps.launch = {
  exit_code: exitCode,
  packaged: selftest?.packaged ?? null,
  url: selftest?.url ?? null,
  rendered_chars: selftest?.probe?.rendered ?? 0,
  origin: selftest?.probe?.origin ?? null,
  indexed_db: selftest?.probe?.indexed_db ?? false,
  error: selftest?.error || (selftest ? null : stdout.slice(-400)),
};
if (persistMode) report.steps.persist = selftest?.persist || null;

report.ok =
  report.steps.bundle.supabase_url_found === true &&
  report.steps.bundle.base44_references.length === 0 &&
  selftest?.ok === true &&
  report.steps.launch.rendered_chars > 0 &&
  report.steps.launch.indexed_db === true &&
  (!persistMode || report.steps.persist?.ok === true);

report.note = report.ok
  ? persistMode === "read"
    ? "App desktop abre offline e o banco local do terminal sobreviveu à atualização"
    : "App desktop abre a SPA local (sem internet), com IndexedDB e apontando para o Supabase"
  : "Verificação do app desktop falhou";

console.log(JSON.stringify(report, null, 2));
process.exit(report.ok ? 0 : 1);
