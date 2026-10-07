// Prazo do cancelamento simples (evento 110111) por UF e modelo.
//
// A SEFAZ é quem decide (rejeição 501, "Prazo de cancelamento superior ao previsto na
// Legislação"). Este módulo só evita gastar uma tentativa e dá uma mensagem melhor, então onde o
// prazo não é conhecido NÃO bloqueia: a SEFAZ responde.
//
// Tabela, em minutos:
//   GO / NFC-e (65): 30 min — prazo normal de cancelamento da NFC-e em Goiás (art. 167-S-Q do
//                    RCTE-GO). O código usava 24 h para os dois modelos e deixou passar uma
//                    tentativa de 2 h 27 min, recusada pela SEFAZ-GO com cStat 501.
//   GO / NF-e  (55): 24 h — prazo geral do Ajuste SINIEF 07/05.
//
// Há um gêmeo em JS para a interface em src/lib/prazoCancelamento.js; o teste
// prazoCancelamento.test.ts garante que os dois dão sempre o mesmo resultado.

export const PRAZO_CANCELAMENTO_MIN: Record<string, Record<string, number>> = {
  GO: { "65": 30, "55": 24 * 60 },
};

export type AnalisePrazo = {
  /** Prazo em minutos; null = sem limite conhecido (a SEFAZ decide). */
  limiteMin: number | null;
  /** Minutos desde a autorização; null se a data é inválida. */
  decorridoMin: number | null;
  /** Minutos que restam (nunca negativo); null sem limite ou sem data. */
  restanteMin: number | null;
  expirado: boolean;
};

export const prazoCancelamentoMin = (uf?: string | null, model?: string | number | null): number | null =>
  PRAZO_CANCELAMENTO_MIN[String(uf ?? "").trim().toUpperCase()]?.[String(model ?? "")] ?? null;

export const analisarPrazoCancelamento = (
  input: { uf?: string | null; model?: string | number | null; authorizedAt?: string | Date | null; agora?: Date },
): AnalisePrazo => {
  const limiteMin = prazoCancelamentoMin(input.uf, input.model);
  const inicio = input.authorizedAt ? new Date(input.authorizedAt).getTime() : NaN;
  const decorridoMin = Number.isFinite(inicio) ? ((input.agora ?? new Date()).getTime() - inicio) / 60_000 : null;
  if (limiteMin === null || decorridoMin === null) {
    return { limiteMin, decorridoMin, restanteMin: null, expirado: false };
  }
  return { limiteMin, decorridoMin, restanteMin: Math.max(0, limiteMin - decorridoMin), expirado: decorridoMin > limiteMin };
};

/** "27 min", "1 h", "2 h 27 min". */
export const formatarDuracao = (minutos: number): string => {
  const total = Math.max(0, Math.floor(minutos));
  if (total < 60) return `${total} min`;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
};

const nomeDoModelo = (model?: string | number | null) => (String(model) === "55" ? "NF-e" : "NFC-e");

const formatarLimite = (min: number) => (min % 60 === 0 ? `${min / 60} ${min === 60 ? "hora" : "horas"}` : `${min} minutos`);

/** Mensagem para o usuário quando o prazo já passou (bloqueio local, antes de ir à SEFAZ). */
export const mensagemPrazoExpirado = (input: { model?: string | number | null; limiteMin: number; decorridoMin: number }) =>
  `Prazo de cancelamento expirado: esta ${nomeDoModelo(input.model)} foi autorizada há ${formatarDuracao(input.decorridoMin)} ` +
  `e o prazo é de ${formatarLimite(input.limiteMin)}. A nota continua válida e a venda não foi cancelada. Fale com o seu contador.`;

/** Mesma ideia quando a SEFAZ recusa com cStat 501 e o bloqueio local não pegou (prazo desconhecido). */
export const mensagemRejeicaoPrazo = (model?: string | number | null) =>
  `A SEFAZ recusou o cancelamento: o prazo legal para cancelar esta ${nomeDoModelo(model)} já passou. ` +
  "A nota continua válida e a venda não foi cancelada. Fale com o seu contador.";
