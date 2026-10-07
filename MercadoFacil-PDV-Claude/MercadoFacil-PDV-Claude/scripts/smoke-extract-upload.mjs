/**
 * Smoke ExtractData local (CSV + XML NF-e mínimo) via Storage Supabase.
 * Uso: node scripts/smoke-extract-upload.mjs
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
    )
      v = v.slice(1, -1);
    env[m[1].trim()] = v;
  }
  return env;
}

const env = loadEnvLocal();
const admin = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const stamp = Date.now();

const csv = "Nome;Preço;Estoque\nProduto A;10.5;3\nProduto B;2;1\n";
const csvPath = `smoke/extract_${stamp}.csv`;
const { error: upErr } = await admin.storage.from("public").upload(csvPath, csv, {
  contentType: "text/csv",
  upsert: true,
});
if (upErr) {
  console.error(JSON.stringify({ ok: false, step: "upload", error: upErr.message }));
  process.exit(1);
}
const { data: pub } = admin.storage.from("public").getPublicUrl(csvPath);
const csvUrl = pub.publicUrl;

const csvRes = await fetch(csvUrl);
const csvText = await csvRes.text();
const lines = csvText.trim().split(/\r?\n/);
const csvOk = lines.length === 3 && lines[0].includes("Nome");

const xml = `<?xml version="1.0"?>
<nfeProc><NFe><infNFe Id="NFe352001"><emit><xNome>Fornecedor Smoke</xNome></emit>
<ide><nNF>123</nNF><dhEmi>2026-01-01</dhEmi></ide>
<det><prod><cProd>1</cProd><xProd>Item</xProd><NCM>123</NCM><CFOP>5102</CFOP><qCom>2</qCom><vUnCom>5</vUnCom><vProd>10</vProd></prod></det>
</infNFe></NFe></nfeProc>`;
const xmlPath = `smoke/extract_${stamp}.xml`;
await admin.storage.from("public").upload(xmlPath, xml, {
  contentType: "application/xml",
  upsert: true,
});
const { data: xmlPub } = admin.storage.from("public").getPublicUrl(xmlPath);
const xmlFetched = await (await fetch(xmlPub.publicUrl)).text();
const xmlOk = xmlFetched.includes("Fornecedor Smoke") && xmlFetched.includes("xProd");

await admin.storage.from("public").remove([csvPath, xmlPath]);

console.log(
  JSON.stringify(
    {
      ok: csvOk && xmlOk,
      csv_rows: lines.length - 1,
      csv_url_readable: csvOk,
      xml_readable: xmlOk,
      storage: "supabase public bucket",
      base44_storage: false,
    },
    null,
    2
  )
);
process.exit(csvOk && xmlOk ? 0 : 1);
