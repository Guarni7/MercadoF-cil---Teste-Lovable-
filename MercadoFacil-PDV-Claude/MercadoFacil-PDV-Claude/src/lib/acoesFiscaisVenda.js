// Ações fiscais da NFC-e no detalhe da venda (Gerenciador): qual botão mostrar, conforme os
// documentos fiscais REAIS da venda. Funções puras, sem React, testadas em
// scripts/smoke-gerenciador-acoes-fiscais.mjs.
//
// Nada aqui emite ou consulta a SEFAZ: emitir, reenviar e reconciliar passam pelo mesmo
// fiscal-emit de sempre (via NfceDialog -> emitirDocumento). O servidor é quem impede duas
// notas para a mesma venda; o front só não oferece o botão errado.
//
// "Reenviar" é o botão perigoso: o fiscal-emit só reconcilia um documento em `transmitting`. Um
// documento em `error` NÃO é reconciliado, e um novo pedido cria outro documento com outro número.
// Se o `error` veio de uma falha DEPOIS do envio (rede, HTTP, resposta sem protocolo), a SEFAZ pode
// ter autorizado a nota, e reenviar emitiria uma segunda NFC-e para a mesma venda. Por isso:
//
//   rejected  -> Reenviar: a SEFAZ respondeu sobre ESTA nota e recusou (cStat de rejeição).
//   error     -> Reenviar só quando é seguro: a nota nunca foi enviada (XML sem assinatura: falha de
//                certificado, CSC, endpoint, validação) ou a SEFAZ confirmou que NÃO autorizou
//                (reconciliação gravou o cStat não autorizado). Qualquer outro `error` é estado
//                incerto: sem botão de envio, só a orientação de consultar a chave.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CSTAT_AUTORIZADO = ["100", "150"];

/** Ações possíveis, na ordem em que o detalhe da venda decide o que mostrar. */
export const ACAO_FISCAL = {
  EMITIR: "emitir", // sem documento
  RECONCILIAR: "reconciliar", // transmitting: o fiscal-emit consulta a SEFAZ antes de qualquer coisa
  REENVIAR: "reenviar", // rejected / error comprovadamente não autorizado
  CONSULTAR: "consultar", // error incerto: a SEFAZ pode ter autorizado; sem botão de envio
  EM_ANDAMENTO: "em_andamento", // draft/validating/pending: o servidor recusa novo envio (409); só informa
  AUTORIZADA: "autorizada", // Baixar XML, DANFE, Cancelar NFC-e
  NENHUMA: "nenhuma", // cancelada, ou venda cancelada
};

const ROTULO = {
  [ACAO_FISCAL.EMITIR]: "Emitir NFC-e",
  [ACAO_FISCAL.RECONCILIAR]: "Reconciliar",
  [ACAO_FISCAL.REENVIAR]: "Reenviar",
};

export const rotuloAcaoFiscal = (acao) => ROTULO[acao] || null;

const cStatConhecido = (doc) => {
  const resposta = doc?.authorizer_response;
  const c = typeof resposta === "object" && resposta ? resposta.cStat : null;
  return c == null ? "" : String(c).trim();
};

/** Chave de acesso de 44 dígitos do documento (coluna ou Id da NFe no XML assinado), ou null. */
export function chaveDoDocumento(doc) {
  const direta = String(doc?.access_key || "").replace(/\D/g, "");
  if (direta.length === 44) return direta;
  return String(doc?.xml_signed || "").match(/Id="NFe(\d{44})"/)?.[1] || null;
}

/** A nota nunca saiu para a SEFAZ? XML ausente ou sem assinatura: o envio exige certificado. */
const nuncaEnviada = (doc) => !doc?.xml_signed || !String(doc.xml_signed).includes("<Signature");

/** A SEFAZ respondeu sobre esta nota e NÃO a autorizou (cStat gravado, diferente de 100/150)? */
const confirmadaNaoAutorizada = (doc) => {
  const c = cStatConhecido(doc);
  return c !== "" && !CSTAT_AUTORIZADO.includes(c);
};

/**
 * Pode oferecer "Reenviar" para este documento sem risco de duplicar uma nota autorizada?
 * Só rejected/error, e no `error` só com prova de que a SEFAZ não tem a nota.
 */
