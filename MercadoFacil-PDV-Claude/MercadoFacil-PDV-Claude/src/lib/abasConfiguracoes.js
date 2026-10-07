// Aba ativa de Configurações, guardada na URL (?aba=pagamento) para sobreviver ao F5 e poder ser
// compartilhada. Pura, sem React: testada em scripts/smoke-config-aba-e-pagamento.mjs.
//
// Só as abas de verdade entram aqui. Extras, balança, etiqueta, impressora e financeiro são painéis
// flutuantes (openFloat) e não têm aba nem URL.

export const ABAS_CONFIGURACOES = ["empresa", "pagamento", "vendas", "fiscal", "aparencia", "suporte"];
export const ABA_PADRAO = "empresa";

/** Valor da URL → aba. Ausente, vazio ou desconhecido cai em `empresa`. */
export const abaDaUrl = (valor) => (ABAS_CONFIGURACOES.includes(String(valor)) ? String(valor) : ABA_PADRAO);

/** Novos parâmetros de busca com a aba trocada, mantendo os demais. */
export function paramsComAba(paramsAtuais, aba) {
  const novos = new URLSearchParams(paramsAtuais);
  novos.set("aba", abaDaUrl(aba));
  return novos;
}
