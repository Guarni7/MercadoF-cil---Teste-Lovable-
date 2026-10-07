/**
 * Publica o instalador do PDV no Supabase Storage (bucket público "downloads").
 * Tira o binário de ~100 MB de dentro do repositório/Vercel e do CDN antigo.
 *
 * Uso: node scripts/publish-installer.mjs --file=<caminho do .exe> [--version=1.3.0]
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync, statSync, existsSync } from "fs";
import { resolve, basename } from "path";

function loadEnvLocal() {
  const raw = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
  const env = {};
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    env[m[1].trim()] = v;
  }
  return env;
}

function arg(name) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}

const file = arg("file");
const version = arg("version") || "1.3.0";
const BUCKET = "downloads";

if (!file || !existsSync(file)) {
  console.error(JSON.stringify({ ok: false, error: "informe --file=<caminho do instalador>" }));
  process.exit(1);
}

const env = loadEnvLocal();
const admin = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const { data: buckets, error: listErr } = await admin.storage.listBuckets();
if (listErr) {
  console.error(JSON.stringify({ ok: false, step: "listBuckets", error: listErr.message }));
  process.exit(1);
}

if (!buckets.some((b) => b.name === BUCKET)) {
  const { error } = await admin.storage.createBucket(BUCKET, {
    public: true,
    fileSizeLimit: 500 * 1024 * 1024,
  });
  if (error) {
    console.error(JSON.stringify({ ok: false, step: "createBucket", error: error.message }));
    process.exit(1);
  }
}

const bytes = readFileSync(file);
const objectPath = `pdv/${version}/${basename(file)}`;
const { error: upErr } = await admin.storage.from(BUCKET).upload(objectPath, bytes, {
  contentType: "application/vnd.microsoft.portable-executable",
  upsert: true,
});
if (upErr) {
  console.error(
    JSON.stringify({
      ok: false,
      step: "upload",
      size_mb: +(statSync(file).size / 1024 / 1024).toFixed(1),
      error: upErr.message,
    })
  );
  process.exit(1);
}

const { data: pub } = admin.storage.from(BUCKET).getPublicUrl(objectPath);

// Confirma que o download público realmente responde com o arquivo inteiro.
const head = await fetch(pub.publicUrl, { method: "HEAD" });
const served = Number(head.headers.get("content-length") || 0);

console.log(
  JSON.stringify(
    {
      ok: head.ok && served === bytes.length,
      bucket: BUCKET,
      path: objectPath,
      url: pub.publicUrl,
      size_mb: +(bytes.length / 1024 / 1024).toFixed(1),
      served_bytes: served,
      http_status: head.status,
    },
    null,
    2
  )
);
process.exit(head.ok && served === bytes.length ? 0 : 1);