export function podeReenviar(doc) {
  if (doc?.status === "rejected") {
    const codigo = String(doc.rejection_code ?? "").trim();
    return codigo !== "" && !CSTAT_AUTORIZADO.includes(codigo);
  }
  if (doc?.status === "error") return nuncaEnviada(doc) || confirmadaNaoAutorizada(doc);
  return false;
}

/**
 * Qual documento representa a NFC-e da venda: a autorizada, se houver; senão a mais recente.
 * Só modelo 65 (NF-e e NFS-e não entram aqui).
 */
export function escolherDocumentoNfce(docs) {
  const nfces = (docs || []).filter((d) => d?.model === "65");
  const autorizada = nfces.find((d) => d.status === "authorized");
  if (autorizada) return autorizada;
  const porData = (d) => new Date(d.created_at || d.created_date || 0).getTime();
  return [...nfces].sort((a, b) => porData(b) - porData(a))[0] || null;
}

/**
 * Ação fiscal olhando TODAS as tentativas da venda, não só a última: uma tentativa antiga em estado
 * incerto continua sendo risco de duplicidade mesmo que exista uma mais nova.
 * @param {Array<object> | null | undefined} docs documentos fiscais da venda
 * @param {{ status?: string } | null | undefined} sale
 * @param {{ nfceHabilitada?: boolean }} [opcoes] empresa sem NFC-e ligada não vê "Emitir" em toda venda
 * @returns {{ acao: string, doc: object | null, chave: string | null }} doc = o documento que a ação usa
 */
export function analisarNfceDaVenda(docs, sale, { nfceHabilitada = true } = {}) {
  const nfces = (docs || []).filter((d) => d?.model === "65");
  const resultado = (acao, doc) => ({ acao, doc: doc || null, chave: doc ? chaveDoDocumento(doc) : null });

  const autorizada = nfces.find((d) => d.status === "authorized");
  if (autorizada) return resultado(ACAO_FISCAL.AUTORIZADA, autorizada); // vale mesmo com a venda cancelada: o XML continua sendo da nota
  if (sale?.status === "cancelada") return resultado(ACAO_FISCAL.NENHUMA, escolherDocumentoNfce(nfces));

  const transmitindo = nfces.find((d) => d.status === "transmitting");
  if (transmitindo) return resultado(ACAO_FISCAL.RECONCILIAR, transmitindo);

  const incerto = nfces.find((d) => d.status === "error" && !podeReenviar(d));
  if (incerto) return resultado(ACAO_FISCAL.CONSULTAR, incerto);

  const doc = escolherDocumentoNfce(nfces);
  if (!doc) return resultado(nfceHabilitada ? ACAO_FISCAL.EMITIR : ACAO_FISCAL.NENHUMA, null);
  switch (doc.status) {
    case "rejected":
    case "error":
      return resultado(podeReenviar(doc) ? ACAO_FISCAL.REENVIAR : ACAO_FISCAL.CONSULTAR, doc);
    case "draft":
    case "validating":
    case "pending":
      return resultado(ACAO_FISCAL.EM_ANDAMENTO, doc);
    default: // cancelled e qualquer status desconhecido: não oferece emissão às cegas
      return resultado(ACAO_FISCAL.NENHUMA, doc);
  }
}

/** Documentos de NFC-e da venda, em qualquer status. Venda offline ainda sem UUID de servidor não tem nota. */
export async function buscarDocumentosNfceDaVenda(api, saleId) {
  if (!UUID.test(String(saleId || ""))) return [];
  const docs = await api.entities.FiscalDocument.filter({ sale_id: saleId, model: "65" });
  return docs || [];
}

export const MSG_CANCELAMENTO_BLOQUEADO =
  "Não é possível cancelar esta venda enquanto o status fiscal estiver incerto. Consulte a NFC-e pela chave de acesso antes de prosseguir.";
// Mesma situação (error incerto), dita para quem está devolvendo ou trocando.
export const MSG_DEVOLUCAO_BLOQUEADA =
  "Não é possível devolver ou trocar itens desta venda enquanto o status fiscal estiver incerto. Consulte a NFC-e pela chave de acesso antes de prosseguir.";

