// Configuração fiscal no cliente.
//
// Substitui a chave "fiscal_config" do localStorage, onde CNPJ, IE, série e a
// numeração da NFC-e ficavam guardados por navegador — sem company_id, sem RLS,
// e zerando a numeração fiscal a cada limpeza de cache.
//
// Aqui a fonte é sempre o banco. O certificado nunca passa por este arquivo de
// volta: ele sobe uma vez para a Edge Function e o que retorna é só titular e
// validade.

import { api } from "@/api/dataClient";
import { ORIGEM_ALMOCO, bloqueioFiscalDoAlmoco } from "@/lib/mesas";
import { montarPayloadCancelamento } from "@/lib/fiscalDocumentPayload";

export const AMBIENTES = [
  { value: "homologacao", label: "Homologação (testes)" },
  { value: "producao", label: "Produção" },
];

export const REGIMES = [
  { value: "mei", label: "MEI — Microempreendedor Individual", crt: "4" },
  { value: "simples", label: "Simples Nacional", crt: "1" },
  { value: "presumido", label: "Lucro Presumido", crt: "3" },
  { value: "real", label: "Lucro Real", crt: "3" },
];

export const CRTS = [
  { value: "1", label: "1 — Simples Nacional" },
  { value: "2", label: "2 — Simples Nacional, excesso de sublimite" },
  { value: "3", label: "3 — Regime Normal" },
  { value: "4", label: "4 — MEI" },
];

export const TIPOS_CONTRIBUINTE = [
  { value: "contribuinte", label: "Contribuinte de ICMS" },
  { value: "isento", label: "Contribuinte isento de IE" },
  { value: "nao_contribuinte", label: "Não contribuinte" },
];

export const ESCOPOS_MEI = [
  { value: "mercadorias", label: "Só mercadorias" },
  { value: "servicos", label: "Só serviços" },
  { value: "ambos", label: "Mercadorias e serviços" },
];

// Espelho local apenas do que o PDV precisa saber offline: se a loja emite
// NFC-e. Não é fonte da verdade — a fonte é company_fiscal_settings — e não
// guarda nada sensível.
const ESPELHO = "fiscal_enabled";

/** Configuração fiscal da empresa, direto do banco. */
export async function carregarConfigFiscal() {
  const rows = await api.entities.CompanyFiscalSettings.list();
  const config = rows?.[0] || null;
  espelharHabilitacao(config);
  return config;
}

function espelharHabilitacao(config) {
  try {
    localStorage.setItem(
      ESPELHO,
      JSON.stringify({
        nfce: !!config?.nfce_enabled,
        nfe: !!config?.nfe_enabled,
        nfse: !!config?.nfse_enabled,
      }),
    );
  } catch {}
}

/**
 * O PDV pergunta isso a cada venda, inclusive sem rede, então lê o espelho.
 * Habilitar NFC-e aqui não emite nada por conta própria: a emissão continua
 * sendo decidida pelo servidor, que recusa se faltar certificado ou dado.
 */
export function nfceHabilitada() {
  try {
    return !!JSON.parse(localStorage.getItem(ESPELHO) || "{}").nfce;
  } catch {
    return false;
  }
}

/** Atualiza o espelho a partir do banco, sem travar a tela se estiver offline. */
export async function sincronizarHabilitacaoFiscal() {
  try {
    await carregarConfigFiscal();
  } catch (e) {
    console.error("Não foi possível sincronizar a habilitação fiscal:", e);
  }
  return nfceHabilitada();
}

/**
 * Grava pela Edge Function. Ela é quem valida o certificado, confere o CNPJ e
 * decide se pode ligar o ambiente de produção — o navegador não tem como saber
 * nada disso.
 */
export async function salvarConfigFiscal(payload) {
  const res = await api.functions.invoke("saveFiscalSettings", payload);
  const data = res?.data || res;
  if (data?.error) throw new Error(data.error);
  espelharHabilitacao(data?.settings);
  return data;
}

/** Status de cada item da integração, medido no servidor. */
export async function diagnosticoFiscal() {
  const res = await api.functions.invoke("fiscalDiagnostics", {});
  const data = res?.data || res;
  if (data?.error) throw new Error(data.error);
  return data;
}

/**
 * Emite um documento fiscal pelo fluxo centralizado do servidor.
 * @param {{ model: string, saleId?: string, series?: number }} params
 */
export async function emitirDocumento({ model, saleId, series }) {
  // Almoço por peso (mesas): sem produto fiscal completo vinculado a nota não sai — nunca se inventa NCM/CFOP.
  // Venda sem almoço por peso não passa por nenhuma consulta extra.
  const venda = saleId ? await api.entities.Sale.get(saleId).catch(() => null) : null;
  if ((venda?.items || []).some((i) => i?.origem === ORIGEM_ALMOCO)) {
    const ids = [...new Set(venda.items.filter((i) => i.origem === ORIGEM_ALMOCO && i.product_id).map((i) => i.product_id))];
    const produtos = await Promise.all(ids.map((id) => api.entities.Product.get(id).catch(() => null)));
    const bloqueio = bloqueioFiscalDoAlmoco(venda.items, Object.fromEntries(ids.map((id, n) => [id, produtos[n]])));
    if (bloqueio) throw new Error(bloqueio.message);
  }
  const res = await api.functions.invoke("fiscalEmit", {
    model,
    sale_id: saleId,
    series,
  });
  return res?.data || res;
}

