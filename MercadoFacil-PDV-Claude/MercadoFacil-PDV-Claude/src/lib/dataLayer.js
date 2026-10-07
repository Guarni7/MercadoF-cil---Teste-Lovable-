import { db } from "./localdb";
import { api } from "@/api/dataClient";
import { enqueue } from "./syncService";
import { v4 as uuidv4 } from "uuid";
import { getTerminalId, getTerminalName } from "./terminal";
import { isDemoSession } from "./demoAccount";
import { getCachedAuth } from "./offlineAuth";
import { getUserCompanyId } from "./companyContext";
import { valorCrediarioDaVenda } from "./crediario";

/**
 * Camada de dados offline-first.
 * - Quando online: lê da nuvem, atualiza o cache local.
 * - Quando offline: lê do banco local (IndexedDB).
 * - Escritas offline vão para o banco local + fila de sincronização.
 * - Conta demo: só IndexedDB (sem nuvem).
 */

export const isOnline = () => navigator.onLine && !isDemoSession();

// ========== LEITURA (com fallback automático) ==========

/**
 * O banco local é do navegador, não da empresa: se o mesmo computador já entrou
 * em outra empresa, o cache guarda as duas. Offline, o RLS não está lá para
 * separar — então filtramos pela empresa da sessão.
 */
async function localScope() {
  try {
    const user = await getCachedAuth();
    return getUserCompanyId(user);
  } catch {
    return null;
  }
}

function ofCompany(rows, companyId) {
  if (!companyId) return rows;
  return rows.filter((r) => !r.company_id || r.company_id === companyId);
}

export async function loadProducts() {
  if (isOnline()) {
    try {
      const products = await api.entities.Product.list("name", 500);
      await db.products.bulkPut(products);
      return products.filter((p) => p.active !== false);
    } catch (e) {
      console.error("Cloud load failed, using local:", e);
    }
  }
  const local = ofCompany(await db.products.toArray(), await localScope());
  return local
    .filter((p) => p.active !== false)
    .sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "pt-BR"));
}

export async function loadCategories() {
  if (isOnline()) {
    try {
      const cats = await api.entities.Category.list("name", 100);
      await db.categories.bulkPut(cats);
      return cats;
    } catch (e) {
      console.error("Cloud load failed, using local:", e);
    }
  }
  return ofCompany(await db.categories.toArray(), await localScope());
}

export async function loadCustomers() {
  if (isOnline()) {
    try {
      const custs = await api.entities.Customer.list("name", 500);
      await db.customers.bulkPut(custs);
      return custs;
    } catch (e) {
      console.error("Cloud load failed, using local:", e);
    }
  }
  return ofCompany(await db.customers.toArray(), await localScope());
}

/** Histórico de caixas (tela de Fluxo de Caixa) — mesmo padrão das outras leituras. */
export async function loadCashRegisters(limit = 50) {
  if (isOnline()) {
    try {
      const regs = await api.entities.CashRegister.list("-opened_at", limit);
      await db.cash_registers.bulkPut(regs);
      return regs;
    } catch (e) {
      console.error("Cloud load failed, using local:", e);
    }
  }
  const local = ofCompany(await db.cash_registers.toArray(), await localScope());
  return local
    .sort((a, b) => new Date(b.opened_at).getTime() - new Date(a.opened_at).getTime())
    .slice(0, limit);
}

export async function loadOpenCashRegister() {
  if (isOnline()) {
    try {
      const regs = await api.entities.CashRegister.filter({ status: "aberto" }, "-opened_at", 1);
      if (regs[0]) await db.cash_registers.put(regs[0]);
      return regs[0] || null;
    } catch (e) {
      console.error("Cloud load failed, using local:", e);
    }
  }
  const local = await db.cash_registers.where("status").equals("aberto").toArray();
  return ofCompany(local, await localScope())[0] || null;
}

/** Vendas do terminal que ainda não subiram, para as telas de listagem. */
export async function loadLocalSales() {
  const local = await db.sales.toArray();
  return ofCompany(local, await localScope());
}

