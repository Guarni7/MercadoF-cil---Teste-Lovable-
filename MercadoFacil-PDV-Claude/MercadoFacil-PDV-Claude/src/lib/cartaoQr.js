// Cartão/comanda físico reutilizável — regras puras (sem React, sem imports `@/`) para testar em Node.
//
// O restaurante tem cartões numerados (001, 002, ...). O QR identifica o CARTÃO, não a mesa: a mesa é um dado
// opcional do atendimento (table_orders.table_number) e o cartão pode ser usado em qualquer mesa, ou em nenhuma.
//
// QR = `MFCARTAO-<token>`; token = hash unidirecional de (empresa, número do cartão): persistente (o mesmo cartão
// sempre gera o mesmo QR), único por empresa e sem company_id/número em texto claro no QR. Não precisa de banco.
//
// Localizar um cartão = recalcular os tokens da PRÓPRIA empresa da sessão e comparar (ou usar o número digitado). QR
// de outra empresa, inventado ou adulterado não bate com nenhum token e é recusado — nada vindo do QR/da entrada
// escolhe a empresa. Depois de localizar, ler/abrir o atendimento passa pelo RLS de table_orders.
//
// Estado do cartão é derivado do atendimento: EM USO = existe atendimento aberto com esse card_number; DISPONÍVEL =
// não existe. Encerrar o atendimento (venda paga ou cancelamento) devolve o cartão a DISPONÍVEL; o histórico fica.
//
// ponytail: o token é determinístico (sem sal por empresa), então um cartão impresso não pode ser revogado
// individualmente. Se for preciso, guardar um sal por empresa e incluí-lo no hash.
import QRCode from "qrcode";

export const PREFIXO_QR = "MFCARTAO-";
const TAMANHO_TOKEN = 20; // 80 bits em hexadecimal
export const MAX_CARTOES = 999;