/**
 * A venda tem alguma tentativa de NFC-e em `error` incerto (a SEFAZ pode ter autorizado)? Devolve o
 * documento incerto, ou null. Cancelar a venda nesse estado deixaria uma nota talvez válida na SEFAZ
 * sem venda correspondente, e o cancelamento fiscal não saberia qual nota cancelar. Lança erro se não
 * conseguir consultar: nunca cancela sem saber.
 */
export async function statusFiscalIncerto(api, saleId) {
  const docs = await buscarDocumentosNfceDaVenda(api, saleId);
  // `sale` sem status: aqui interessa só se há tentativa incerta, mesmo em venda já marcada como cancelada.
  const analise = analisarNfceDaVenda(docs, {}, { nfceHabilitada: true });
  return analise.acao === ACAO_FISCAL.CONSULTAR ? analise.doc : null;
}

export const MSG_ESTADO_INCERTO =
  "Estado fiscal incerto: a tentativa anterior terminou em erro depois do envio e a SEFAZ pode ter autorizado a nota. Não reenvie. Consulte a chave no portal da SEFAZ e fale com o suporte.";
export const MSG_ESTADO_NAO_VERIFICADO =
  "Não foi possível confirmar o estado fiscal da venda. Nada foi enviado à SEFAZ. Tente de novo em instantes.";

/**
 * Antes de pedir ao fiscal-emit uma emissão (primeira ou "Tentar novamente"): é seguro enviar?
 * Usa a mesma regra do Gerenciador (statusFiscalIncerto). Só `incerto` esconde o botão de nova
 * tentativa; `verificacao` (a consulta falhou) bloqueia ESTA tentativa sem esconder o botão, porque
 * clicar de novo refaz a checagem. `transmitting` é permitido: o servidor reconcilia, não emite outra nota.
 * @returns {Promise<{ permitido: boolean, motivo: "incerto" | "verificacao" | null, doc: object | null, chave: string | null, mensagem: string | null }>}
 */
export async function podeTentarEmitirDeNovo(api, saleId) {
  try {
    const doc = await statusFiscalIncerto(api, saleId);
    if (doc) return { permitido: false, motivo: "incerto", doc, chave: chaveDoDocumento(doc), mensagem: MSG_ESTADO_INCERTO };
    return { permitido: true, motivo: null, doc: null, chave: null, mensagem: null };
  } catch (e) {
    console.error("Falha ao verificar o estado fiscal da venda:", e);
    return { permitido: false, motivo: "verificacao", doc: null, chave: null, mensagem: MSG_ESTADO_NAO_VERIFICADO };
  }
}

// ---------- cancelar venda / devolver / trocar com a NFC-e ainda sem resolução ----------
// Desfazer uma venda (cancelar, devolver, trocar) devolve estoque e dinheiro. Com a NFC-e ainda sem
// resolução, a SEFAZ pode autorizar (ou já ter autorizado) depois, e ficaria uma nota válida sem
// venda, que nem dá para cancelar depois (o fiscal-document só cancela documento `authorized`).
export const MSG_TRANSMITINDO_BLOQUEADO =
  "A NFC-e desta venda ainda está em transmissão e a SEFAZ pode já tê-la autorizado. Reconcilie a NFC-e primeiro (detalhe da venda no Gerenciador > Reconciliar) e só depois cancele ou devolva.";
export const MSG_EM_ANDAMENTO_BLOQUEADO =
  "A NFC-e desta venda ainda está em andamento no autorizador. Aguarde a resposta da SEFAZ antes de cancelar ou devolver.";
export const MSG_FISCAL_NAO_VERIFICADO =
  "Não foi possível verificar o status fiscal da venda. Nada foi alterado. Tente de novo em instantes.";

/** Aviso que impede desfazer a venda para esta ação fiscal, ou null se pode seguir. */
export function mensagemBloqueioDesfazer(acao) {
  if (acao === ACAO_FISCAL.CONSULTAR) return MSG_CANCELAMENTO_BLOQUEADO;
  if (acao === ACAO_FISCAL.RECONCILIAR) return MSG_TRANSMITINDO_BLOQUEADO;
  if (acao === ACAO_FISCAL.EM_ANDAMENTO) return MSG_EM_ANDAMENTO_BLOQUEADO;
  return null; // authorized (cancela a nota primeiro), rejected/error seguro, sem documento, cancelada
}

