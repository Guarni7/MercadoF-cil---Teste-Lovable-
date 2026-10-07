// Canal de processamento do cartão (crédito/débito), separado da forma de pagamento.
//
//   maquininha → maquininha independente: o operador confirma o pagamento à mão;
//   tef        → TEF / PIN pad, pelo agente local;
//   smartpos   → Smart POS / ConnectTEF (cobrança e aprovação confirmadas pelo servidor).
//
// O canal é uma configuração da empresa (company_payment_settings.card_channel) e vale sobre
// qualquer outra coisa — inclusive sobre existir um Smart POS vinculado. Funções puras, sem
// React nem imports `@/`, para testar em Node.

export const CANAIS_CARTAO = ["maquininha", "tef", "smartpos"];
export const CANAL_PADRAO = "maquininha";

export const ROTULOS_CANAL = {
  maquininha: "Maquininha independente",
  tef: "TEF / PIN pad",
  smartpos: "Smart POS (ConnectTEF)",
};

export const canalValido = (valor) => CANAIS_CARTAO.includes(valor);

/**
 * Canal configurado da empresa. Sem `card_channel` (espelho local antigo, linha ainda sem a
 * coluna) deduz o canal como o checkout fazia antes: Smart POS vinculado, depois TEF ligado
 * com agente, depois maquininha. Empresa nova sem nada configurado fica na maquininha.
 */
export function canalDaConfig(config, { temSmartPos = false } = {}) {
  if (canalValido(config?.card_channel)) return config.card_channel;
  if (temSmartPos) return "smartpos";
  if (config?.tef_enabled && String(config?.tef_agent_url || "").trim()) return "tef";
  return CANAL_PADRAO;
}

/**
 * Canal que o checkout pode CONGELAR ao abrir, ou null se ainda não dá para decidir.
 * Canal gravado vale sempre. Sem canal gravado ele depende de haver Smart POS vinculado, então
 * só se decide quando isso é conhecido (ativo/inativo): sem resposta, não decide nem chuta.
 */
export function canalDecidido(config, estadoSmartPos) {
  if (!config) return null;
  if (canalValido(config.card_channel)) return config.card_channel;
  if (estadoSmartPos === "ativo") return canalDaConfig(config, { temSmartPos: true });
  if (estadoSmartPos === "inativo") return canalDaConfig(config, { temSmartPos: false });
  return null;
}

/**
 * O que o checkout pode fazer com crédito/débito agora.
 * @param {object} p
 * @param {object} p.config configuração de pagamento da empresa
 * @param {string} [p.estadoSmartPos] "ativo" | "inativo" | "indeterminado" | "verificando" estado do Smart POS
 *        (estadoConnectTef): ativo = há Smart POS vinculado; inativo = não há
 * @param {boolean} [p.temSmartPos] só para deduzir o canal quando `card_channel` não existe
 * @returns {{ habilitado: boolean, canal: string, liberado: boolean, motivo: string|null }}
 *   habilitado: Crédito e Débito aparecem (card_enabled); liberado: o canal pode cobrar agora;
 *   motivo: por que está bloqueado (nunca cai em outro canal).
 */
export function resolverCanalCartao({ config, estadoSmartPos = "indeterminado", temSmartPos = false }) {
  const habilitado = config?.card_enabled !== false;
  // Canal não gravado: ele é deduzido pelo Smart POS vinculado. Sem saber se há Smart POS
  // (sem resposta do servidor), não dá para decidir o canal com segurança: bloqueia.
  if (habilitado && !canalValido(config?.card_channel) && (estadoSmartPos === "indeterminado" || estadoSmartPos === "verificando")) {
    return { habilitado, canal: null, liberado: false, motivo: "Não foi possível determinar o canal do cartão desta loja. Crédito e débito ficam bloqueados até verificar." };
  }
  const canal = canalDaConfig(config, { temSmartPos });
  if (!habilitado) return { habilitado, canal, liberado: false, motivo: "Cartão desativado nas configurações de pagamento." };

  if (canal === "smartpos") {
    if (estadoSmartPos === "ativo") return { habilitado, canal, liberado: true, motivo: null };
    if (estadoSmartPos === "inativo") {
      return { habilitado, canal, liberado: false, motivo: "O canal Smart POS está escolhido, mas não há Smart POS vinculado. Vincule em Configurações > Pagamento." };
    }
    return { habilitado, canal, liberado: false, motivo: "Não foi possível confirmar o Smart POS desta loja. Crédito e débito ficam bloqueados até verificar." };
  }
  if (canal === "tef") {
    const agente = String(config?.tef_agent_url || "").trim();
    if (config?.tef_enabled && agente) return { habilitado, canal, liberado: true, motivo: null };
    return { habilitado, canal, liberado: false, motivo: "O canal TEF está escolhido, mas o agente TEF não está configurado." };
  }
  return { habilitado, canal, liberado: true, motivo: null };
}

/**
 * Canal de um pagamento já gravado em sales.payments[]. Pagamentos novos trazem `channel`;
 * os antigos são deduzidos pelas marcas que já tinham. Devolve null para o que não é cartão.
 */
export function canalDoPagamento(pagamento) {
  const metodo = pagamento?.method;
  if (metodo !== "credito" && metodo !== "debito") return null;
  if (canalValido(pagamento?.channel)) return pagamento.channel;
  if (pagamento?.provider === "connecttef") return "smartpos";
  if (pagamento?.transactionId) return "tef";
  return "maquininha";
}
