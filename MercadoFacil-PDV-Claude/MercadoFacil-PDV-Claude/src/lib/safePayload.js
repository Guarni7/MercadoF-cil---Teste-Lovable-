/**
 * Segurança no cliente: mass assignment + uploads.
 */

export function pick(obj, keys) {
  const out = {};
  if (!obj || typeof obj !== "object") return out;
  for (const k of keys) {
    if (Object.prototype.hasOwnProperty.call(obj, k) && obj[k] !== undefined) {
      out[k] = obj[k];
    }
  }
  return out;
}

export const PRODUCT_FIELDS = [
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
  // Classificação fiscal em colunas próprias. fiscal_info continua na lista só
  // para não apagar a anotação livre de quem já usava o campo, mas quem alimenta
  // o XML são estes campos.
  "ncm",
  "cest",
  "cfop",
  "origin",
  "icms_cst",
  "icms_csosn",
  "pis_cst",
  "cofins_cst",
  "ibscbs_cst",
  "ibscbs_class_trib",
  "gtin",
  "unit_trib",
];

export const CUSTOMER_FIELDS = [
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
  "ie_indicator",
  "customer_type",
  "final_consumer",
  "vale_troca",
  "active",
  "company_id",
];

export const BRAND_FIELDS = ["name", "company_id"];
export const CATEGORY_FIELDS = ["name", "color", "company_id"];
export const CASH_REGISTER_FIELDS = [
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
];

const ALLOWED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/jpg", "image/webp"]);
const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;

/** Valida arquivo de imagem antes do upload no Storage. */
export function assertSafeImageUpload(file, { maxBytes = MAX_UPLOAD_BYTES } = {}) {
  if (!file) throw new Error("Arquivo não selecionado.");
  if (!ALLOWED_IMAGE_TYPES.has(String(file.type || "").toLowerCase())) {
    throw new Error("Tipo de arquivo não permitido. Use PNG, JPEG ou WebP.");
  }
  if (file.size > maxBytes) {
    throw new Error(`Arquivo muito grande. Máx ${Math.floor(maxBytes / (1024 * 1024))}MB.`);
  }
  const name = String(file.name || "").toLowerCase();
  if (!/\.(png|jpe?g|webp)$/.test(name)) {
    throw new Error("Extensão inválida. Use .png, .jpg ou .webp.");
  }
  return true;
}
