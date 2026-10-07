/**
 * Mapa Base44 entity → tabela Supabase (migração de dados).
 * IDs: preferir preservar UUID; se Base44 usar string não-UUID, gerar mapa em id_map.
 */
export const ENTITY_TABLE_MAP = {
  Company: "companies",
  User: "profiles",
  Product: "products",
  Customer: "customers",
  Category: "categories",
  Brand: "brands",
  CashRegister: "cash_registers",
  Sale: "sales",
  Bill: "bills",
  StockMovement: "stock_movements",
  DeliveryOrder: "delivery_orders",
  ActivityLog: "activity_logs",
  Nfce: "nfces",
};

/** Ordem de import (FKs). */
export const IMPORT_ORDER = [
  "Company",
  "User",
  "Category",
  "Brand",
  "Product",
  "Customer",
  "CashRegister",
  "Sale",
  "Bill",
  "StockMovement",
  "DeliveryOrder",
  "ActivityLog",
  "Nfce",
];

/** Campos que referenciam company. */
export const COMPANY_SCOPED = new Set([
  "products",
  "customers",
  "categories",
  "brands",
  "cash_registers",
  "sales",
  "bills",
  "stock_movements",
  "delivery_orders",
  "activity_logs",
  "nfces",
  "profiles",
]);