/**
 * Histórico de vendas para as telas de consulta. Online, guarda o que veio do
 * servidor para que a mesma tela continue útil se a internet cair; a venda
 * feita offline entra na lista mesmo antes de sincronizar.
 */
export async function loadSales(limit = 200) {
  let remote = null;
  if (isOnline()) {
    try {
      remote = await api.entities.Sale.list("-created_date", limit);
      await db.sales.bulkPut(remote);
    } catch (e) {
      console.error("Cloud load failed, using local:", e);
    }
  }

  // A venda offline vira duas linhas (a local e a do servidor depois do sync):
  // client_id junta as duas e a versão numerada pelo servidor prevalece.
  const byKey = new Map();
  const add = (sale) => {
    const key = sale.client_id || sale.id;
    const prev = byKey.get(key);
    if (!prev || (!prev.number && sale.number)) byKey.set(key, sale);
  };
  (remote || []).forEach(add);
  (await loadLocalSales()).forEach(add);

  return [...byKey.values()]
    .sort((a, b) => new Date(b.created_date || 0).getTime() - new Date(a.created_date || 0).getTime())
    .slice(0, limit);
}

// ========== ESCRITA — VENDA (offline-first) ==========

export async function createSaleOffline(saleData, cart, cashRegister, customer) {
  const clientId = uuidv4();
  const terminalId = getTerminalId();
  const terminalName = getTerminalName();
  const now = new Date().toISOString();

  const sale = {
    ...saleData,
    client_id: clientId,
    terminal_id: terminalId,
    terminal_name: terminalName,
    status: "concluida",
    created_date: now,
  };

  // 1. Salva venda no banco local
  const localId = `local_${clientId}`;
  // Sem número: o definitivo vem do banco na sincronização (reconcileLocalSale).
  await db.sales.put({ ...sale, id: localId, number: null, number_pending: true });

  // 2. Atualiza estoque no banco local
  for (const item of cart.filter((i) => !i.product.semEstoque)) {
    const product = await db.products.get(item.product.id);
    if (product) {
      await db.products.update(item.product.id, {
        stock: (product.stock || 0) - item.quantity,
      });
    }
    // Registra movimentação de estoque local
    await db.stock_movements.put({
      id: `local_sm_${uuidv4()}`,
      product_id: item.product.id,
      product_name: item.product.name,
      type: "saida",
      quantity: item.quantity,
      reason: "venda",
      client_id: clientId,
      terminal_id: terminalId,
      created_date: now,
    });
  }

  // 3. Atualiza caixa no banco local
  if (cashRegister) {
    await db.cash_registers.update(cashRegister.id, {
      sales_total: (cashRegister.sales_total || 0) + sale.total,
      sales_count: (cashRegister.sales_count || 0) + 1,
    });
  }

  // 4. Atualiza saldo do cliente no banco local (crediário)
  const valorCrediario = valorCrediarioDaVenda(sale);
  if (valorCrediario > 0 && saleData.customer_id && customer) {
    await db.customers.update(saleData.customer_id, {
      credit_balance: (customer.credit_balance || 0) + valorCrediario,
    });
  }

  // 5. Enfileira operações para sincronização (sem número: quem numera é o banco)
  await enqueue("CREATE_SALE", "Sale", { ...sale, number: null }, clientId);

  for (const item of cart.filter((i) => !i.product.semEstoque)) {
    const stockClientId = `${clientId}-${item.product.id}`;
    await enqueue(
      "UPDATE_STOCK",
      "Product",
      {
        product_id: item.product.id,
        product_name: item.product.name,
        quantity: item.quantity,
        client_id: stockClientId,
        company_id: sale.company_id,
        // client_id da própria venda (sales.client_id) — se a baixa for
        // recusada por saldo insuficiente na sincronização, é assim que
        // syncUpdateStock acha a venda real pra vincular a pendência.
        sale_client_id: clientId,
      },
      stockClientId
    );
  }

  if (cashRegister) {
    await enqueue("UPDATE_CASH_REGISTER", "CashRegister", {
      cash_register_id: cashRegister.id,
      sales_total_delta: sale.total,
      sales_count_delta: 1,
    });
  }

  if (valorCrediario > 0 && saleData.customer_id) {
    await enqueue("UPDATE_CUSTOMER_CREDIT", "Customer", {
      customer_id: saleData.customer_id,
      credit_delta: valorCrediario,
    });
  }

  return { ...sale, id: localId };
}

