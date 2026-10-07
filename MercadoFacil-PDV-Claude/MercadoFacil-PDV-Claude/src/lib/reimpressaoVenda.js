// Como o detalhe da venda conta o resultado da reimpressão do cupom (printSaleReceipt).
//
// Regra: nunca dizer que imprimiu sem prova. No app Electron a impressão é silenciosa e o retorno
// confirma (reason "electron"). No navegador só abrimos a janela de impressão: não há como saber se
// o operador imprimiu, então o aviso é neutro. Qualquer outra coisa é erro.
// Pura, sem React: testada em scripts/smoke-reimprimir-venda.mjs.
export const MSG_FALHA_IMPRESSAO = "Falha ao imprimir. Verifique a impressora em Configurações.";

/** @param {{ ok?: boolean, reason?: string, error?: string } | null | undefined} resultado */
export function avisoDaReimpressao(resultado) {
  if (resultado?.ok === true) {
    return resultado.reason === "electron"
      ? { tipo: "sucesso", mensagem: "Cupom enviado à impressora." }
      : { tipo: "info", mensagem: "Janela de impressão aberta. Confirme a impressão no navegador." };
  }
  return { tipo: "erro", mensagem: resultado?.error || MSG_FALHA_IMPRESSAO };
}
