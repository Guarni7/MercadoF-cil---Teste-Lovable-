import { db } from "./localdb";
import { cacheAuth, clearCachedAuth } from "./offlineAuth";

/** Conta demo local — sem OTP / sem e-mail. Só para teste do instalador e PDV. */
export const DEMO_EMAIL = "demo@mercadofacil.local";
export const DEMO_PASSWORD = "demo1234";

const DEMO_FLAG = "mf_demo_session";
const DEMO_COMPANY_ID = "demo-company-local";

export function getDemoUser() {
  const expires = new Date();
  expires.setFullYear(expires.getFullYear() + 1);
  return {
    id: "demo-user-local",
    email: DEMO_EMAIL,
    full_name: "Conta Demo",
    role: "admin",
    company_id: DEMO_COMPANY_ID,
    company_role: "owner",
    plan: "simples",
    plan_status: "trial",
    plan_expires_at: expires.toISOString(),
    trial_started_at: new Date().toISOString(),
    is_verified: true,
    platform_admin: false,
    is_demo: true,
  };
}

export function isDemoEmail(email) {
  const e = String(email || "")
    .trim()
    .toLowerCase()
    .normalize("NFKC");
  return (
    e === DEMO_EMAIL ||
    e === "demo@mercadofacil.com" ||
    e === "demo@mercadofacil.local" ||
    e === "demo" ||
    e.startsWith("demo@")
  );
}

export function isDemoCredentials(email, password) {
  const pass = String(password || "")
    .trim()
    .normalize("NFKC");
  return isDemoEmail(email) && pass.toLowerCase() === DEMO_PASSWORD.toLowerCase();
}

export function isDemoSession() {
  try {
    return localStorage.getItem(DEMO_FLAG) === "1";
  } catch {
    return false;
  }
}

export async function startDemoSession() {
  localStorage.setItem(DEMO_FLAG, "1");
  const user = getDemoUser();
  await cacheAuth(user);
  await seedDemoCatalog();
  return user;
}

export async function endDemoSession() {
  try {
    localStorage.removeItem(DEMO_FLAG);
  } catch {}
  await clearCachedAuth();
}

/** Produtos de exemplo no IndexedDB para vender no PDV demo. */
export async function seedDemoCatalog() {
  const now = new Date().toISOString();
  const products = [
    {
      id: "demo-prod-1",
      name: "ARROZ TIPO 1 5KG",
      barcode: "7891000100103",
      code: "1",
      price: 28.9,
      cost: 22,
      stock: 50,
      unit: "UN",
      active: true,
      company_id: DEMO_COMPANY_ID,
      updated_date: now,
    },
    {
      id: "demo-prod-2",
      name: "FEIJAO CARIOCA 1KG",
      barcode: "7891000100104",
      code: "2",
      price: 8.5,
      cost: 6,
      stock: 80,
      unit: "UN",
      active: true,
      company_id: DEMO_COMPANY_ID,
      updated_date: now,
    },
    {
      id: "demo-prod-3",
      name: "OLEO DE SOJA 900ML",
      barcode: "7891000100105",
      code: "3",
      price: 7.99,
      cost: 5.5,
      stock: 60,
      unit: "UN",
      active: true,
      company_id: DEMO_COMPANY_ID,
      updated_date: now,
    },
    {
      id: "demo-prod-4",
      name: "REFRIGERANTE 2L",
      barcode: "7891000100106",
      code: "4",
      price: 9.9,
      cost: 6.5,
      stock: 40,
      unit: "UN",
      active: true,
      company_id: DEMO_COMPANY_ID,
      updated_date: now,
    },
  ];
  await db.products.bulkPut(products);

  const existingCats = await db.categories.count();
  if (!existingCats) {
    await db.categories.put({
      id: "demo-cat-geral",
      name: "GERAL",
      color: "#10b981",
      company_id: DEMO_COMPANY_ID,
      updated_date: now,
    });
  }

  const openRegs = await db.cash_registers.where("status").equals("aberto").toArray();
  if (!openRegs.length) {
    await db.cash_registers.put({
      id: "demo-cash-1",
      status: "aberto",
      opening_balance: 100,
      sales_total: 0,
      opened_at: now,
      opened_by_name: "Conta Demo",
      terminal_id: "demo-terminal",
      company_id: DEMO_COMPANY_ID,
    });
  }
}