/**
 * O estado fiscal da venda impede cancelar/devolver/trocar? Lê os documentos reais e usa a mesma
 * análise do Gerenciador (analisarNfceDaVenda). Lança erro se não conseguir ler: quem chama bloqueia.
 * @returns {Promise<{ bloqueado: boolean, acao: string, mensagem: string | null, chave: string | null }>}
 */
export async function estadoFiscalImpedeDesfazer(api, saleId) {
  const docs = await buscarDocumentosNfceDaVenda(api, saleId);
  // `sale` sem status: interessa o estado do documento, mesmo em venda já marcada como cancelada.
  const analise = analisarNfceDaVenda(docs, {}, { nfceHabilitada: true });
  const mensagem = mensagemBloqueioDesfazer(analise.acao);
  return { bloqueado: !!mensagem, acao: analise.acao, mensagem, chave: mensagem ? analise.chave : null };
}

// ---------- avisos quando NÃO há botão de emitir ----------
// Só EXIBIÇÃO: nenhuma regra fiscal acima muda. Sem botão e sem explicação o operador não sabe se é falha,
// configuração ou venda ainda não sincronizada. Testada em scripts/smoke-nfce-avisos.mjs.
export const MSG_NFCE_DESATIVADA = "NFC-e desativada para esta empresa. Para emitir nesta venda, ative a NFC-e em Configurações > Fiscal.";
export const MSG_NFCE_NAO_CONFIGURADA = "A NFC-e ainda não foi configurada para esta empresa. Configure em Configurações > Fiscal para poder emitir.";
export const MSG_CONFIG_FISCAL_INDISPONIVEL = "Não foi possível carregar a configuração fiscal. Nada foi enviado à SEFAZ. Tente de novo em instantes.";
export const MSG_VENDA_AGUARDANDO_SYNC = "Esta venda ainda está aguardando sincronização. A NFC-e só pode ser emitida depois que a venda chegar à nuvem.";

/** A venda já existe no servidor (id UUID)? Venda feita offline ainda não sincronizada tem id local. */
export const vendaSincronizada = (sale) => UUID.test(String(sale?.id || ""));

/**
 * Aviso para o detalhe da venda quando a NFC-e não pode ser emitida por motivo que não é do documento.
 * @param {{ acao: string, doc?: object | null }} analise resultado de analisarNfceDaVenda
 * @param {{ sale?: { id?: string, status?: string } | null, config?: object | null, configFalhou?: boolean, carregando?: boolean }} contexto
 *   config: linha de CompanyFiscalSettings (null = empresa nunca configurou); configFalhou: a leitura deu erro;
 *   carregando: a configuração ainda está sendo lida
 * @returns {{ codigo: "aguardando_sincronizacao" | "config_indisponivel" | "nao_configurada" | "desativada", mensagem: string, podeTentarDeNovo: boolean } | null}
 */
export function avisoNfceDaVenda(analise, { sale, config, configFalhou = false, carregando = false } = {}) {
  if (carregando || sale?.status === "cancelada") return null; // ainda lendo a configuração: não afirma nada
  const acao = analise?.acao;
  // com documento fiscal (autorizada, transmitindo, rejeitada, erro, em andamento) o próprio detalhe explica
  if (acao !== ACAO_FISCAL.EMITIR && acao !== ACAO_FISCAL.NENHUMA) return null;
  if (analise?.doc) return null;
  if (!vendaSincronizada(sale)) return { codigo: "aguardando_sincronizacao", mensagem: MSG_VENDA_AGUARDANDO_SYNC, podeTentarDeNovo: false };
  if (configFalhou) return { codigo: "config_indisponivel", mensagem: MSG_CONFIG_FISCAL_INDISPONIVEL, podeTentarDeNovo: true };
  if (acao === ACAO_FISCAL.EMITIR) return null; // habilitada e sincronizada: o botão Emitir NFC-e é o caminho
  return config
    ? { codigo: "desativada", mensagem: MSG_NFCE_DESATIVADA, podeTentarDeNovo: false }
    : { codigo: "nao_configurada", mensagem: MSG_NFCE_NAO_CONFIGURADA, podeTentarDeNovo: false };
}