// ========== ESCRITA — CLIENTE (offline-first) ==========

export async function createCustomerOffline(customerData) {
  const clientId = uuidv4();
  const terminalId = getTerminalId();

  const customer = {
    ...customerData,
    client_id: clientId,
    terminal_id: terminalId,
    created_date: new Date().toISOString(),
  };

  const localId = `local_${clientId}`;
  await db.customers.put({ ...customer, id: localId });
  await enqueue("CREATE_CUSTOMER", "Customer", customer, clientId);

  return { ...customer, id: localId };
}

// ========== ESCRITA — CAIXA (offline-first) ==========

export async function openCashRegisterOffline(openingBalance, userName) {
  const clientId = uuidv4();
  const terminalId = getTerminalId();
  const terminalName = getTerminalName();
  const now = new Date().toISOString();

  const cashReg = {
    status: "aberto",
    opening_balance: openingBalance,
    opened_at: now,
    opened_by_name: userName,
    sales_total: 0,
    sales_count: 0,
    terminal_id: terminalId,
    terminal_name: terminalName,
    client_id: clientId,
  };

  const localId = `local_${clientId}`;
  await db.cash_registers.put({ ...cashReg, id: localId });
  await enqueue("OPEN_CASH_REGISTER", "CashRegister", cashReg, clientId);

  return { ...cashReg, id: localId };
}

export async function closeCashRegisterOffline(cashRegisterId, closingBalance) {
  const now = new Date().toISOString();
  await db.cash_registers.update(cashRegisterId, {
    status: "fechado",
    closing_balance: closingBalance,
    closed_at: now,
  });
  await enqueue("CLOSE_CASH_REGISTER", "CashRegister", {
    cash_register_id: cashRegisterId,
    closing_balance: closingBalance,
    closed_at: now,
  });
}

// ========== ESCRITA — MOVIMENTAÇÃO DE CAIXA (sangria/suprimento) ==========

/**
 * Sangria (retirada) ou suprimento (reforço) de caixa — nunca lê o total no
 * estado React e soma por cima (perde atualização sob concorrência entre
 * terminais): sempre passa por apply_cash_movement (client_id idempotente,
 * coluna = coluna + valor atômico no banco, 063_cash_movements.sql).
 *
 * Offline, atualiza o cache local para a tela refletir na hora e enfileira
 * para sincronizar quando a conexão voltar — o MESMO client_id viaja com a
 * fila, então reenvio/retry não duplica a movimentação.
 */
export async function applyCashMovement(cashRegister, { type, amount, reason }) {
  const clientId = uuidv4();
  const terminalId = getTerminalId();

  if (isOnline()) {
    return api.cash.applyMovement({
      clientId,
      cashRegisterId: cashRegister.id,
      type,
      amount,
      reason,
      terminalId,
    });
  }

  const field = type === "sangria" ? "withdrawals_total" : "supplies_total";
  const atual = (await db.cash_registers.get(cashRegister.id))?.[field] ?? cashRegister[field] ?? 0;
  await db.cash_registers.update(cashRegister.id, { [field]: atual + amount });

  await enqueue(
    "CASH_MOVEMENT",
    "CashRegister",
    {
      cash_register_id: cashRegister.id,
      type,
      amount,
      reason,
      client_id: clientId,
      terminal_id: terminalId,
    },
    clientId
  );

  return { applied: true, offline: true };
}