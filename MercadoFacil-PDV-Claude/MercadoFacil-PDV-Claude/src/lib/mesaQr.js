// QR/link fixo da MESA — regras puras (sem React, sem imports `@/`) para testar em Node.
//
// Cada mesa tem um link permanente `<app>/m/<token>`; o QR da mesa é esse link. O token é um hash unidirecional de
// (empresa, mesa): persistente (a mesma mesa gera sempre o mesmo link), único por empresa e sem company_id nem o número
// da mesa em texto claro.
//
// O link NÃO é uma página pública: `/m/<token>` é uma rota do próprio app, atrás do login. Quem abre sem estar logado
// vê a tela de acesso, sem nenhum dado. Logado, o app recalcula os tokens da EMPRESA DA SESSÃO e compara: link de outra
// empresa, inventado ou adulterado não bate com nenhuma mesa e é recusado; abrir o atendimento passa pelo RLS.
//
// Invalidar o QR (perdido/vazado): cada mesa tem uma VERSÃO (tabela table_qr_versions, ausência = 0). O token é
// hash(empresa, mesa, versão); incrementar a versão gera um token novo e o QR antigo deixa de resolver em todos os caixas.
import QRCode from "qrcode";

export const ROTA_MESA = "/m/";
const TAMANHO_TOKEN = 20; // 80 bits em hexadecimal
export const MAX_MESAS = 200;

