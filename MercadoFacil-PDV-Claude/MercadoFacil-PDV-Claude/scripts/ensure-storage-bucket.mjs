/**
 * Cria bucket Storage "public" (lab). Uso: node scripts/ensure-storage-bucket.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { resolve } from "path";

function loadEnvLocal() {
  const raw = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
  const env = {};
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    env[m[1].trim()] = v;
  }
  return env;
}

const env = loadEnvLocal();
if (!env.VITE_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error(JSON.stringify({ ok: false, error: "Falta URL ou SERVICE_ROLE no .env.local" }));
  process.exit(1);
}

const admin = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const { data: existing, error: listErr } = await admin.storage.listBuckets();
if (listErr) {
  console.error(JSON.stringify({ ok: false, error: listErr.message }));
  process.exit(1);
}

const names = (existing || []).map((b) => b.name);
let created = false;
if (!names.includes("public")) {
  const { error } = await admin.storage.createBucket("public", {
    public: true,
    fileSizeLimit: 10 * 1024 * 1024,
  });
  if (error) {
    console.error(JSON.stringify({ ok: false, error: error.message }));
    process.exit(1);
  }
  created = true;
}

// smoke: upload + public URL + delete
const path = `uploads/smoke-${Date.now()}.txt`;
const blob = new Blob([`smoke ${new Date().toISOString()}`], { type: "text/plain" });
const { error: upErr } = await admin.storage.from("public").upload(path, blob, {
  contentType: "text/plain",
  upsert: true,
});
if (upErr) {
  console.error(JSON.stringify({ ok: false, step: "upload", error: upErr.message }));
  process.exit(1);
}
const { data: pub } = admin.storage.from("public").getPublicUrl(path);
const { error: delErr } = await admin.storage.from("public").remove([path]);
if (delErr) {
  console.error(JSON.stringify({ ok: false, step: "delete", error: delErr.message }));
  process.exit(1);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      buckets: names.includes("public") ? names : [...names, "public"],
      created,
      uploadUrl: pub?.publicUrl || null,
      deleted: true,
    },
    null,
    2
  )
);
