/**
 * Orquestra export Base44 via CLI exec --privileged e grava migration-dump/.
 * Uso: node scripts/migrate/run-export-via-exec.mjs
 */
import { spawn } from "child_process";
import { readFileSync, mkdirSync, writeFileSync, existsSync } from "fs";
import { resolve, join } from "path";
import { ENTITY_TABLE_MAP } from "./entityMap.mjs";

const appId = "6aa485b0af8c67a69c3dc4c5";
const scriptPath = resolve("scripts/migrate/export-via-exec.mjs");
const outDir = resolve("migration-dump");
const source = readFileSync(scriptPath, "utf8").replace(/\r\n/g, "\n");

function run() {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(
      "npx",
      ["base44", `--app-id=${appId}`, "exec", "--privileged", "--json"],
      { shell: true, stdio: ["pipe", "pipe", "pipe"] }
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("close", (code) => {
      resolvePromise({ code: code ?? 1, stdout, stderr });
    });
    child.on("error", reject);
    child.stdin.write(source);
    child.stdin.end();
  });
}

const { code, stdout, stderr } = await run();
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "_raw_exec.json"), stdout);

let payload;
try {
  // CLI pode anexar uma 2ª linha {"output":""} — usar só o 1º JSON
  const firstLine = stdout.trim().split(/\r?\n/).find((l) => l.trim().startsWith("{")) || stdout.trim();
  payload = JSON.parse(firstLine);
  if (payload?.output && typeof payload.output === "string" && payload.output.startsWith("{")) {
    payload = JSON.parse(payload.output);
  }
} catch {
  const start = stdout.indexOf('{"exported_at"');
  const alt = start >= 0 ? start : stdout.indexOf("{");
  const end = stdout.indexOf("\n{", alt + 1);
  const sliceEnd = end > alt ? end : stdout.lastIndexOf("}") + 1;
  if (alt >= 0 && sliceEnd > alt) {
    try {
      payload = JSON.parse(stdout.slice(alt, sliceEnd));
    } catch {
      payload = null;
    }
  }
}

if (!payload || typeof payload !== "object") {
  console.error(
    JSON.stringify(
      {
        ok: false,
        error: "Falha ao parsear export exec",
        exit: code,
        stderr: stderr.slice(-800),
        stdout_head: stdout.slice(0, 400),
      },
      null,
      2
    )
  );
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });
const entities = Object.keys(ENTITY_TABLE_MAP);
const all = {};
for (const e of entities) {
  const rows = Array.isArray(payload[e]) ? payload[e] : [];
  all[e] = rows;
  writeFileSync(join(outDir, `${e}.json`), JSON.stringify(rows, null, 2));
}
writeFileSync(join(outDir, "all.json"), JSON.stringify(all, null, 2));
writeFileSync(
  join(outDir, "_meta.json"),
  JSON.stringify(
    {
      exported_at: payload.exported_at || new Date().toISOString(),
      counts: payload.counts || Object.fromEntries(entities.map((e) => [e, all[e].length])),
      errors: payload.errors || {},
      total: payload.total,
      source: "base44 exec --privileged",
      app_id: appId,
      note: "Origem Base44 NÃO apagada",
    },
    null,
    2
  )
);

const total = entities.reduce((n, e) => n + all[e].length, 0);
console.log(
  JSON.stringify(
    {
      ok: true,
      dir: outDir,
      total,
      counts: Object.fromEntries(entities.map((e) => [e, all[e].length])),
      errors: payload.errors || {},
      exists: existsSync(join(outDir, "all.json")),
    },
    null,
    2
  )
);
