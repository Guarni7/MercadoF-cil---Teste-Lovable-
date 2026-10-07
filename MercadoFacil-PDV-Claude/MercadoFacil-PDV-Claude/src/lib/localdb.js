import Dexie from "dexie";

/**
 * Banco local persistente via IndexedDB (Dexie).
 * Sobrevive a fechamento do navegador, reinicialização do Windows e queda de energia.
 * Não utiliza localStorage para dados operacionais — apenas IndexedDB.
 */
/**
 * @type {Dexie & {
 *   products: Dexie.Table<any, string>,
 *   categories: Dexie.Table<any, string>,
 *   customers: Dexie.Table<any, string>,
 *   sales: Dexie.Table<any, string>,
 *   stock_movements: Dexie.Table<any, string>,
 *   cash_registers: Dexie.Table<any, string>,
 *   sync_queue: Dexie.Table<any, number>,
 *   sync_history: Dexie.Table<any, number>,
 *   settings: Dexie.Table<any, string>,
 *   auth_cache: Dexie.Table<any, string>,
 * }}
 */
const db = /** @type {any} */ (new Dexie("MercadoFacilPDV"));

db.version(1).stores({
  // Dados operacionais (espelho da nuvem)
  products: "id, name, barcode, code, category, active, updated_date",
  categories: "id, name, updated_date",
  customers: "id, name, document, phone, updated_date",
  sales: "id, number, status, client_id, terminal_id, created_date, customer_id",
  stock_movements: "id, product_id, type, client_id, terminal_id, created_date",
  cash_registers: "id, status, terminal_id, opened_at",

  // Fila de sincronização (persistente)
  sync_queue: "++id, client_id, entity, operation, status, created_at, [status+created_at]",

  // Histórico de sincronizações
  sync_history: "++id, synced_at, status, synced_count, error_count",

  // Configurações e cache de auth
  settings: "key",
  auth_cache: "key",
});

// Garante que o banco abre
db.open().catch((err) => console.error("Failed to open local DB:", err));

export { db };