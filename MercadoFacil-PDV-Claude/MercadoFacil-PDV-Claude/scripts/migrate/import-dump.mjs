/**
 * Importa dump JSON Base44 → Supabase (NÃO apaga origem).
 *
 * Estrutura esperada em --dir:
 *   Company.json, Product.json, ... (array de records)
 *   OU all.json { "Product": [...], ... }
 *
 * Uso:
 *   node scripts/migrate/import-dump.mjs --dir=./migration-dump --company-id=<uuid>
 *   node scripts/migrate/import-dump.mjs --dir=./migration-dump --company-id=<uuid> --dry-run
 *
 * Relatório: stdout JSON com counts + divergences + id_map.
 * Requer SUPABASE_SERVICE_ROLE_KEY em .env.local.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from "fs";
import { resolve, join } from "path";
import { randomUUID } from "crypto";
import { ENTITY_TABLE_MAP, IMPORT_ORDER } from "./entityMap.mjs";

/** Colunas aceitas por tabela (filtra lixo Base44). */
const TABLE_COLUMNS = {
  companies: new Set([
    "id",
    "trade_name",
    "legal_name",
    "document",
    "phone",
    "email",
    "cep",
    "address",
    "address_number",
    "complement",
    "neighborhood",
    "city",
    "state",
    "status",
    "plan",
    "plan_status",
    "plan_expires_at",
    "trial_started_at",
    "created_at",
    "updated_at",
  ]),
  profiles: new Set([
    "id",
    "email",
    "full_name",
    "role",
    "company_id",
    "plan_status",
    "plan",
    "plan_expires_at",
    "trial_started_at",
    "created_at",
    "updated_at",
  ]),
  products: new Set([
    "id",
    "name",
    "code",
    "barcode",
    "reference",
    "price",
    "cost",
    "average_cost",
    "stock",
    "min_stock",
    "category",
    "subcategory",
    "brand",
    "channels",
    "unit",
    "image_url",
    "notes",
    "promo",
    "fiscal_info",
    "active",
    "company_id",
    "client_id",
    "created_at",
    "updated_at",
  ]),
  customers: new Set([
    "id",
    "name",
    "document",
    "phone",
    "email",
    "birthday",
    "cep",
    "address",
    "address_number",
    "complement",
    "neighborhood",
    "city",
    "state",
    "credit_limit",
    "credit_balance",
    "client_id",
    "notes",
    "nickname",
    "trade_name",
    "legal_name",
    "ie",
    "company_id",
    "created_at",
    "updated_at",
  ]),
  categories: new Set(["id", "name", "color", "company_id", "client_id", "created_at", "updated_at"]),
  brands: new Set(["id", "name", "company_id", "client_id", "created_at", "updated_at"]),
  cash_registers: new Set([
    "id",
    "status",
    "opening_balance",
    "closing_balance",
    "opened_at",
    "closed_at",
    "opened_by_name",
    "sales_total",
    "sales_count",
    "notes",
    "terminal_id",
    "terminal_name",
    "client_id",
    "company_id",
    "created_at",
    "updated_at",
  ]),
  sales: new Set([
    "id",
    "number",
    "items",
    "subtotal",
    "discount",
    "total",
    "payment_method",
    "amount_received",
    "change",
    "status",
    "customer_id",
    "customer_name",
    "cash_register_id",
    "created_by_id",
    "created_by_name",
    "pix_payment_id",
    "pix_external_reference",
    "client_id",
    "terminal_id",
    "company_id",
    "created_at",
    "updated_at",
  ]),
  bills: new Set([
    "id",
    "description",
    "amount",
    "due_date",
    "paid",
    "paid_date",
    "status",
    "category",
    "subcategory",
    "supplier",
    "recurring",
    "type",
    "notes",
    "company_id",
    "created_at",
    "updated_at",
  ]),
  stock_movements: new Set([
    "id",
    "product_id",
    "product_name",
    "type",
    "quantity",
    "reason",
    "notes",
    "company_id",
    "created_at",
    "updated_at",
  ]),
  delivery_orders: new Set([
    "id",
    "number",
    "customer_id",
    "customer_name",
    "customer_phone",
    "address",
    "address_number",
    "complement",
    "neighborhood",
    "city",
    "state",
    "cep",
    "items",
    "subtotal",
    "delivery_fee",
    "discount",
    "total",
    "payment_method",
    "delivery_person",
    "scheduled_for",
    "status",
    "notes",
    "company_id",
    "created_at",
    "updated_at",
  ]),
  activity_logs: new Set([
    "id",
    "type",
    "description",
    "severity",
    "amount",
    "discrepancy",
    "cash_register_id",
    "sale_number",
    "payment_method",
    "details",
    "user_name",
    "user_role",
    "change_amount",
    "company_id",
    "created_at",
    "created_date",
  ]),
  nfces: new Set([
    "id",
    "number",
    "series",
    "issue_date",
    "sale_id",
    "sale_number",
    "customer_id",
    "customer_name",
    "customer_document",
    "items",
    "subtotal",
    "discount",
    "total",
    "payment_method",
    "cfop",
    "status",
    "access_key",
    "protocol",
    "environment",
    "xml",
    "key",
    "company_id",
    "created_at",
  ]),
};

