/**
 * Inventário de resíduos Base44 no repo (não apaga nada).
 * Uso: node scripts/inventory-base44.mjs
 */
import { execSync } from "child_process";
import { existsSync, readdirSync, statSync } from "fs";
import { join } from "path";

function rg(pattern, globs = []) {
  try {
    const g = globs.map((x) => `--glob ${x}`).join(" ");
    const out = execSync(
      `rg -n -i --no-heading ${g} -g "!graphify-out/**" -g "!release/**" -g "!node_modules/**" -g "!.git/**" "${pattern}" .`,
      { encoding: "utf8", maxBuffer: 5_000_000 }
    );
    return out
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .slice(0, 200);
  } catch (e) {
    if (e.status === 1) return [];
    return [`ERROR: ${e.message}`];
  }
}

function listDir(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...listDir(p));
    else out.push(p.replace(/\\/g, "/"));
  }
  return out;
}

const report = {
  ok: true,
  functional_risk: [],
  leftovers: {},
  base44_dir_files: listDir("base44"),
  package_name: null,
};

try {
  const pkg = JSON.parse(
    execSync("node -p \"JSON.stringify(require('./package.json').name)\"", {
      encoding: "utf8",
    })
  );
  report.package_name = pkg;
} catch {}

const patterns = {
  sdk_import: String.raw`@base44/sdk|@base44/vite`,
  base44_app_url: String.raw`base44\.app`,
  media_cdn: String.raw`media\.base44\.com`,
  upload_extract: String.raw`UploadPublicFile|ExtractDataFromUploadedFile`,
  client_symbol: String.raw`Base44Client|from ['\"]@/api/base44Client`,
  base44_token_word: String.raw`\bbase44\b`,
};

for (const [k, p] of Object.entries(patterns)) {
  report.leftovers[k] = rg(p);
}

// Riscos funcionais: URL .base44.app ou SDK real em src/electron
for (const line of [
  ...report.leftovers.sdk_import,
  ...report.leftovers.base44_app_url,
]) {
  if (/^(src|electron|index\.html|public)\//.test(line.replace(/^\.\//, ""))) {
    report.functional_risk.push(line);
  }
}

report.summary = {
  sdk_hits: report.leftovers.sdk_import.length,
  base44_app_url_hits: report.leftovers.base44_app_url.length,
  media_cdn_hits: report.leftovers.media_cdn.length,
  facade_imports: report.leftovers.client_symbol.length,
  base44_dir_count: report.base44_dir_files.length,
  functional_risk_count: report.functional_risk.length,
  note:
    "Façade base44Client.js = Supabase. Pasta base44/ = legado (não no bundle Vite). Falta API key para export F.",
};

console.log(JSON.stringify(report, null, 2));