/**
 * Verifica se a venda tem NFC-e/NF-e autorizada. Devolução ou cancelamento de
 * venda com nota autorizada não pode simplesmente prosseguir: a nota
 * continuaria valendo na SEFAZ enquanto o MercadoFácil já trata a venda como
 * desfeita. O cancelamento fiscal real (evento 110111) existe agora
 * (fiscal-document/index.ts, action "cancelar") — quem chama isto decide se
 * cancela a nota primeiro (cancelarDocumento) ou bloqueia. NFS-e fica de
 * fora: já tem cancelamento funcional próprio, não é o alvo desta checagem.
 *
 * A consulta usa RLS normal (api.entities.FiscalDocument já é escopado por
 * empresa) — não precisa de nada além do sale_id.
 */
export async function bloqueioFiscalDaVenda(saleId) {
  if (!saleId) return null;
  const docs = await api.entities.FiscalDocument.filter({ sale_id: saleId, status: "authorized" });
  const doc = (docs || []).find((d) => d.model === "55" || d.model === "65");
  if (!doc) return null;
  const tipo = doc.model === "65" ? "NFC-e" : "NF-e";
  return {
    document: doc,
    message:
      `Esta venda tem ${tipo} autorizada pela SEFAZ (nº ${doc.number || "—"}). ` +
      "É preciso cancelar a nota fiscal na SEFAZ antes de devolver ou cancelar esta venda.",
  };
}

/**
 * Consulta a nota no autorizador pela chave de acesso.
 *
 * Usada quando a emissão ficou sem resposta conclusiva: a nota pode existir do
 * lado de lá, e reemitir sem conferir geraria documento duplicado.
 */
export async function consultarDocumento(documentId) {
  const res = await api.functions.invoke("fiscalDocument", {
    action: "consultar",
    document_id: documentId,
  });
  return res?.data || res;
}

/**
 * Cancela por evento oficial. Sem registro no autorizador, nada é cancelado.
 * `motivo` só se aplica à NFS-e (server ignora para NFC-e/NF-e, que usam só
 * `justificativa` no evento 110111).
 * @param {{ documentId: string, motivo?: string | null, justificativa?: string | null }} params
 */
export async function cancelarDocumento({ documentId, motivo, justificativa }) {
  // O corpo omite o que não tem valor: o servidor recusa motivo/justificativa null ("Dados inválidos").
  const res = await api.functions.invoke("fiscalDocument", montarPayloadCancelamento({ documentId, motivo, justificativa }));
  return res?.data || res;
}

export const MOTIVOS_CANCELAMENTO = [
  { value: "1", label: "Erro na emissão" },
  { value: "2", label: "Serviço não prestado" },
  { value: "9", label: "Outros" },
];

export async function carregarSeries() {
  return api.entities.FiscalDocumentSeries.list("model");
}

/** Testa a configuração de NFC-e (SEFAZ-GO, homologação) no servidor. Não emite nada. */
export async function testarConfigNfce() {
  const res = await api.functions.invoke("fiscalNfceConfig", { action: "test" });
  const data = res?.data || res;
  if (data?.error) throw new Error(data.error);
  return data;
}

/** Grava série e próximo número da NFC-e (homologação). */
export async function salvarNumeracaoNfce({ series, nextNumber }) {
  const res = await api.functions.invoke("fiscalNfceConfig", { action: "set_numbering", series, next_number: nextNumber });
  const data = res?.data || res;
  if (data?.error) throw new Error(data.error);
  return data;
}

/** Lê o .pfx do disco e devolve em base64, sem nunca persistir no navegador. */
export function lerCertificado(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      const base64 = result.includes(",") ? result.split(",")[1] : result;
      resolve(base64);
    };
    reader.onerror = () => reject(new Error("Não foi possível ler o arquivo do certificado"));
    reader.readAsDataURL(file);
  });
}

const CORES = {
  configurado: "text-emerald-700 bg-emerald-50 border-emerald-200",
  pendente: "text-amber-700 bg-amber-50 border-amber-200",
  erro: "text-red-700 bg-red-50 border-red-200",
};

const ROTULOS = {
  configurado: "Configurado",
  pendente: "Pendente",
  erro: "Erro",
};

export const corDoStatus = (status) => CORES[status] || CORES.pendente;
export const rotuloDoStatus = (status) => ROTULOS[status] || ROTULOS.pendente;