async function sha256Hex(texto) {
  const dados = new TextEncoder().encode(texto);
  const hash = await globalThis.crypto.subtle.digest("SHA-256", dados);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** "023", " 23 " e 23 são o mesmo cartão → "23". Fora de 1..999 ou não numérico → null. */
export function normalizarNumeroCartao(entrada) {
  const t = String(entrada ?? "").trim();
  if (!/^\d{1,4}$/.test(t)) return null;
  const n = Number(t);
  return n >= 1 && n <= MAX_CARTOES ? String(n) : null;
}

/** Como o cartão aparece impresso e na tela: 023. */
export const numeroExibicao = (numero) => String(numero).padStart(3, "0");
export const rotuloDoCartao = (numero) => `Cartão ${numeroExibicao(numero)}`;

/** Token estável do cartão dentro da empresa. */
export async function tokenDoCartao(companyId, numero) {
  if (!companyId) throw new Error("Empresa não identificada.");
  const n = normalizarNumeroCartao(numero);
  if (!n) throw new Error("Número de cartão inválido.");
  return (await sha256Hex(`mf-cartao:v1:${companyId}:${n}`)).slice(0, TAMANHO_TOKEN);
}

/** Texto gravado no QR do cartão. */
export async function payloadDoCartao(companyId, numero) {
  return `${PREFIXO_QR}${await tokenDoCartao(companyId, numero)}`;
}

/** O texto lido parece um QR de cartão? (o leitor USB também lê código de barras de produto; este filtro separa os dois) */
export const pareceQrDeCartao = (texto) => typeof texto === "string" && texto.trim().startsWith(PREFIXO_QR);

export const MSG_QR_INVALIDO = "QR inválido ou de outra empresa. Use um cartão impresso pelo MercadoFácil desta empresa.";
export const MSG_ENTRADA_INVALIDA = "Informe o número do cartão (ex.: 23) ou leia o QR do cartão.";
export const MSG_NAO_ENCONTRADO = "Cartão não encontrado.";

/**
 * QR lido → número do cartão, dentro da empresa da sessão.
 * @returns {Promise<any>} { ok: true, numero } ou { ok: false, motivo: "nao_e_qr_de_cartao" | "invalido", mensagem }
 */
export async function resolverQrCartao(texto, companyId) {
  if (!pareceQrDeCartao(texto)) {
    return { ok: false, motivo: "nao_e_qr_de_cartao", mensagem: "Este código não é um QR de cartão." };
  }
  const token = texto.trim().slice(PREFIXO_QR.length);
  if (!/^[0-9a-f]+$/.test(token) || token.length !== TAMANHO_TOKEN) {
    return { ok: false, motivo: "invalido", mensagem: MSG_QR_INVALIDO };
  }
  for (let n = 1; n <= MAX_CARTOES; n++) {
    if ((await tokenDoCartao(companyId, n)) === token) return { ok: true, numero: String(n) };
  }
  return { ok: false, motivo: "invalido", mensagem: MSG_QR_INVALIDO };
}

/**
 * Entrada única do caixa: QR (leitor USB/câmera) ou número digitado chegam ao mesmo ponto.
 * @returns {Promise<any>} { ok: true, numero, origem: "qr" | "numero" } ou { ok: false, motivo, mensagem }
 */
export async function interpretarEntradaCartao(texto, companyId) {
  if (pareceQrDeCartao(texto)) {
    const r = await resolverQrCartao(texto, companyId);
    return r.ok ? { ...r, origem: "qr" } : r;
  }
  const numero = normalizarNumeroCartao(texto);
  if (numero) return { ok: true, numero, origem: "numero" };
  return { ok: false, motivo: "entrada_invalida", mensagem: MSG_ENTRADA_INVALIDA };
}

/** O cartão existe para esta empresa? Dentro da faixa configurada (inicial..final) ou já em uso. */
export function cartaoExiste(numero, { inicial = 1, final = 100 } = {}, emUso = false) {
  const n = Number(numero);
  return emUso || (n >= Number(inicial) && n <= Number(final));
}

/**
 * Situação do cartão: EM USO (devolve o atendimento aberto), DISPONÍVEL ou NÃO ENCONTRADO.
 * `store.buscarAberto(numero)` é a leitura no banco (RLS por empresa).
 * @returns {Promise<{ estado: "em_uso", order: any } | { estado: "disponivel" } | { estado: "nao_encontrado" }>}
 */
export async function localizarCartao(store, numero, faixa) {
  const order = await store.buscarAberto(numero);
  if (order) return { estado: "em_uso", order };
  return cartaoExiste(numero, faixa) ? { estado: "disponivel" } : { estado: "nao_encontrado" };
}

/**
 * Abre atendimento no cartão DISPONÍVEL (mesa opcional). Se outro caixa abriu o mesmo cartão no meio (índice único
 * recusa), devolve o atendimento que já existe — nunca cria dois no mesmo cartão.
 * `store.criar(numero, { mesa })`.
 * @returns {Promise<{ acao: "abrir" | "ver", order: any }>}
 */
export async function abrirAtendimentoDoCartao(store, numero, { mesa = null } = {}) {
  const existente = await store.buscarAberto(numero);
  if (existente) return { acao: "ver", order: existente };
  try {
    return { acao: "abrir", order: await store.criar(numero, { mesa: normalizarMesa(mesa) }) };
  } catch (e) {
    const agora = await store.buscarAberto(numero);
    if (agora) return { acao: "ver", order: agora };
    throw e;
  }
}

/** Mesa opcional do atendimento: texto curto ou null (o cartão não fica preso a nenhuma mesa). */
export function normalizarMesa(valor) {
  const t = String(valor ?? "").trim().slice(0, 20);
  return t === "" ? null : t;
}

/** Cartões da faixa com o estado de cada um, a partir dos atendimentos abertos (card_number). */
export function listarCartoes({ inicial = 1, final = 100 } = {}, atendimentosAbertos = []) {
  const porCartao = new Map((atendimentosAbertos || []).filter((o) => o?.card_number).map((o) => [String(o.card_number), o]));
  const numeros = [];
  for (let n = Math.max(1, Number(inicial) || 1); n <= Math.min(MAX_CARTOES, Number(final) || 1); n++) numeros.push(String(n));
  // cartão em uso fora da faixa (faixa reduzida depois) continua aparecendo até ser encerrado
  for (const k of porCartao.keys()) if (!numeros.includes(k)) numeros.push(k);
  return numeros.map((numero) => {
    const order = porCartao.get(numero) || null;
    return { numero, estado: order ? "em_uso" : "disponivel", order, mesa: order?.table_number ?? null };
  });
}

/** SVG do QR (gerado localmente — sem serviço externo). */
export function qrSvg(payload) {
  return QRCode.toString(payload, { type: "svg", margin: 0, errorCorrectionLevel: "M" });
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** Tamanhos de cartão por folha A4 (colunas × linhas). */
export const LAYOUTS_CARTAO = {
  grande: { rotulo: "Grande (8 por folha)", colunas: 2, linhas: 4, qrMm: 34, numeroPt: 34 },
  medio: { rotulo: "Médio (15 por folha)", colunas: 3, linhas: 5, qrMm: 28, numeroPt: 26 },
  pequeno: { rotulo: "Pequeno (24 por folha)", colunas: 4, linhas: 6, qrMm: 22, numeroPt: 20 },
};

/**
 * Folha A4 de cartões para recortar/plastificar: "MERCADOFÁCIL / CARTÃO / 023 / QR", com borda tracejada de corte.
 * @param {{ numero: string, svg: string }[]} cartoes  @param {{ empresa?: string, layout?: "grande" | "medio" | "pequeno" }} [opts]
 */
export function montarFolhaCartoes(cartoes, { empresa = "", layout = "medio" } = {}) {
  const L = LAYOUTS_CARTAO[layout] || LAYOUTS_CARTAO.medio;
  const porPagina = L.colunas * L.linhas;
  const paginas = [];
  for (let i = 0; i < cartoes.length; i += porPagina) paginas.push(cartoes.slice(i, i + porPagina));
  const marca = esc((empresa || "MercadoFácil").toUpperCase());
  const cartao = (c) =>
    `<div class="cartao"><div class="marca">${marca}</div><div class="rotulo">CARTÃO</div><div class="numero">${esc(numeroExibicao(c.numero))}</div><div class="qr">${c.svg}</div></div>`;
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Cartões</title><style>
@page { size: A4 portrait; margin: 8mm; }
* { box-sizing: border-box; }
body { margin: 0; font-family: "Inter", "Segoe UI", Arial, sans-serif; color: #12343b; }
.pagina { page-break-after: always; display: grid; grid-template-columns: repeat(${L.colunas}, 1fr); grid-template-rows: repeat(${L.linhas}, 1fr); gap: 0; height: 281mm; }
.pagina:last-child { page-break-after: auto; }
.cartao { border: 1px dashed #7a8f94; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 3mm; text-align: center; }
.marca { font-size: 8pt; font-weight: 800; letter-spacing: 1.5px; color: #006d77; }
.rotulo { font-size: 8pt; letter-spacing: 3px; color: #596f75; margin-top: 1mm; }
.numero { font-size: ${L.numeroPt}pt; font-weight: 800; line-height: 1.05; margin: 1mm 0 2mm; }
.qr { width: ${L.qrMm}mm; height: ${L.qrMm}mm; }
.qr svg { width: 100%; height: 100%; display: block; }
</style></head><body>${paginas.map((p) => `<div class="pagina">${p.map(cartao).join("")}</div>`).join("")}</body></html>`;
}