/** Campos FK entity→entity para remap via idMap. */
const FK_REMAP = {
  profiles: { company_id: "Company" },
  products: { company_id: "Company" },
  customers: { company_id: "Company" },
  categories: { company_id: "Company" },
  brands: { company_id: "Company" },
  cash_registers: { company_id: "Company" },
  sales: {
    company_id: "Company",
    customer_id: "Customer",
    cash_register_id: "CashRegister",
  },
  bills: { company_id: "Company" },
  stock_movements: { company_id: "Company", product_id: "Product" },
  delivery_orders: { company_id: "Company", customer_id: "Customer" },
  activity_logs: { company_id: "Company" },
  nfces: { company_id: "Company", sale_id: "Sale" },
};

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

function arg(name, fallback = null) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

function isUuid(v) {
  return (
    typeof v === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      v
    )
  );
}

function loadDump(dir) {
  const allPath = join(dir, "all.json");
  if (existsSync(allPath)) {
    return JSON.parse(readFileSync(allPath, "utf8"));
  }
  const out = {};
  for (const ent of Object.keys(ENTITY_TABLE_MAP)) {
    const p = join(dir, `${ent}.json`);
    if (existsSync(p)) out[ent] = JSON.parse(readFileSync(p, "utf8"));
  }
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".json") || f === "all.json" || f === "id_map.json") continue;
    const ent = f.replace(/\.json$/, "");
    if (ENTITY_TABLE_MAP[ent] && !out[ent]) {
      out[ent] = JSON.parse(readFileSync(join(dir, f), "utf8"));
    }
  }
  return out;
}

function ensureMappedId(entity, oldId, idMap) {
  if (oldId == null || oldId === "") return null;
  const s = String(oldId);
  if (isUuid(s)) {
    idMap[`${entity}:${s}`] = s;
    return s;
  }
  const key = `${entity}:${s}`;
  if (!idMap[key]) idMap[key] = randomUUID();
  return idMap[key];
}

function pickColumns(table, row) {
  const allow = TABLE_COLUMNS[table];
  if (!allow) return row;
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    if (allow.has(k)) out[k] = v;
  }
  return out;
}

function normalizeRecord(entity, row, forcedCompanyId, idMap) {
  const table = ENTITY_TABLE_MAP[entity];
  const r = { ...row };
  const oldId = r.id;

  if (r.created_date && !r.created_at) r.created_at = r.created_date;
  if (r.updated_date && !r.updated_at) r.updated_at = r.updated_date;
  delete r.created_date;
  delete r.updated_date;
  delete r.is_sample;
  // created_by_id só sobrevive onde há coluna (sales); o resto cai no filtro
  // de colunas mais adiante.
  delete r.updated_at; // várias tabelas não têm updated_at

  // aliases comuns Base44 → schema
  if (entity === "Company") {
    if (r.name && !r.trade_name) r.trade_name = r.name;
    if (r.cnpj && !r.document) r.document = r.cnpj;
  }
  if (entity === "User") {
    if (r.name && !r.full_name) r.full_name = r.name;
  }
  if (entity === "ActivityLog") {
    if (r.paymentMethod && !r.payment_method) r.payment_method = r.paymentMethod;
    if (r.cashRegisterId && !r.cash_register_id) r.cash_register_id = r.cashRegisterId;
    if (r.saleNumber != null && r.sale_number == null) r.sale_number = r.saleNumber;
    if (r.changeAmount != null && r.change_amount == null) r.change_amount = r.changeAmount;
    delete r.paymentMethod;
    delete r.cashRegisterId;
    delete r.saleNumber;
    delete r.changeAmount;
  }
  if (entity === "Bill") {
    // Base44 gravava a data da baixa em paid_at; a tela usa paid_date.
    if (r.paid_at && !r.paid_date) r.paid_date = r.paid_at;
    delete r.paid_at;
  }
  if (entity === "Nfce") {
    if (r.chave && !r.access_key) r.access_key = r.chave;
    if (r.access_key && !r.key) r.key = r.access_key;
    if (r.protocolo && !r.protocol) r.protocol = r.protocolo;
    delete r.chave;
    delete r.protocolo;
  }

  r.id = ensureMappedId(entity, oldId, idMap);

  const fks = FK_REMAP[table] || {};
  for (const [field, refEntity] of Object.entries(fks)) {
    if (r[field] != null && r[field] !== "") {
      r[field] = ensureMappedId(refEntity, r[field], idMap);
    }
  }

  if (entity !== "Company" && forcedCompanyId) {
    r.company_id = forcedCompanyId;
  }

  return pickColumns(table, r);
}

