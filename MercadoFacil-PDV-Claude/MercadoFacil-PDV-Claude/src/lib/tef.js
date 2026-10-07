// TEF (Transferência Eletrônica de Fundos) — arquitetura interna.
//
// Fala com um agente HTTP local no PC do caixa (endpoint em getTefConfig().agentUrl).
// Esse agente ainda não existe: nenhum SDK oficial (CliSiTef/PayGo) está
// integrado aqui. O contrato HTTP abaixo (/payment, /cancel, /transaction/:id,
// /status) é deste projeto, não da Software Express — quando o agente oficial
// existir, ele implementa esses mesmos endpoints, ou este arquivo é ajustado
// para o formato real que a homologação exigir. Nenhum parâmetro ou endpoint
// do SDK CliSiTef é assumido aqui.
//
// A máquina de estados da transação (TefStatus, transactionId, recuperação)
// vive em tefState.js, sem I/O — este arquivo só cuida de falar HTTP com o
// agente e devolver os estados de lá. Tudo de tefState é reexportado aqui
// para quem já importa de "@/lib/tef" continuar funcionando.

import { getCachedPaymentConfig } from "@/lib/paymentConfig";
import { TefStatus, classifyTefResponse, createTefTransactionId } from "@/lib/tefState";

export {
  TefStatus,
  isTefApproved,
  isTefInFlight,
  createTefTransactionId,
  savePendingTefTransaction,
  clearPendingTefTransaction,
  getPendingTefTransaction,
} from "@/lib/tefState";

// A configuração agora vem da empresa (espelhada no localStorage pelo
// paymentConfig), não mais de uma chave "tef_config" só deste navegador.
export const getTefConfig = () => {
  const cfg = getCachedPaymentConfig();
  return {
    enabled: !!cfg.tef_enabled,
    provider: cfg.tef_provider || "",
    // O endereço do agente é do computador do caixa, então cada máquina pode
    // sobrescrever o padrão da loja localmente.
    agentUrl: localStorage.getItem("tef_agent_url") || cfg.tef_agent_url || "",
    terminalId: cfg.tef_terminal_id || "",
  };
};

export const isTefConfigured = () => {
  const config = getTefConfig();
  return !!(config.enabled && config.agentUrl);
};

/**
 * Inicia uma transação TEF. Nunca lança para desfecho de negócio (recusado,
 * pendente, timeout) — só lança se o TEF não estiver configurado, que é erro
 * de operação, não de transação. `transactionId` deve ser gerado pelo
 * chamador (createTefTransactionId) antes de chamar, para existir mesmo se a
 * chamada falhar antes de qualquer resposta — é o que permite cancelar ou
 * consultar depois.
 */
export const initiateTefPayment = async ({ amount, type, installments, transactionId }) => {
  const config = getTefConfig();
  if (!config.agentUrl) {
    throw new Error("TEF não configurado. Vá em Configurações → Pagamento → TEF.");
  }
  const txId = transactionId || createTefTransactionId();
  const valor = parseFloat(Number(amount).toFixed(2));

  const payload = {
    transactionId: txId,
    amount: valor,
    type, // "credito" | "debito"
    installments: type === "credito" ? parseInt(installments) || 1 : 1,
    terminalId: config.terminalId || "",
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000); // TEF can take a while

  try {
    const res = await fetch(`${config.agentUrl}/payment`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!res.ok) {
      return {
        status: TefStatus.ERROR,
        approved: false,
        transactionId: txId,
        amount: valor,
        message: `TEF respondeu ${res.status}`,
      };
    }

    const data = await res.json();
    const status = classifyTefResponse(data);
    return {
      status,
      approved: status === TefStatus.APPROVED,
      transactionId: txId,
      amount: valor,
      nsu: data.nsu || "",
      brand: data.brand || "",
      message: data.message || "",
      receipt: data.receipt || "",
    };
  } catch (e) {
    const timedOut = e.name === "AbortError";
    return {
      status: timedOut ? TefStatus.TIMEOUT : TefStatus.ERROR,
      approved: false,
      transactionId: txId,
      amount: valor,
      // Timeout é ambíguo de propósito: o agente pode ter aprovado do lado da
      // maquininha sem a resposta chegar. Por isso timeout nunca vira
      // "aprovado" sozinho — exige consulta (consultarTefTransacao) antes de
      // decidir o que aconteceu.
      message: timedOut
        ? "Tempo esgotado aguardando resposta do TEF. Consulte a transação antes de tentar novamente."
        : `Erro TEF: ${e.message}`,
    };
  } finally {
    clearTimeout(timeout);
  }
};

/**
 * Consulta o desfecho de uma transação já iniciada. Existe para resolver
 * timeout/queda de conexão sem reenviar a cobrança — e para recuperar uma
 * transação que ficou pendente se o PDV foi fechado no meio (ver
 * getPendingTefTransaction). O endpoint /transaction/:id é deste projeto;
 * ajustar quando o agente oficial existir.
 */
export const consultarTefTransacao = async (transactionId) => {
  const config = getTefConfig();
  if (!transactionId) return { status: TefStatus.ERROR, message: "Sem transação para consultar." };
  if (!config.agentUrl) return { status: TefStatus.ERROR, message: "TEF não configurado." };

  try {
    const res = await fetch(`${config.agentUrl}/transaction/${encodeURIComponent(transactionId)}`, {
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      return { status: TefStatus.ERROR, transactionId, message: `TEF respondeu ${res.status}` };
    }
    const data = await res.json();
    return {
      status: classifyTefResponse(data),
      approved: data.approved === true,
      transactionId,
      nsu: data.nsu || "",
      message: data.message || "",
    };
  } catch (e) {
    return { status: TefStatus.ERROR, transactionId, message: e.message };
  }
};

/**
 * Cancela/estorna uma transação pelo transactionId. Sem transactionId não
 * cancela nada específico — cancelamento sem alvo seria o mesmo risco que o
 * comentário antigo deste arquivo já evitava (nunca fabricar sucesso).
 */
export const cancelTefPayment = async (transactionId) => {
  if (!transactionId) return { status: TefStatus.ERROR, message: "Sem transação para cancelar." };
  const config = getTefConfig();
  if (!config.agentUrl) return { status: TefStatus.ERROR, message: "TEF não configurado." };

  try {
    const res = await fetch(`${config.agentUrl}/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transactionId }),
    });
    return { status: res.ok ? TefStatus.CANCELLED : TefStatus.ERROR, transactionId };
  } catch (e) {
    return { status: TefStatus.ERROR, transactionId, message: e.message };
  }
};

// Check if the TEF agent is running
export const checkTefStatus = async () => {
  const config = getTefConfig();
  if (!config.agentUrl) return { online: false };
  try {
    const res = await fetch(`${config.agentUrl}/status`, { signal: AbortSignal.timeout(3000) });
    if (res.ok) {
      const data = await res.json();
      return { online: true, terminal: data.terminal || "", provider: data.provider || "" };
    }
    return { online: false };
  } catch {
    return { online: false };
  }
};
