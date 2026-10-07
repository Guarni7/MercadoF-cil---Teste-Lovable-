import { api } from "@/api/dataClient";
import { aplicarPagamento } from "@/lib/mesas";
import { getUserCompanyId } from "@/lib/companyContext";

// Persistência do atendimento por mesa (table_orders). Online-only, como Delivery: o pagamento reaproveita o
// checkout do PDV, que já cuida de offline/estoque/receita — mesa não cria uma segunda venda por conta própria.

// Cartões/comandas (migration 081) seguem no código, mas escondidos: a Mesa é o fluxo visível (QR/link na própria mesa).
// Para reativar o menu "Cartões" e o bloco "Cartão / comanda" do PDV, troque para true.
export const CARTOES_VISIVEIS = false;

const CONFIG_KEY = "mf_mesas_config";
const CONFIG_EVENT = "mf-mesas-config";
// produtoFiscalId: produto da empresa (ex.: "Almoço por quilo") que fornece NCM/CFOP/unidade/origem à nota do almoço por peso.
// cartaoInicial/cartaoFinal: faixa dos cartões/comandas físicos (001..100); o cartão não é a mesa.
// aceiteMesas: aceite do reajuste de "Ativar Mesas" no teste ({ em, valorMensal }); a cobrança real é do servidor.
const PADRAO = { ativo: false, quantidade: 10, precoKg: 0, produtoFiscalId: "", cartaoInicial: 1, cartaoFinal: 100, aceiteMesas: null };

/** Configuração local do aparelho (opcional por estabelecimento). ponytail: por aparelho; mover para o banco se precisar sincronizar entre caixas. */
export function lerConfigMesas() {
  try {
    return { ...PADRAO, ...JSON.parse(localStorage.getItem(CONFIG_KEY) || "{}") };
  } catch {
    return { ...PADRAO };
  }
}

export function salvarConfigMesas(parcial) {
  const nova = { ...lerConfigMesas(), ...parcial };
  try {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(nova));
  } catch {
    /* sem storage: vale só até recarregar */
  }
  window.dispatchEvent(new Event(CONFIG_EVENT));
  return nova;
}

export const EVENTO_CONFIG_MESAS = CONFIG_EVENT;

/** Empresa da sessão (base do QR dos cartões): vem do login, nunca de parâmetro de tela/URL. */
export const obterCompanyId = async () => getUserCompanyId(await api.auth.me());

/** Acesso ao banco para abrirOuVerAtendimento (atendimento de MESA): leitura e criação passam pelo RLS de table_orders. */
export const storeDeAtendimentos = (nome) => ({
  buscarAberto: async (numero) =>
    (await api.entities.TableOrder.filter({ status: "aberta", table_number: String(numero) }, "table_number", 50))
      .find((o) => !o.card_number) || null,
  criar: (numero) => abrirAtendimento(numero, nome),
});

/** Acesso ao banco para os cartões/comandas (cartaoQr.js): o cartão identifica o atendimento; a mesa é opcional. */
export const storeDeCartoes = (nome) => ({
  buscarAberto: async (numero) =>
    (await api.entities.TableOrder.filter({ status: "aberta", card_number: String(numero) }, "created_date", 1))[0] || null,
  criar: (numero, { mesa = null } = {}) =>
    api.entities.TableOrder.create({
      card_number: String(numero),
      table_number: mesa,
      status: "aberta",
      people: [],
      items: [],
      sale_ids: [],
      opened_by_name: nome || null,
    }),
});

/** Associa (ou desassocia) uma mesa ao atendimento do cartão. */
export const definirMesaDoCartao = (id, mesa) => api.entities.TableOrder.update(id, { table_number: mesa });

/**
 * Versões dos QR por mesa ({ "<mesa>": versão }); ausente = 0. Vêm do banco (valem para todos os caixas).
 * Sem a tabela (migration 082 ainda não aplicada) devolve {} e os QR originais continuam valendo.
 */
export async function carregarVersoesQr() {
  try {
    const linhas = await api.entities.TableQrVersion.list("table_number", 500);
    return Object.fromEntries((linhas || []).map((l) => [String(l.table_number), Number(l.version) || 0]));
  } catch {
    return {};
  }
}

/** Invalida o QR da mesa: sobe a versão no banco; o QR antigo para de funcionar em todos os caixas. Devolve a nova versão. */
export async function invalidarQrDaMesa(numero) {
  const n = String(numero);
  const [atual] = await api.entities.TableQrVersion.filter({ table_number: n }, "table_number", 1);
  const nova = (Number(atual?.version) || 0) + 1;
  const agora = new Date().toISOString();
  if (atual) await api.entities.TableQrVersion.update(atual.id, { version: nova, rotated_at: agora });
  else await api.entities.TableQrVersion.create({ table_number: n, version: nova, rotated_at: agora });
  return nova;
}

/**
 * Mesas cadastradas da empresa (números, compartilhados por todos os caixas). Devolve null quando o cadastro não existe
 * (migration 083 ainda não aplicada): a tela cai no comportamento antigo (1..quantidade).
 */
export async function listarMesasCadastradas() {
  try {
    const linhas = await api.entities.TableRegistry.list("table_number", 500);
    return (linhas || []).map((l) => String(l.table_number));
  } catch {
    return null;
  }
}

/** Cria as mesas que ainda não existem. Devolve quantas foram criadas. */
export async function criarMesas(numeros) {
  const existentes = (await listarMesasCadastradas()) || [];
  const novas = numeros.filter((n) => !existentes.includes(String(n)));
  for (const n of novas) await api.entities.TableRegistry.create({ table_number: String(n) });
  return novas.length;
}

/** Remove o cadastro das mesas informadas (quem chama já separou as ocupadas). Devolve quantas foram removidas. */
export async function removerMesas(numeros) {
  if (numeros.length === 0) return 0;
  const linhas = await api.entities.TableRegistry.list("table_number", 500);
  const alvo = (linhas || []).filter((l) => numeros.map(String).includes(String(l.table_number)));
  for (const l of alvo) await api.entities.TableRegistry.delete(l.id);
  return alvo.length;
}

export const listarAtendimentosAbertos = () => api.entities.TableOrder.filter({ status: "aberta" }, "table_number", 500);

export async function abrirAtendimento(numero, nome) {
  return api.entities.TableOrder.create({
    table_number: String(numero),
    status: "aberta",
    people: [],
    items: [],
    sale_ids: [],
    opened_by_name: nome || null,
  });
}

/** @param {string} id @param {{ people: any[], items: any[], notes?: string }} dados */
export const salvarAtendimento = (id, { people, items, notes }) =>
  api.entities.TableOrder.update(id, { people, items, ...(notes !== undefined ? { notes } : {}) });

export const cancelarAtendimento = (id) =>
  api.entities.TableOrder.update(id, { status: "cancelada", closed_at: new Date().toISOString() });

/**
 * Depois da venda criada pelo checkout: marca pessoas/itens pagos e libera a mesa quando nada sobra.
 * Relê o atendimento antes de gravar (outro caixa pode ter mexido) e é idempotente para o mesmo saleId.
 */
export async function registrarPagamentoDaMesa(orderId, { pessoaIds, itemIds }, saleId) {
  const atual = await api.entities.TableOrder.get(orderId);
  if (!atual) throw new Error("Atendimento não encontrado.");
  const novo = aplicarPagamento(atual, { pessoaIds, itemIds, saleId });
  await api.entities.TableOrder.update(orderId, {
    people: novo.people,
    items: novo.items,
    sale_ids: novo.sale_ids,
    status: novo.status,
    closed_at: novo.closed_at,
  });
  return novo;
}
