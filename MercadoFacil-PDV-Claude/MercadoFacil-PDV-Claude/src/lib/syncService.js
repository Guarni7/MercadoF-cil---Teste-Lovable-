import { db } from "./localdb";
import { api } from "@/api/dataClient";
import { getTerminalId, getTerminalName, getTerminalInfo } from "./terminal";
import { v4 as uuidv4 } from "uuid";
import { isDemoSession } from "./demoAccount";

/**
 * Motor de sincronização offline-first.
 *
 * - Detecta online/offline automaticamente.
 * - Quando online: puxa dados da nuvem → banco local, e processa fila pendente → nuvem.
 * - Quando offline: operações vão para a fila persistente (IndexedDB).
 * - Idempotência: cada operação tem um client_id (UUID) para evitar duplicação.
 * - Conflitos de estoque: usa movimentações (eventos) em vez de sobrescrever o valor.
 */

const listeners = new Set();
let syncState = {
  status: "idle", // idle | syncing | offline | error
  isOnline: navigator.onLine,
  pendingCount: 0,
  syncedCount: 0,
  errorCount: 0,
  lastSync: null,
  errors: [],
  terminal: getTerminalName(),
};

function setState(updates) {
  if (typeof updates === "function") {
    syncState = { ...syncState, ...updates(syncState) };
  } else {
    syncState = { ...syncState, ...updates };
  }
  notify();
}

function notify() {
  listeners.forEach((fn) => fn({ ...syncState }));
}

export function subscribe(fn) {
  listeners.add(fn);
  fn({ ...syncState });
  return () => {
    listeners.delete(fn);
  };
}

export function getSyncState() {
  return { ...syncState };
}

// ========== Inicialização ==========

let initialized = false;

export function initSync() {
  if (initialized) return;
  initialized = true;

  if (isDemoSession()) {
    setState({ status: "idle", isOnline: false, terminal: "DEMO" });
    return;
  }

  window.addEventListener("online", handleOnline);
  window.addEventListener("offline", handleOffline);

  updatePendingCount();
  if (navigator.onLine) {
    fullSync();
  } else {
    setState({ status: "offline" });
  }
}

async function handleOnline() {
  setState({ isOnline: true });
  await fullSync();
}

function handleOffline() {
  setState({ isOnline: false, status: "offline" });
}

// ========== Contagem de pendentes ==========

async function updatePendingCount() {
  const count = await db.sync_queue.where("status").equals("pending").count();
  const errorCount = await db.sync_queue.where("status").equals("error").count();
  setState({ pendingCount: count, errorCount });
}

// ========== Sync completo (pull + push) ==========

export async function fullSync() {
  if (isDemoSession()) {
    setState({ status: "idle", isOnline: false });
    return;
  }
  if (!navigator.onLine) return;

  setState({ status: "syncing", errors: [] });
  try {
    await pullFromCloud();
    await processQueue();
    setState({ status: "idle", lastSync: new Date().toISOString() });
  } catch (e) {
    console.error("Sync failed:", e);
    setState({ status: "error", errors: [{ entity: "general", error: e.message }] });
  }
  await updatePendingCount();
}

// ========== Pull: Nuvem → Banco Local ==========

async function pullFromCloud() {
  try {
    const [products, categories, customers, cashRegisters] = await Promise.all([
      api.entities.Product.list("name", 500),
      api.entities.Category.list("name", 100),
      api.entities.Customer.list("name", 500),
      api.entities.CashRegister.filter({ status: "aberto" }, "-opened_at", 10),
    ]);

    await db.transaction("rw", db.products, db.categories, db.customers, db.cash_registers, async () => {
      await db.products.bulkPut(products);
      await db.categories.bulkPut(categories);
      await db.customers.bulkPut(customers);
      await db.cash_registers.bulkPut(cashRegisters);
    });
  } catch (e) {
    console.error("Pull from cloud failed:", e);
  }
}

// ========== Push: Fila → Nuvem ==========

export async function processQueue() {
  if (!navigator.onLine) return;

  const pending = await db.sync_queue.where("status").equals("pending").sortBy("created_at");
  if (pending.length === 0) return;

  let synced = 0;
  let errors = [];

  for (const item of pending) {
    try {
      await processQueueItem(item);
      await db.sync_queue.update(item.id, {
        status: "synced",
        synced_at: new Date().toISOString(),
      });
      synced++;
    } catch (e) {
      await db.sync_queue.update(item.id, {
        status: "error",
        attempts: (item.attempts || 0) + 1,
        last_error: e.message,
      });
      errors.push({ entity: item.entity, operation: item.operation, error: e.message });
    }
  }

  // Salva histórico
  await db.sync_history.add({
    synced_at: new Date().toISOString(),
    status: errors.length > 0 ? "partial" : "success",
    synced_count: synced,
    error_count: errors.length,
  });

  setState((prev) => ({
    syncedCount: prev.syncedCount + synced,
    errors: [...prev.errors, ...errors].slice(-20),
  }));
  await updatePendingCount();
}

