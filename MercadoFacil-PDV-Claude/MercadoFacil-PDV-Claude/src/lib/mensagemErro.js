// Texto de erro para o OPERADOR. O erro técnico original continua indo para o console de quem chama
// (console.error(..., err)); aqui só se decide o que aparece na tela. Pura, sem React: testada em
// scripts/smoke-mensagem-erro.mjs.
//
// Regras, nesta ordem:
//   1. mensagem de negócio já escrita em português (ex.: "Estoque insuficiente", "Usuário sem empresa
//      vinculada.") passa como está, desde que não tenha cara de erro técnico;
//   2. erro conhecido (sem rede, sessão expirada, sem permissão, duplicado, em uso, dado inválido,
//      servidor indisponível, demora) vira frase útil;
//   3. o resto: "Não foi possível <contexto>." + orientação, sem jogar texto técnico na tela.
// Mensagens fiscais e de impressão que já são claras NÃO passam por aqui.

export const MSG_SEM_CONEXAO = "Sem conexão com o servidor. Verifique a internet e tente novamente.";
export const MSG_SESSAO_EXPIRADA = "Sua sessão expirou. Entre novamente para continuar.";
export const MSG_JA_EXISTE = "Já existe um cadastro com esses dados.";
export const MSG_EM_USO = "Este registro está ligado a outros dados e não pode ser alterado ou removido agora.";
export const MSG_DADOS_INVALIDOS = "Há dados inválidos ou faltando. Revise os campos e tente novamente.";
export const MSG_SERVIDOR_INDISPONIVEL = "O servidor está indisponível no momento. Tente novamente em instantes.";
export const MSG_DEMOROU = "A operação demorou mais que o esperado. Tente novamente.";

const textoDo = (err) => String(err?.message ?? (typeof err === "string" ? err : "") ?? "").trim();
const statusDo = (err) => Number(err?.status ?? err?.context?.status ?? err?.cause?.status ?? err?.cause?.context?.status ?? NaN);
const codigoDo = (err) => String(err?.code ?? err?.cause?.code ?? "");

// Cara de erro técnico: nunca vai para a tela como está.
const TECNICO = /(\b[A-Za-z]*Error\b|\bundefined\b|\bnull\b|\bNaN\b|supabase|postgres|PGRST|\bjwt\b|\bhttp\b|https?:\/\/|\bfetch\b|edge function|non-2xx|\bstatus code\b|\brelation\b|\bcolumn\b|\bconstraint\b|violates|\bschema\b|\bsql\b|stack|\{|\}|\bat \w+\.\w+|ECONN|ENOTFOUND|ERR_|net::)/i;
// Cara de frase em português escrita de propósito.
const PORTUGUES = /([áàâãéêíóôõúç]|\b(não|nao|erro ao|falha|inválid|obrigatóri|preencha|selecione|informe|já|estoque|venda|cliente|produto|usuário|empresa|caixa|permissão|senha|e-mail)\b)/i;

/**
 * @param {any} err erro capturado (Error, string, resposta do Supabase, ...)
 * @param {string} [contexto] o que se tentava fazer, no infinitivo ("salvar o produto")
 * @param {{ fallback?: string }} [opcoes] fallback: frase pronta para o caso desconhecido (ex.: a de impressão)
 */
export function mensagemDeErro(err, contexto = "concluir a operação", { fallback } = {}) {
  const texto = textoDo(err);
  const baixo = texto.toLowerCase();
  const status = statusDo(err);
  const codigo = codigoDo(err);

  // rede
  const offline = typeof navigator !== "undefined" && navigator.onLine === false;
  if (offline || /failed to fetch|networkerror|network request failed|load failed|failed to send a request|fetcherror|err_internet|err_network/.test(baixo) || err?.name === "FunctionsFetchError") return MSG_SEM_CONEXAO;
  // tempo
  if (err?.name === "AbortError" || /timeout|timed out|demorou/.test(baixo)) return MSG_DEMOROU;
  // sessão
  if (status === 401 || /jwt expired|invalid jwt|not authenticated|auth session missing|refresh token|sessão expirou/.test(baixo)) return MSG_SESSAO_EXPIRADA;
  // permissão
  if (status === 403 || codigo === "42501" || /permission denied|row-level security|row level security|not authorized|forbidden|sem permissão/.test(baixo)) return `Você não tem permissão para ${contexto}.`;
  // banco
  if (codigo === "23505" || /duplicate key|already exists|unique constraint/.test(baixo)) return MSG_JA_EXISTE;
  if (codigo === "23503" || /foreign key/.test(baixo)) return MSG_EM_USO;
  if (["23502", "22P02", "23514", "22001", "22003"].includes(codigo) || /null value in column|invalid input syntax|check constraint|value too long/.test(baixo)) return MSG_DADOS_INVALIDOS;
  // servidor
  if (status >= 500 || /non-2xx|edge function returned|internal server error|bad gateway|service unavailable|gateway/.test(baixo)) return MSG_SERVIDOR_INDISPONIVEL;

  // mensagem de negócio em português, sem cara técnica
  if (texto && texto.length <= 200 && !TECNICO.test(texto) && PORTUGUES.test(texto)) return texto;

  return fallback || `Não foi possível ${contexto}. Tente novamente; se continuar, fale com o suporte.`;
}
