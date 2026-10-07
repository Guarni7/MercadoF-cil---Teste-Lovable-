/**
 * Export Base44 → JSON via `base44 exec --privileged` (usuário CLI autenticado).
 * NÃO apaga origem. Escreve em ./migration-dump/
 *
 * Uso:
 *   Get-Content scripts/migrate/export-via-exec.mjs -Raw | npx base44 --app-id 6aa485b0af8c67a69c3dc4c5 exec --privileged
 * (no PowerShell use pipe LF; ou: node scripts/migrate/run-export-via-exec.mjs)
 */
const ENTITIES = [
  "Company",
  "User",
  "Product",
  "Customer",
  "Category",
  "Brand",
  "CashRegister",
  "Sale",
  "Bill",
  "StockMovement",
  "DeliveryOrder",
  "ActivityLog",
  "Nfce",
];

const LIMIT = 5000;
const out = { exported_at: new Date().toISOString(), counts: {}, errors: {} };

for (const name of ENTITIES) {
  try {
    const rows = await base44.entities[name].list("-created_date", LIMIT);
    const arr = Array.isArray(rows) ? rows : rows?.items || [];
    out[name] = arr;
    out.counts[name] = arr.length;
  } catch (e) {
    out[name] = [];
    out.counts[name] = 0;
    out.errors[name] = String(e?.message || e).slice(0, 300);
  }
}

out.ok = Object.keys(out.errors).length === 0;
out.total = Object.values(out.counts).reduce((a, b) => a + b, 0);
console.log(JSON.stringify(out));
