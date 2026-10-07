// Prazo do cancelamento simples (evento 110111) por UF e modelo — gêmeo em JS de
// supabase/functions/_shared/fiscal/prazoCancelamento.ts (o servidor é quem barra de verdade; aqui o
// botão e o modal sabem do prazo antes de ir ao servidor). O teste prazoCancelamento.test.ts garante
// que os dois dão sempre o mesmo resultado.
//
// A SEFAZ é a autoridade: onde o prazo não é conhecido NÃO se bloqueia, ela responde.
//   GO / NFC-e (65): 30 min (art. 167-S-Q do RCTE-GO)
//   GO / NF-e  (55): 24 h (Ajuste SINIEF 07/05)

export const PRAZO_CANCELAMENTO_MIN = {
  GO: { 65: 30, 55: 24 * 60 },
};

/**
 * @typedef {{ limiteMin: number | null, decorridoMin: number | null, restanteMin: number | null, expirado: boolean }} AnalisePrazo
 */

/** @param {string | null | undefined} uf @param {string | number | null | undefined} model */
export function prazoCancelamentoMin(uf, model) {
  const porModelo = /** @type {Record<string, Record<string, number>>} */ (PRAZO_CANCELAMENTO_MIN)[String(uf ?? "").trim().toUpperCase()];
  return porModelo?.[String(model ?? "")] ?? null;
}

/**
 * @param {{ uf?: string | null, model?: string | number | null, authorizedAt?: string | Date | null, agora?: Date }} input
 * @returns {AnalisePrazo}
 */
export function analisarPrazoCancelamento({ uf, model, authorizedAt, agora }) {
  const limiteMin = prazoCancelamentoMin(uf, model);
  const inicio = authorizedAt ? new Date(authorizedAt).getTime() : NaN;
  const decorridoMin = Number.isFinite(inicio) ? ((agora ?? new Date()).getTime() - inicio) / 60_000 : null;
  if (limiteMin === null || decorridoMin === null) {
    return { limiteMin, decorridoMin, restanteMin: null, expirado: false };
  }
  return { limiteMin, decorridoMin, restanteMin: Math.max(0, limiteMin - decorridoMin), expirado: decorridoMin > limiteMin };
}

/** "27 min", "1 h", "2 h 27 min". @param {number} minutos */
export function formatarDuracao(minutos) {
  const total = Math.max(0, Math.floor(minutos));
  if (total < 60) return `${total} min`;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

const nomeDoModelo = (/** @type {string | number | null | undefined} */ model) => (String(model) === "55" ? "NF-e" : "NFC-e");

const formatarLimite = (/** @type {number} */ min) => (min % 60 === 0 ? `${min / 60} ${min === 60 ? "hora" : "horas"}` : `${min} minutos`);

/** Mensagem quando o prazo já passou. @param {{ model?: string | number | null, limiteMin: number, decorridoMin: number }} input */
export function mensagemPrazoExpirado({ model, limiteMin, decorridoMin }) {
  return (
    `Prazo de cancelamento expirado: esta ${nomeDoModelo(model)} foi autorizada há ${formatarDuracao(decorridoMin)} ` +
    `e o prazo é de ${formatarLimite(limiteMin)}. A nota continua válida e a venda não foi cancelada. Fale com o seu contador.`
  );
}

/** Quando a SEFAZ recusa com cStat 501 e o bloqueio local não pegou. @param {string | number | null | undefined} model */
export function mensagemRejeicaoPrazo(model) {
  return (
    `A SEFAZ recusou o cancelamento: o prazo legal para cancelar esta ${nomeDoModelo(model)} já passou. ` +
    "A nota continua válida e a venda não foi cancelada. Fale com o seu contador."
  );
}

/** Texto curto para o botão desabilitado. @param {{ model?: string | number | null, limiteMin: number, authorizedAt: string | Date }} input */
export function dicaPrazoExpirado({ model, limiteMin, authorizedAt }) {
  const hora = new Date(authorizedAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  return `Prazo de ${formatarLimite(limiteMin)} para cancelar a ${nomeDoModelo(model)} expirado (autorizada às ${hora})`;
}