async function sha256Hex(texto) {
  const dados = new TextEncoder().encode(texto);
  const hash = await globalThis.crypto.subtle.digest("SHA-256", dados);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** "5", " 05 " → "5". Fora de 1..200 ou não numérico → null. */
export function normalizarNumeroMesa(entrada) {
  const t = String(entrada ?? "").trim();
  if (!/^\d{1,4}$/.test(t)) return null;
  const n = Number(t);
  return n >= 1 && n <= MAX_MESAS ? String(n) : null;
}

/** Versão do QR da mesa (0 quando nunca foi invalidado). `versoes` = { "<mesa>": versão }. */
export const versaoDaMesa = (versoes, numero) => Number(versoes?.[String(numero)]) || 0;

/** Próxima versão ao invalidar o QR da mesa. */
export const proximaVersao = (versoes, numero) => versaoDaMesa(versoes, numero) + 1;

/** Token da mesa dentro da empresa. Versão 0 = o token original (QR já impressos continuam válidos até invalidar). */
export async function tokenDaMesa(companyId, numero, versao = 0) {
  if (!companyId) throw new Error("Empresa não identificada.");
  const n = normalizarNumeroMesa(numero);
  if (!n) throw new Error("Número de mesa inválido.");
  const v = Number(versao) || 0;
  return (await sha256Hex(`mf-mesa:v1:${companyId}:${n}${v > 0 ? `:r${v}` : ""}`)).slice(0, TAMANHO_TOKEN);
}

/** Endereço base do app para montar o link (VITE_APP_URL ou a origem http(s) atual; no desktop sem VITE_APP_URL, vazio). */
export function baseDoApp(env = globalThis) {
  const doEnv = typeof import.meta !== "undefined" ? import.meta.env?.VITE_APP_URL : "";
  if (doEnv) return String(doEnv).replace(/\/$/, "");
  const origem = env?.location?.origin || "";
  return /^https?:\/\//.test(origem) ? origem : "";
}

/** Caminho do link da mesa (`/m/<token>`) e o link completo quando há endereço base. */
export async function caminhoDaMesa(companyId, numero, versao = 0) {
  return `${ROTA_MESA}${await tokenDaMesa(companyId, numero, versao)}`;
}
export async function linkDaMesa(companyId, numero, { versao = 0, base = baseDoApp() } = {}) {
  return `${base}${await caminhoDaMesa(companyId, numero, versao)}`;
}

const RE_LINK = /\/m\/([0-9a-f]{20})(?![0-9a-f])/;

/** O texto lido (leitor USB/câmera/colado) é um link de mesa? */
export const pareceLinkDeMesa = (texto) => typeof texto === "string" && RE_LINK.test(texto.trim());

export const MSG_LINK_INVALIDO = "QR/link inválido ou de outra empresa. Use o QR de mesa impresso pelo MercadoFácil desta empresa.";
export const MSG_ENTRADA_INVALIDA = "Informe o número da mesa (ex.: 5) ou leia o QR da mesa.";

/**
 * Link/QR lido → número da mesa, dentro da empresa da sessão.
 * @returns {Promise<any>} { ok: true, numero } ou { ok: false, motivo: "nao_e_link_de_mesa" | "invalido", mensagem }
 */
export async function resolverLinkMesa(texto, companyId, versoes = {}) {
  const m = typeof texto === "string" ? texto.trim().match(RE_LINK) : null;
  if (!m) return { ok: false, motivo: "nao_e_link_de_mesa", mensagem: "Este código não é um QR de mesa." };
  for (let n = 1; n <= MAX_MESAS; n++) {
    if ((await tokenDaMesa(companyId, n, versaoDaMesa(versoes, n))) === m[1]) return { ok: true, numero: String(n) };
  }
  return { ok: false, motivo: "invalido", mensagem: MSG_LINK_INVALIDO };
}

/** Entrada única do caixa: link/QR da mesa ou número da mesa. */
export async function interpretarEntradaMesa(texto, companyId, versoes = {}) {
  if (pareceLinkDeMesa(texto)) {
    const r = await resolverLinkMesa(texto, companyId, versoes);
    return r.ok ? { ...r, origem: "qr" } : r;
  }
  const numero = normalizarNumeroMesa(texto);
  if (numero) return { ok: true, numero, origem: "numero" };
  return { ok: false, motivo: "entrada_invalida", mensagem: MSG_ENTRADA_INVALIDA };
}

/** SVG do QR (gerado localmente — sem serviço externo). */
export function qrSvg(conteudo) {
  return QRCode.toString(conteudo, { type: "svg", margin: 0, errorCorrectionLevel: "M" });
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/**
 * Folha A4 de plaquinhas das mesas: "MESA N" + QR, 6 por página (2 × 3).
 * @param {{ numero: string, svg: string }[]} mesas  @param {{ empresa?: string }} [opts]
 */
export function montarFolhaMesas(mesas, { empresa = "" } = {}) {
  const POR_PAGINA = 6;
  const paginas = [];
  for (let i = 0; i < mesas.length; i += POR_PAGINA) paginas.push(mesas.slice(i, i + POR_PAGINA));
  const cartao = (m) =>
    `<div class="card"><div class="mesa">MESA ${esc(m.numero)}</div><div class="qr">${m.svg}</div><div class="marca">${esc(empresa || "MercadoFácil")}</div></div>`;
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>QR das mesas</title><style>
@page { size: A4 portrait; margin: 10mm; }
* { box-sizing: border-box; }
body { margin: 0; font-family: "Inter", "Segoe UI", Arial, sans-serif; color: #12343b; }
.pagina { page-break-after: always; display: grid; grid-template-columns: 1fr 1fr; grid-template-rows: repeat(3, 1fr); gap: 8mm; height: 275mm; }
.pagina:last-child { page-break-after: auto; }
.card { border: 2px solid #006d77; border-radius: 6mm; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 6mm; text-align: center; }
.mesa { font-size: 30pt; font-weight: 800; color: #006d77; margin-bottom: 4mm; }
.qr { width: 52mm; height: 52mm; }
.qr svg { width: 100%; height: 100%; display: block; }
.marca { margin-top: 4mm; font-size: 11pt; font-weight: 700; }
</style></head><body>${paginas.map((p) => `<div class="pagina">${p.map(cartao).join("")}</div>`).join("")}</body></html>`;
}