async function processQueueItem(item) {
  switch (item.operation) {
    case "CREATE_SALE":
      await syncCreateSale(item);
      break;
    case "UPDATE_STOCK":
      await syncUpdateStock(item);
      break;
    case "UPDATE_CASH_REGISTER":
      await syncUpdateCashRegister(item);
      break;
    case "CASH_MOVEMENT":
      await syncCashMovement(item);
      break;
    case "UPDATE_CUSTOMER_CREDIT":
      await syncUpdateCustomerCredit(item);
      break;
    case "CREATE_CUSTOMER":
      await syncCreateCustomer(item);
      break;
    case "OPEN_CASH_REGISTER":
      await syncOpenCashRegister(item);
      break;
    case "CLOSE_CASH_REGISTER":
      await syncCloseCashRegister(item);
      break;
    case "CREATE_PRODUCT":
      await syncCreateProduct(item);
      break;
    case "UPDATE_PRODUCT":
      await syncUpdateProduct(item);
      break;
    case "CREATE_CATEGORY":
      await syncCreateCategory(item);
      break;
    case "UPDATE_CATEGORY":
      await syncUpdateCategory(item);
      break;
    default:
      console.warn("Unknown operation:", item.operation);
  }
}

// --- Handlers de sync (idempotentes via client_id) ---

function isUniqueConflict(err) {
  const code = err?.code || err?.error?.code;
  const msg = String(err?.message || err?.error?.message || err || "");
  return code === "23505" || /duplicate|unique|already exists/i.test(msg);
}

async function syncCreateSale(item) {
  // Idempotência: verifica se já foi sincronizado
  try {
    const existing = await api.entities.Sale.filter({ client_id: item.client_id }, null, 1);
    if (existing && existing.length > 0) {
      await reconcileLocalSale(item.client_id, existing[0]);
      return; // Já sincronizado
    }
  } catch {
    // Se o filter falhar, continua — o create pode rejeitar duplicado
  }
  try {
    const created = await api.entities.Sale.create(item.payload);
    await reconcileLocalSale(item.client_id, created);
  } catch (e) {
    if (isUniqueConflict(e)) return; // corrida: já gravado no Supabase
    throw e;
  }
}

/** Troca o número provisório da venda offline pelo definitivo do servidor. */
async function reconcileLocalSale(clientId, remoteSale) {
  if (!clientId || !remoteSale?.number) return;
  try {
    await db.sales.update(`local_${clientId}`, {
      number: remoteSale.number,
      number_pending: false,
      remote_id: remoteSale.id,
    });
  } catch {
    /* o registro local pode já ter sido substituído pelo pull */
  }
}

async function syncUpdateStock(item) {
  const { product_id, quantity, product_name, company_id, sale_client_id } = item.payload;
  const movementClientId = item.payload.client_id || item.client_id;
  try {
    // Baixa e movimentação na mesma transação, idempotente por client_id:
    // reprocessar o item depois de uma falha não baixa o estoque duas vezes.
    // apply_stock_movement (057) pode recusar por saldo insuficiente se a
    // empresa bloqueia estoque negativo — quando isso acontece aqui, a venda
    // offline já foi criada (CREATE_SALE processa antes de UPDATE_STOCK na
    // fila), então não dá pra desfazer só recusando. Não lança: lançar
    // travaria a fila retentando pra sempre o mesmo item. Em vez disso grava
    // uma pendência persistente (stock_sync_pending) — não inventa baixa
    // nenhuma, só documenta que a venda ficou sem baixa correspondente.
    const resultado = await api.stock.applyMovement({
      clientId: movementClientId,
      productId: product_id,
      quantity,
      productName: product_name,
      type: "saida",
      reason: "venda",
      notes: "Sync offline",
      terminalId: item.terminal_id || null,
    });
    if (resultado?.applied === false && resultado.reason === "insufficient_stock") {
      await registrarPendenciaEstoque({
        companyId: company_id,
        saleClientId: sale_client_id,
        productId: product_id,
        productName: product_name,
        quantity,
        clientId: movementClientId,
        terminalId: item.terminal_id || null,
      });
    }
  } catch (e) {
    console.error("Stock sync failed for", product_id, e);
    throw e;
  }
}

/**
 * Registra a pendência vinculada à venda real (resolve sale_id pelo
 * client_id da venda, já sincronizada nesse ponto — CREATE_SALE roda antes
 * de UPDATE_STOCK na mesma fila). Sem achar a venda, grava mesmo assim com
 * sale_id nulo e sale_client_id preenchido — não perde o rastro.
 */
