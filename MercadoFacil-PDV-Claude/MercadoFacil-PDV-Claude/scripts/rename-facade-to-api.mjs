/**
 * Renomeia imports da façade: base44Client → dataClient, base44 → api.
 * Mantém alias base44 em dataClient.js para qualquer residual.
 * Uso: node scripts/rename-facade-to-api.mjs
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (name === "node_modules" || name === "dist") continue;
      walk(p, out);
    } else if (/\.(js|jsx)$/.test(name)) {
      out.push(p);
    }
  }
  return out;
}

const files = walk("src").filter(
  (f) => !f.endsWith("dataClient.js") && !f.endsWith("base44Client.js")
);

let changed = 0;
for (const file of files) {
  let src = readFileSync(file, "utf8");
  const before = src;

  src = src.replace(
    /import\s*\{\s*base44\s*\}\s*from\s*["']@\/api\/base44Client["']\s*;?/g,
    'import { api } from "@/api/dataClient";'
  );
  src = src.replace(
    /import\s*\{\s*base44\s*,\s*([^}]+)\}\s*from\s*["']@\/api\/base44Client["']\s*;?/g,
    'import { api, $1} from "@/api/dataClient";'
  );
  src = src.replace(
    /from\s*["']@\/api\/base44Client["']/g,
    'from "@/api/dataClient"'
  );

  // Só renomeia o identificador de import/uso se o arquivo importa api agora
  // ou ainda tinha base44 do client
  if (src.includes('from "@/api/dataClient"') || before !== src) {
    // Evitar renomear strings "base44" soltas em comentários de localStorage key
    // Substitui usos base44. → api.
    src = src.replace(/\bbase44\./g, "api.");
    // import { base44 as X } already handled
    // leftover: const x = base44
    src = src.replace(/\bbase44\b(?!\s*:)/g, (match, offset, full) => {
      const slice = full.slice(Math.max(0, offset - 30), offset + 40);
      if (/base44_access_token|media\.base44|@base44|\/base44/.test(slice)) {
        return match;
      }
      if (/localStorage\.removeItem\(["']base44/.test(slice)) return match;
      return "api";
    });
  }

  if (src !== before) {
    writeFileSync(file, src, "utf8");
    changed++;
    console.log("updated", file.replace(/\\/g, "/"));
  }
}

console.log(JSON.stringify({ ok: true, files_changed: changed }));
