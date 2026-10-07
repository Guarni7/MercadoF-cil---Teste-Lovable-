import { createColumnStore } from "@/lib/listColumnsStore";

/** Colunas da lista de Clientes (preferências em localStorage). */

export const CUSTOMER_COLUMN_DEFS = [
  { id: "status", label: "Status", defaultOn: true },
  { id: "type", label: "Tipo", defaultOn: false },
  { id: "name", label: "Nome", defaultOn: true },
  { id: "nickname", label: "Apelido", defaultOn: false },
  { id: "trade_name", label: "Nome Fantasia", defaultOn: false },
  { id: "legal_name", label: "Razão Social", defaultOn: false },
  { id: "document", label: "Documento", defaultOn: true },
  { id: "ie", label: "Inscrição Estadual", defaultOn: false },
  { id: "ie_indicator", label: "Indicador IE", defaultOn: false },
  { id: "birthday", label: "Nascimento", defaultOn: false },
  { id: "phone", label: "WhatsApp", defaultOn: true },
  { id: "email", label: "E-mail", defaultOn: true },
  { id: "cep", label: "CEP", defaultOn: false },
  { id: "address", label: "Endereço", defaultOn: true },
  { id: "city_uf", label: "Cidade / UF", defaultOn: true },
  { id: "credit_limit", label: "Limite crédito", defaultOn: false },
  { id: "vale_troca", label: "Vale-troca", defaultOn: false },
  { id: "final_consumer", label: "Consumidor final", defaultOn: false },
  { id: "credit_balance", label: "Crediário", defaultOn: true },
];

export const customerColumnsStore = createColumnStore(
  "mf_customer_list_columns",
  CUSTOMER_COLUMN_DEFS
);

/** @deprecated use customerColumnsStore */
export function getDefaultColumnState() {
  return customerColumnsStore.getDefaults();
}
/** @deprecated */
export function loadColumnState() {
  return customerColumnsStore.load();
}
/** @deprecated */
export function saveColumnState(state) {
  customerColumnsStore.save(state);
}

export function onlyDigits(v) {
  return String(v || "").replace(/\D/g, "");
}

export function isValidCnpj(cnpj) {
  const d = onlyDigits(cnpj);
  if (d.length !== 14 || /^(\d)\1+$/.test(d)) return false;
  const calc = (base, factors) => {
    let sum = 0;
    for (let i = 0; i < factors.length; i++) sum += Number(base[i]) * factors[i];
    const mod = sum % 11;
    return mod < 2 ? 0 : 11 - mod;
  };
  const n = d.slice(0, 12);
  const d1 = calc(n, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = calc(n + d1, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return d.endsWith(`${d1}${d2}`);
}

export function customerDocType(customer) {
  const d = onlyDigits(customer?.document);
  if (d.length === 14) return "PJ";
  if (d.length === 11) return "PF";
  return "—";
}

export function customerStatusLabel(customer) {
  if (customer?.active === false) return "Inativo";
  if ((customer?.credit_balance || 0) > 0) return "Em débito";
  return "Em dia";
}

export function formatCustomerAddress(c) {
  const parts = [c.address, c.address_number, c.neighborhood].filter(Boolean);
  return parts.join(", ") || c.address || "";
}

export function getCellValue(customer, columnId) {
  switch (columnId) {
    case "status":
      return customerStatusLabel(customer);
    case "type":
      return customer.customer_type || customerDocType(customer);
    case "name":
      return customer.name || "—";
    case "nickname":
      return customer.nickname || "—";
    case "trade_name":
      return customer.trade_name || "—";
    case "legal_name":
      return customer.legal_name || "—";
    case "document":
      return customer.document || "—";
    case "ie":
      return customer.ie || "—";
    case "ie_indicator":
      return customer.ie_indicator || "—";
    case "birthday":
      return customer.birthday || "—";
    case "phone":
      return customer.phone || "—";
    case "email":
      return customer.email || "—";
    case "cep":
      return customer.cep || "—";
    case "address":
      return formatCustomerAddress(customer) || "—";
    case "city_uf":
      return customer.city
        ? `${customer.city}${customer.state ? " - " + customer.state : ""}`
        : "—";
    case "credit_limit":
      return customer.credit_limit ?? 0;
    case "vale_troca":
      return customer.vale_troca ?? 0;
    case "final_consumer":
      return customer.final_consumer ? "Sim" : "Não";
    case "credit_balance":
      return customer.credit_balance ?? 0;
    default:
      return "—";
  }
}

export function isPjWithValidCnpj(customer) {
  return isValidCnpj(customer?.document);
}

export function isCnpjIncomplete(customer) {
  if (!isPjWithValidCnpj(customer)) return false;
  return !(customer.name && customer.address && customer.city && customer.state);
}