async function registrarPendenciaEstoque({ companyId, saleClientId, productId, productName, quantity, clientId, terminalId }) {
  let saleId = null;
  if (saleClientId) {
    try {
      const vendas = await api.entities.Sale.filter({ client_id: saleClientId }, null, 1);
      saleId = vendas?.[0]?.id || null;
    } catch (e) {
      console.error("[registrarPendenciaEstoque] Falha ao localizar a venda:", e);
    }
  }

  try {
    await api.entities.StockSyncPending.create({
      company_id: companyId,
      sale_id: saleId,
      sale_client_id: saleClientId || null,
      product_id: productId,
      product_name: productName,
      quantity,
      client_id: clientId,
      reason: "insufficient_stock",
      terminal_id: terminalId,
    });
  } catch (e) {
    // client_id repetido (reprocessamento) cai aqui pela unicidade — não é
    // erro de verdade, a pendência já existe.
    if (!isUniqueConflict(e)) {
      console.error("[registrarPendenciaEstoque] Falha ao gravar a pendência de estoque:", e);
    }
  }
}

async function syncUpdateCashRegister(item) {
  const { cash_register_id, sales_total_delta, sales_count_delta } = item.payload;
  try {
    const reg = await api.entities.CashRegister.get(cash_register_id);
    if (!reg) return;
    await api.entities.CashRegister.update(cash_register_id, {
      sales_total: (reg.sales_total || 0) + sales_total_delta,
      sales_count: (reg.sales_count || 0) + sales_count_delta,
    });
  } catch (e) {
    console.error("Cash register sync failed:", e);
    throw e;
  }
}

/**
 * Sangria/suprimento enfileirados offline (dataLayer.js:applyCashMovement) —
 * o RPC recebe o MESMO client_id gravado na fila, então reprocessar o mesmo
 * item (retry depois de erro, ou reenvio manual) não duplica: apply_cash_movement
 * (063) devolve applied:false/already_applied em vez de somar de novo.
 */
async function syncCashMovement(item) {
  const { cash_register_id, type, amount, reason } = item.payload;
  const clientId = item.payload.client_id || item.client_id;
  await api.cash.applyMovement({
    clientId,
    cashRegisterId: cash_register_id,
    type,
    amount,
    reason,
    terminalId: item.terminal_id || null,
  });
}

async function syncUpdateCustomerCredit(item) {
  const { customer_id, credit_delta } = item.payload;
  try {
    const customer = await api.entities.Customer.get(customer_id);
    if (!customer) return;
    await api.entities.Customer.update(customer_id, {
      credit_balance: (customer.credit_balance || 0) + credit_delta,
    });
  } catch (e) {
    console.error("Customer credit sync failed:", e);
    throw e;
  }
}

async function syncCreateCustomer(item) {
  try {
    // Idempotência por client_id
    const existing = await api.entities.Customer.filter({ client_id: item.client_id }, null, 1);
    if (existing && existing.length > 0) return;
  } catch {}
  try {
    await api.entities.Customer.create(item.payload);
  } catch (e) {
    if (isUniqueConflict(e)) return;
    throw e;
  }
}

async function syncOpenCashRegister(item) {
  try {
    if (item.client_id) {
      const existing = await api.entities.CashRegister.filter(
        { client_id: item.client_id },
        null,
        1
      );
      if (existing?.length) return;
    }
  } catch {}
  try {
    await api.entities.CashRegister.create(item.payload);
  } catch (e) {
    if (isUniqueConflict(e)) return;
    throw e;
  }
}

async function syncCloseCashRegister(item) {
  const { cash_register_id, closing_balance, closed_at } = item.payload;
  await api.entities.CashRegister.update(cash_register_id, {
    status: "fechado",
    closing_balance,
    closed_at,
  });
}

async function syncCreateProduct(item) {
  const clientId = item.client_id || item.payload?.client_id;
  if (clientId) {
    try {
      const existing = await api.entities.Product.filter({ client_id: clientId }, null, 1);
      if (existing?.length) {
        await db.products.put(existing[0]);
        if (item.payload?.local_id) await db.products.delete(item.payload.local_id);
        return;
      }
    } catch {}
  }
  const { local_id, ...rest } = item.payload || {};
  const body = { ...rest, client_id: clientId || rest.client_id };
  delete body.id;
  try {
    const created = await api.entities.Product.create(body);
    await db.products.put(created);
    if (local_id) await db.products.delete(local_id);
  } catch (e) {
    if (isUniqueConflict(e) && clientId) {
      const existing = await api.entities.Product.filter({ client_id: clientId }, null, 1);
      if (existing?.[0]) {
        await db.products.put(existing[0]);
        if (local_id) await db.products.delete(local_id);
        return;
      }
    }
    throw e;
  }
}