const env = loadEnvLocal();
const dir = resolve(process.cwd(), arg("dir", "migration-dump"));
const companyIdArg = arg("company-id");
const dry = process.argv.includes("--dry-run");

if (!existsSync(dir)) {
  console.error(
    JSON.stringify({
      ok: false,
      error: `Diretório dump não encontrado: ${dir}`,
      hint: "Exporte entidades Base44 para JSON (sem apagar) e passe --dir=",
    })
  );
  process.exit(1);
}

const dump = loadDump(dir);
const admin = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const idMapPath = join(dir, "id_map.json");
const idMap = existsSync(idMapPath)
  ? JSON.parse(readFileSync(idMapPath, "utf8"))
  : {};
const report = {
  ok: true,
  dry_run: dry,
  imported: {},
  skipped: {},
  errors: [],
  divergences: [],
  id_map_entries: 0,
};

let forcedCompanyId = companyIdArg;
if (forcedCompanyId && !isUuid(forcedCompanyId)) {
  console.error(JSON.stringify({ ok: false, error: "company-id deve ser UUID" }));
  process.exit(1);
}

// companyIdArg força tenant único; sem ele, company_id vem do dump + id_map (multi-loja).
const forceSingleCompany = Boolean(companyIdArg);

for (const entity of IMPORT_ORDER) {
  const rows = dump[entity];
  if (!rows) continue;
  if (!Array.isArray(rows)) {
    report.errors.push({ entity, error: "dump não é array" });
    continue;
  }
  const table = ENTITY_TABLE_MAP[entity];
  let ok = 0;
  let skip = 0;

  // Pass 1: register all ids for this entity (so FKs in later entities resolve)
  for (const raw of rows) {
    if (raw?.id != null) ensureMappedId(entity, raw.id, idMap);
  }

  for (const raw of rows) {
    try {
      const rec = normalizeRecord(
        entity,
        raw,
        forceSingleCompany ? forcedCompanyId : null,
        idMap
      );
      if (!rec.id) {
        skip++;
        report.divergences.push({ entity, reason: "sem id", raw_keys: Object.keys(raw || {}) });
        continue;
      }
      if (entity === "User") {
        // profiles.id = auth.users.id — precisa existir no Auth
        const { data: authUser } = await admin.auth.admin.getUserById(rec.id);
        if (!authUser?.user) {
          skip++;
          report.divergences.push({
            entity,
            reason: "profile id sem usuário auth correspondente",
            old_id: raw.id,
            new_id: rec.id,
          });
          continue;
        }
      }
      if (entity === "Company" && !forcedCompanyId) {
        // só para relatório destination_counts (1ª empresa); não força tenant
        forcedCompanyId = rec.id;
      }
      if (dry) {
        ok++;
        continue;
      }
      const { error } = await admin.from(table).upsert(rec, { onConflict: "id" });
      if (error) {
        report.errors.push({ entity, id: rec.id, error: error.message });
      } else {
        ok++;
      }
    } catch (e) {
      report.errors.push({ entity, error: e.message });
    }
  }
  report.imported[entity] = ok;
  report.skipped[entity] = skip;
}

report.id_map_entries = Object.keys(idMap).length;
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, "id_map.json"), JSON.stringify(idMap, null, 2));

if (!dry) {
  // Conferência: soma em TODAS as empresas migradas (não só a primeira)
  const companyIds = forceSingleCompany
    ? [forcedCompanyId]
    : [
        ...new Set(
          Object.entries(idMap)
            .filter(([k]) => k.startsWith("Company:"))
            .map(([, v]) => v)
            .filter(Boolean)
        ),
      ];

  report.destination_counts = {};
  report.destination_by_company = {};
  report.source_counts = {};

  for (const [entity, table] of Object.entries(ENTITY_TABLE_MAP)) {
    const src = dump[entity];
    report.source_counts[entity] = Array.isArray(src) ? src.length : 0;
    if (entity === "Company" || entity === "User") continue;

    let total = 0;
    for (const cid of companyIds) {
      const { count } = await admin
        .from(table)
        .select("*", { count: "exact", head: true })
        .eq("company_id", cid);
      const n = count || 0;
      total += n;
      if (n > 0) {
        report.destination_by_company[cid] = report.destination_by_company[cid] || {};
        report.destination_by_company[cid][entity] = n;
      }
    }
    report.destination_counts[entity] = total;

    const expected = report.imported[entity] || 0;
    if (total !== expected) {
      report.divergences.push({
        entity,
        reason: "contagem destino ≠ importados",
        destination: total,
        imported: expected,
        source: Array.isArray(src) ? src.length : 0,
      });
    }
  }
  report.company_ids = companyIds;
}

report.ok = report.errors.length === 0;
console.log(JSON.stringify(report, null, 2));
process.exit(report.ok ? 0 : 1);
