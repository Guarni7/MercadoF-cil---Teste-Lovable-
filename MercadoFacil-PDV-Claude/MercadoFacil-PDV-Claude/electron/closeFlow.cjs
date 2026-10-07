/**
 * Fechar a janela com backup: o main segura o fechamento, pergunta ao renderer (que roda o backup local
 * já existente, src/lib/localBackup.js) e só fecha quando o renderer confirma. Se a janela fechar com uma
 * atualização baixada, o autoInstallOnAppQuit instala depois disso: ordem backup → fechamento → instalação.
 *
 * Nunca deixa o app preso: se o renderer não confirmar o recebimento (ack) no prazo, ou o envio falhar
 * (janela travada/destruída), o fechamento segue. Depois do ack quem decide é o operador.
 * Fábrica com dependências injetadas: testada em scripts/smoke-electron-fechamento.mjs, sem Electron.
 */
const ACK_TIMEOUT_PADRAO_MS = 5000;

/**
 * @param {{
 *   enviar: (canal: string, payload: object) => void,
 *   fecharJanela: () => void,
 *   contexto?: () => object,
 *   podePerguntar?: () => boolean,
 *   ackTimeoutMs?: number,
 *   agendar?: typeof setTimeout,
 *   cancelarAgenda?: typeof clearTimeout,
 * }} deps
 */
function createCloseFlow({ enviar, fecharJanela, contexto = () => ({}), podePerguntar = () => true, ackTimeoutMs = ACK_TIMEOUT_PADRAO_MS, agendar = setTimeout, cancelarAgenda = clearTimeout }) {
  let liberado = false; // próxima tentativa de fechar passa direto
  let perguntando = false;
  let timer = null;

  const limpa = () => {
    if (timer) cancelarAgenda(timer);
    timer = null;
  };
  const fechaAgora = () => {
    limpa();
    perguntando = false;
    liberado = true;
    fecharJanela();
  };

  return {
    /** Ligar em `mainWindow.on("close", (e) => flow.aoFechar(e))`. */
    aoFechar(evento) {
      if (liberado) return; // deixa fechar
      evento.preventDefault();
      if (!podePerguntar()) return fechaAgora();
      try {
        enviar("mf:close:request", contexto());
      } catch {
        return fechaAgora(); // renderer indisponível: não prende o app
      }
      if (!perguntando) {
        perguntando = true;
        timer = agendar(fechaAgora, ackTimeoutMs); // renderer travado: fecha mesmo assim
      }
    },
    /** O renderer recebeu o pedido e mostrou o diálogo. */
    ack() {
      limpa();
    },
    /** O operador decidiu fechar (com ou sem backup). */
    confirmar: fechaAgora,
    /** O operador desistiu: a próxima tentativa de fechar pergunta de novo. */
    cancelar() {
      limpa();
      perguntando = false;
    },
    /** Saída que já está em andamento (instalar e reiniciar, app.quit): não pergunta. */
    liberar() {
      limpa();
      liberado = true;
    },
    estado: () => ({ liberado, perguntando }),
  };
}

module.exports = { createCloseFlow, ACK_TIMEOUT_PADRAO_MS };
