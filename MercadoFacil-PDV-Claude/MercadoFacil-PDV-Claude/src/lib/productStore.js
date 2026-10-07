import { v4 as uuidv4 } from "uuid";
import { api } from "@/api/dataClient";
import { db } from "./localdb";
import { isDemoSession } from "./demoAccount";
import { enqueue } from "./syncService";

function nowIso() {
  return new Date().toISOString();
}

async function cloudOk() {
  return !isDemoSession() && typeof navigator !== "undefined" && navigator.onLine;
}

/** Lista categorias (grupos): nuvem com fallback local / demo. */
export async function listCategories() {
  if (await cloudOk()) {
    try {
      const cats = await api.entities.Category.list("name", 200);
      if (cats?.length) await db.categories.bulkPut(cats);
      return cats || [];
    } catch (e) {
      console.error("Category.list cloud failed", e);
    }
  }
  return db.categories.orderBy("name").toArray();
}

/** Cria grupo (Category). */
export async function createCategory(payload) {
  const name = String(payload?.name || "").trim();
  if (!name) throw new Error("Informe o nome do grupo");

  if (await cloudOk()) {
    try {
      const created = await api.entities.Category.create(payload);
      await db.categories.put(created);
      return created;
    } catch (e) {
      console.error("Category.create cloud failed", e);
      throw e;
    }
  }

  const clientId = uuidv4();
  const localId = `local-cat-${clientId}`;
  const row = {
    id: localId,
    name,
    color: payload.color || "#10b981",
    company_id: payload.company_id,
    client_id: clientId,
    updated_date: nowIso(),
  };
  await db.categories.put(row);
  await enqueue("CREATE_CATEGORY", "Category", {
    ...row,
    local_id: localId,
  }, clientId);
  return row;
}

export async function updateCategory(id, patch) {
  if (await cloudOk()) {
    const updated = await api.entities.Category.update(id, patch);
    await db.categories.put(updated);
    return updated;
  }
  const prev = await db.categories.get(id);
  const next = { ...prev, ...patch, updated_date: nowIso() };
  await db.categories.put(next);
  if (id && !String(id).startsWith("local-")) {
    await enqueue("UPDATE_CATEGORY", "Category", { id, ...patch });
  }
  return next;
}

export async function deleteCategory(id) {
  if (await cloudOk()) {
    await api.entities.Category.delete(id);
  }
  await db.categories.delete(id);
}

/** Lista produtos. Online: só nuvem (sem fallback silencioso). */
export async function listProducts() {
  if (await cloudOk()) {
    const prods = await api.entities.Product.list("name", 500);
    if (prods?.length) await db.products.bulkPut(prods);
    return prods || [];
  }
  return db.products.orderBy("name").toArray();
}

export async function createProduct(payload) {
  if (await cloudOk()) {
    const created = await api.entities.Product.create(payload);
    await db.products.put(created);
    return created;
  }

  const clientId = uuidv4();
  const localId = `local-prod-${clientId}`;
  const row = {
    id: localId,
    ...payload,
    client_id: clientId,
    active: payload.active !== false,
    updated_date: nowIso(),
    created_date: nowIso(),
  };
  await db.products.put(row);
  const { id: _omit, ...syncPayload } = row;
  await enqueue(
    "CREATE_PRODUCT",
    "Product",
    { ...syncPayload, local_id: localId },
    clientId
  );
  return row;
}

export async function updateProduct(id, payload) {
  if (await cloudOk()) {
    const updated = await api.entities.Product.update(id, payload);
    await db.products.put(updated);
    return updated;
  }
  const prev = await db.products.get(id);
  const next = { ...prev, ...payload, id, updated_date: nowIso() };
  await db.products.put(next);
  if (id && !String(id).startsWith("local-")) {
    await enqueue("UPDATE_PRODUCT", "Product", { id, ...payload });
  }
  return next;
}

export async function deleteProduct(id) {
  if (await cloudOk()) {
    await api.entities.Product.delete(id);
  }
  await db.products.delete(id);
}