async function syncUpdateProduct(item) {
  const { id, ...patch } = item.payload || {};
  if (!id || String(id).startsWith("local-")) return;
  const updated = await api.entities.Product.update(id, patch);
  await db.products.put(updated);
}

async function syncCreateCategory(item) {
  const clientId = item.client_id || item.payload?.client_id;
  if (clientId) {
    try {
      const existing = await api.entities.Category.filter({ client_id: clientId }, null, 1);
      if (existing?.length) {
        await db.categories.put(existing[0]);
        if (item.payload?.local_id) await db.categories.delete(item.payload.local_id);
        return;
      }
    } catch {}
  }
  const { local_id, ...rest } = item.payload || {};
  const body = { ...rest, client_id: clientId || rest.client_id };
  delete body.id;
  try {
    const created = await api.entities.Category.create(body);
    await db.categories.put(created);
    if (local_id) await db.categories.delete(local_id);
  } catch (e) {
    if (isUniqueConflict(e) && clientId) {
      const existing = await api.entities.Category.filter({ client_id: clientId }, null, 1);
      if (existing?.[0]) {
        await db.categories.put(existing[0]);
        if (local_id) await db.categories.delete(local_id);
        return;
      }
    }
    throw e;
  }
}

async function syncUpdateCategory(item) {
  const { id, ...patch } = item.payload || {};
  if (!id || String(id).startsWith("local-")) return;
  const updated = await api.entities.Category.update(id, patch);
  await db.categories.put(updated);
}

// ========== Enfileirar operações ==========

export async function enqueue(operation, entity, payload, clientId) {
  const item = {
    client_id: clientId || uuidv4(),
    terminal_id: getTerminalId(),
    terminal_name: getTerminalName(),
    entity,
    operation,
    payload,
    status: "pending",
    attempts: 0,
    created_at: new Date().toISOString(),
  };
  const id = await db.sync_queue.add(item);
  await updatePendingCount();
  // Se online, tenta sincronizar imediatamente
  if (navigator.onLine) {
    processQueue();
  }
  return item;
}

// ========== Sincronizar agora (botão manual) ==========

export async function syncNow() {
  if (isDemoSession()) {
    return { ok: true, message: "Conta demo: dados só neste computador." };
  }
  if (!navigator.onLine) {
    return { ok: false, message: "Sem conexão com a internet." };
  }
  await fullSync();
  return { ok: true };
}

// ========== Estatísticas para a página de sincronização ==========

export async function getSyncStats() {
  const pending = await db.sync_queue.where("status").equals("pending").count();
  const synced = await db.sync_queue.where("status").equals("synced").count();
  const errors = await db.sync_queue.where("status").equals("error").count();
  const history = await db.sync_history.orderBy("synced_at").reverse().limit(20).toArray();
  const errorItems = await db.sync_queue.where("status").equals("error").toArray();

  // Vendas offline sincronizadas cuja baixa de estoque foi recusada
  // (insufficient_stock) — não é erro de sincronização comum (a venda e a
  // fila sincronizaram normalmente), é pendência de reconciliação manual.
  let stockPending = [];
  if (navigator.onLine) {
    try {
      stockPending = await api.entities.StockSyncPending.filter({ resolved: false }, "-created_date", 100);
    } catch (e) {
      console.error("Falha ao carregar pendências de estoque:", e);
    }
  }

  return {
    pending,
    synced,
    errors,
    history,
    errorItems,
    stockPending,
    terminal: getTerminalInfo(),
    lastSync: syncState.lastSync,
  };
}

// ========== Limpar fila sincronizada ==========

export async function clearSynced() {
  await db.sync_queue.where("status").equals("synced").delete();
  await updatePendingCount();
}

// ========== Pendências de estoque (reconciliação manual) ==========

/** Marca a pendência como resolvida depois que o lojista conferiu o estoque manualmente. */
export async function resolveStockPending(id, notes) {
  const user = await api.auth.me().catch(() => null);
  await api.entities.StockSyncPending.update(id, {
    resolved: true,
    resolved_at: new Date().toISOString(),
    resolved_by: user?.id || null,
    resolution_notes: notes || null,
  });
}

// ========== Re-tentar erros ==========

export async function retryErrors() {
  const errorItems = await db.sync_queue.where("status").equals("error").toArray();
  for (const item of errorItems) {
    await db.sync_queue.update(item.id, { status: "pending", last_error: null });
  }
  await updatePendingCount();
  if (navigator.onLine) {
    processQueue();
  }
}