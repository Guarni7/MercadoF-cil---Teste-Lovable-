/**
 * Compara os campos que a UI grava (api.entities.X.create/update) com as
 * colunas que existem no Postgres.
 *
 * Campo que a tela envia e não existe no banco = PostgREST recusa o insert
 * inteiro, e vários módulos falhavam assim em silêncio (contas a pagar,
 * delivery, log de atividades). Este script transforma isso em erro visível.
 *
 * Uso: node scripts/verify-schema-usage.mjs
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

function loadEnvLocal() {
  const raw = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
  const env = {};
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) env[m[1].trim()] = m[2].trim().replace(/^"|"$/g, "");
  }
  return env;
}

const env = loadEnvLocal();

/** Nome da entidade no facade → tabela no Postgres. */
const TABLE_FOR = {
  Product: "products",
  Customer: "customers",
  Category: "categories",
  Brand: "brands",
  Sale: "sales",
  CashRegister: "cash_registers",
  Bill: "bills",
  StockMovement: "stock_movements",
  DeliveryOrder: "delivery_orders",
  ActivityLog: "activity_logs",
  Nfce: "nfces",
  Company: "companies",
  User: "profiles",
};

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(jsx?|tsx?)$/.test(name)) out.push(p);
  }
  return out;
}

/** Extrai as chaves de primeiro nível do objeto literal que começa em `start`. */
function objectKeys(src, start) {
  let depth = 0;
  let i = start;
  const keys = [];
  let buf = "";
  for (; i < src.length; i += 1) {
    const c = src[i];
    if (c === "{" || c === "[" || c === "(") depth += 1;
    if (c === "}" || c === "]" || c === ")") {
      depth -= 1;
      if (depth === 0) break;
    }
    if (depth === 1) {
      if (c === ",") {
        buf = "";
        continue;
      }
      if (c === ":") {
        const k = buf.trim().replace(/^["']|["']$/g, "");
        if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) keys.push(k);
        // pula o valor até a próxima vírgula de nível 1
        let vd = 0;
        for (i += 1; i < src.length; i += 1) {
          const v = src[i];
          if (v === "{" || v === "[" || v === "(") vd += 1;
          else if (v === "}" || v === "]" || v === ")") {
            if (vd === 0) {
              i -= 1;
              break;
            }
            vd -= 1;
          } else if (v === "," && vd === 0) break;
        }
        buf = "";
        continue;
      }
      buf += c;
    }
  }
  return keys;
}

/**
 * Muita tela passa o payload por variável (`api.entities.X.create(form)`).
 * Procura a declaração dessa variável no arquivo e lê as chaves dela.
 */
function keysOfVariable(src, name) {
  const patterns = [
    new RegExp(`(?:const|let|var)\\s+${name}\\s*=\\s*\\{`),
    new RegExp(`\\[\\s*${name}\\s*,\\s*set\\w+\\s*\\]\\s*=\\s*useState\\s*\\(\\s*\\{`),
  ];
  for (const re of patterns) {
    const m = re.exec(src);
    if (m) {
      const start = src.indexOf("{", m.index + m[0].length - 1);
      if (start >= 0) return objectKeys(src, start);
    }
  }
  return [];
}

const usage = {}; // tabela -> Set(campos)
const unresolved = [];
const files = walk(resolve(process.cwd(), "src"));
for (const file of files) {
  const src = readFileSync(file, "utf8");
  const re = /api\.entities\.(\w+)\.(create|update)\s*\(/g;
  let m;
  while ((m = re.exec(src))) {
    const table = TABLE_FOR[m[1]];
    if (!table) continue;
    usage[table] = usage[table] || new Set();
    let i = re.lastIndex;
    // no update o payload vem depois do id
    while (i < src.length && src[i] !== "{" && src[i] !== ")") i += 1;
    if (src[i] === "{") {
      for (const k of objectKeys(src, i)) usage[table].add(k);
      continue;
    }
    const args = src.slice(re.lastIndex, src.indexOf(")", re.lastIndex));
    const ident = args.split(",").pop().trim().replace(/^\.\.\./, "");
    if (/^[A-Za-z_$][\w$]*$/.test(ident)) {
      const keys = keysOfVariable(src, ident);
      if (keys.length) keys.forEach((k) => usage[table].add(k));
      else unresolved.push(`${file.split("src")[1]} → ${m[1]}.${m[2]}(${ident})`);
    }
  }
}

// As listas de safePayload.js são o que de fato sai do cliente nas telas de
// cadastro (produtos, clientes, grupos, marcas, caixa).
const safePayload = readFileSync(
  resolve(process.cwd(), "src/lib/safePayload.js"),
  "utf8",
);
const WHITELIST_TABLE = {
  PRODUCT_FIELDS: "products",
  CUSTOMER_FIELDS: "customers",
  BRAND_FIELDS: "brands",
  CATEGORY_FIELDS: "categories",
  CASH_REGISTER_FIELDS: "cash_registers",
};
for (const [constName, table] of Object.entries(WHITELIST_TABLE)) {
  const m = new RegExp(`${constName}\\s*=\\s*\\[([\\s\\S]*?)\\]`).exec(safePayload);
  if (!m) continue;
  usage[table] = usage[table] || new Set();
  for (const f of m[1].match(/"([^"]+)"/g) || []) {
    usage[table].add(f.replace(/"/g, ""));
  }
}

// O importador tem a própria lista de colunas por tabela; se ela citar coluna
// inexistente, a importação do dump quebra no meio.
const importer = readFileSync(
  resolve(process.cwd(), "scripts/migrate/import-dump.mjs"),
  "utf8",
);
const importerUsage = {};
const tableSetRe = /(\w+):\s*new Set\(\[([\s\S]*?)\]\)/g;
let tm;
while ((tm = tableSetRe.exec(importer))) {
  importerUsage[tm[1]] = new Set(
    (tm[2].match(/"([^"]+)"/g) || []).map((s) => s.replace(/"/g, "")),
  );
}

// Colunas reais: o PostgREST publica o schema em OpenAPI na raiz da API.
const res = await fetch(`${env.VITE_SUPABASE_URL}/rest/v1/`, {
  headers: {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
  },
});
if (!res.ok) {
  console.error("Falha ao ler o schema:", res.status, await res.text());
  process.exit(1);
}
const spec = await res.json();

/** Campos que o cliente cria mas nunca vão para o banco. */
const CLIENT_ONLY = new Set(["id", "created_date", "updated_date"]);

let missing = 0;
const report = {};
for (const [table, fields] of Object.entries(usage)) {
  const def = spec.definitions?.[table];
  if (!def) {
    console.error(`tabela ausente no banco: ${table}`);
    missing += 1;
    continue;
  }
  const columns = new Set(Object.keys(def.properties || {}));
  const gaps = [...fields].filter(
    (f) => !columns.has(f) && !CLIENT_ONLY.has(f),
  );
  report[table] = { campos_usados: fields.size, sem_coluna: gaps };
  missing += gaps.length;
}

for (const [table, fields] of Object.entries(importerUsage)) {
  const def = spec.definitions?.[table];
  if (!def) continue;
  const columns = new Set(Object.keys(def.properties || {}));
  const gaps = [...fields].filter((f) => !columns.has(f));
  if (gaps.length) {
    report[table] = report[table] || {};
    report[table].importador_sem_coluna = gaps;
    missing += gaps.length;
  }
}

console.log(JSON.stringify(report, null, 2));
if (unresolved.length) {
  console.log(
    `\nPayloads que este script não conseguiu ler (conferir à mão):\n- ${unresolved.join("\n- ")}`,
  );
}
if (missing > 0) {
  console.error(`\nFALTA: ${missing} campo(s) sem coluna no banco.`);
  process.exit(1);
}
console.log("\nOK: todo campo gravado pela UI existe no banco.");
