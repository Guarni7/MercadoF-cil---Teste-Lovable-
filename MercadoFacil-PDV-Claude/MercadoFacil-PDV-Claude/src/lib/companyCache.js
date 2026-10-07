import { api } from "@/api/dataClient";

/**
 * Cadastro e logo da empresa em cache local.
 *
 * O cupom, o menu lateral e a tela de Configurações liam apenas o
 * localStorage, então um caixa novo (ou o mesmo caixa com o cache limpo)
 * ficava sem nome, CNPJ e logo. O banco é a fonte; o localStorage existe para
 * o app seguir imprimindo offline.
 */
const DATA_KEY = "company_data";
const LOGO_KEY = "company_logo";

const CAMPOS = [
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
  "instagram",
];

export function getCachedCompany() {
  try {
    return JSON.parse(localStorage.getItem(DATA_KEY) || "{}");
  } catch {
    return {};
  }
}

export function getCachedLogo() {
  try {
    return localStorage.getItem(LOGO_KEY) || null;
  } catch {
    return null;
  }
}

export function cacheCompany(dados, logoUrl) {
  try {
    localStorage.setItem(DATA_KEY, JSON.stringify(dados));
    if (logoUrl) localStorage.setItem(LOGO_KEY, logoUrl);
    else localStorage.removeItem(LOGO_KEY);
  } catch {}
}

/** Busca a empresa no banco e atualiza o cache. Offline devolve o cache. */
export async function syncCompanyCache() {
  try {
    const me = await api.auth.me();
    if (!me?.company_id) return { dados: getCachedCompany(), logoUrl: getCachedLogo() };
    const company = await api.entities.Company.get(me.company_id);
    if (!company) return { dados: getCachedCompany(), logoUrl: getCachedLogo() };
    const dados = Object.fromEntries(CAMPOS.map((c) => [c, company[c] || ""]));
    cacheCompany(dados, company.logo_url || null);
    return { dados, logoUrl: company.logo_url || null };
  } catch (e) {
    console.error("Erro ao sincronizar dados da empresa:", e);
    return { dados: getCachedCompany(), logoUrl: getCachedLogo() };
  }
}
