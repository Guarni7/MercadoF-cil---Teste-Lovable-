// Estado e textos da atualização REAL do app desktop (electron-updater, via electron/main.cjs).
// Pura, sem React: testada em scripts/smoke-atualizacao-desktop.mjs. Não tem relação com a simulação
// de "novidades" da release 3.79.2 (appVersion.js / releaseNotes.js), que não baixa nem instala nada.
//
// Eventos do main (mf:update): { status, info?, percent?, transferred?, total?, bytesPerSecond?, error? }
// status: checking | available | downloading | downloaded | not-available | error

/** @typedef {{ status: string, info: string|null, percent: number|null, transferred: number|null, total: number|null, bytesPerSecond: number|null, error: string|null }} EstadoAtualizacao */

/** @returns {EstadoAtualizacao} */
export const estadoInicial = () => ({ status: "idle", info: null, percent: null, transferred: null, total: null, bytesPerSecond: null, error: null });

/**
 * Junta um evento do main ao estado. Campos de progresso só valem enquanto baixa; uma nova versão zera o resto.
 * @param {EstadoAtualizacao} atual
 * @param {{ status?: string, info?: string|null, percent?: number, transferred?: number, total?: number, bytesPerSecond?: number, error?: string|null } | null | undefined} evento
 * @returns {EstadoAtualizacao}
 */
export function aplicarEvento(atual, evento) {
  if (!evento?.status) return atual;
  const proximo = { ...estadoInicial(), info: atual.info };
  if (typeof evento.info === "string" && evento.info) proximo.info = evento.info;
  proximo.status = evento.status;
  if (evento.status === "not-available") proximo.info = null;
  if (evento.status === "downloading") {
    proximo.percent = clampPercent(evento.percent);
    proximo.transferred = numeroOuNull(evento.transferred);
    proximo.total = numeroOuNull(evento.total);
    proximo.bytesPerSecond = numeroOuNull(evento.bytesPerSecond);
  } else if (evento.status === "downloaded") {
    proximo.percent = 100;
    proximo.total = numeroOuNull(evento.total) ?? atual.total;
    proximo.transferred = proximo.total;
  } else if (evento.status === "error") {
    proximo.error = evento.error || null;
  }
  return proximo;
}

const numeroOuNull = (n) => (typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : null);
const clampPercent = (p) => (typeof p === "number" && Number.isFinite(p) ? Math.min(100, Math.max(0, Math.round(p))) : 0);

/** 105883823 → "101,0 MB" (pt-BR, base 1024 como o Windows). */
export function formatarMB(bytes) {
  if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes < 0) return "";
  return `${(bytes / 1024 / 1024).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} MB`;
}

/** "12,3 MB / 101,0 MB" ou "" quando o total ainda não é conhecido. */
export function progressoEmMB(estado) {
  if (estado.total == null || estado.transferred == null || estado.total <= 0) return "";
  return `${formatarMB(estado.transferred)} / ${formatarMB(estado.total)}`;
}

/** O painel só aparece quando há algo a mostrar (disponível, baixando, pronta, erro de download). */
export const painelVisivel = (estado) => ["available", "downloading", "downloaded"].includes(estado.status);

/**
 * Textos do painel para o estado atual.
 * @param {EstadoAtualizacao} estado
 * @param {string} versaoAtual
 */
export function descreverPainel(estado, versaoAtual) {
  const base = { versaoAtual, versaoNova: estado.info, titulo: "", detalhe: "", percentual: null, progresso: "", pronta: false, mostrarBarra: false };
  switch (estado.status) {
    case "available":
      return { ...base, titulo: "Atualização disponível", detalhe: "Preparando o download...", mostrarBarra: true, percentual: 0 };
    case "downloading":
      return { ...base, titulo: "Baixando atualização...", detalhe: `${estado.percent ?? 0}%`, percentual: estado.percent ?? 0, progresso: progressoEmMB(estado), mostrarBarra: true };
    case "downloaded":
      return { ...base, titulo: "Atualização pronta", detalhe: "Será instalada ao fechar o MercadoFácil.", percentual: 100, progresso: progressoEmMB(estado), pronta: true, mostrarBarra: true };
    default:
      return base;
  }
}

export const MSG_ERRO_ATUALIZACAO = "Não foi possível verificar atualizações agora. O sistema continua funcionando e tentará de novo mais tarde.";

/**
 * Resultado da verificação manual ("Verificar Atualizações" no desktop): { tipo, mensagem } para o toast,
 * ou null enquanto ainda não há resultado (checking/downloading).
 * @param {{ status?: string, info?: string|null, error?: string|null } | null | undefined} evento
 * @param {string} versaoAtual
 */
export function resultadoDaVerificacao(evento, versaoAtual) {
  switch (evento?.status) {
    case "not-available":
      return { tipo: "sucesso", mensagem: `O sistema já está na versão mais recente (${versaoAtual}).` };
    case "available":
      return { tipo: "info", mensagem: `Atualização ${evento.info || ""} encontrada. Baixando em segundo plano.`.replace("  ", " ") };
    case "downloaded":
      return { tipo: "info", mensagem: "Atualização pronta. Será instalada ao fechar o MercadoFácil." };
    case "error":
      return { tipo: "erro", mensagem: MSG_ERRO_ATUALIZACAO };
    default:
      return null;
  }
}

/**
 * Verificação manual: pede a checagem real e espera o resultado (sem atualização / encontrada / pronta / erro).
 * Nunca rejeita; sem resposta no prazo devolve um aviso neutro.
 * @param {{ checkNow: () => Promise<unknown>, onChange: (h: (e: any) => void) => () => void, versaoAtual: string, timeoutMs?: number }} p
 * @returns {Promise<{ tipo: "sucesso"|"info"|"erro", mensagem: string }>}
 */
export function verificarAtualizacao({ checkNow, onChange, versaoAtual, timeoutMs = 30000 }) {
  return new Promise((resolve) => {
    let sair = () => {};
    let timer = null;
    const terminar = (r) => {
      clearTimeout(timer);
      sair();
      resolve(r);
    };
    timer = setTimeout(() => terminar({ tipo: "info", mensagem: "A verificação está demorando. O sistema tentará de novo mais tarde." }), timeoutMs);
    sair = onChange((evento) => {
      const r = resultadoDaVerificacao(evento, versaoAtual);
      if (r) terminar(r);
    });
    Promise.resolve()
      .then(checkNow)
      .catch(() => terminar({ tipo: "erro", mensagem: MSG_ERRO_ATUALIZACAO }));
  });
}
