// Adaptadores de transmissão.
//
// Cada autorizador tem endpoint, formato e credencial próprios, mas o fluxo de
// emissão não precisa saber disso: ele chama transmit() e recebe sempre a mesma
// resposta.
//
// Nenhum adaptador tem caminho de sucesso simulado. Quando falta certificado ou
// quando a integração ainda não existe, a resposta é { outcome: "error" } com a
// razão em texto — e o documento termina em 'error', nunca em 'authorized'.

export type TransmitOutcome =
  | { outcome: "authorized"; protocol: string; accessKey?: string; xml?: string; raw?: unknown }
  | { outcome: "rejected"; code: string; message: string; raw?: unknown }
  | { outcome: "pending"; receipt?: string; raw?: unknown }
  | { outcome: "error"; message: string; raw?: unknown };

export type TransmitInput = {
  model: "55" | "65" | "nfse";
  environment: "homologacao" | "producao";
  xml: string;
  /** DPS compactada em gzip e base64, formato exigido pelo POST /nfse. */
  xmlGzipBase64?: string | null;
  /** Certificado do titular já aberto do .pfx, em PEM. Nunca sai do servidor. */
  certPem?: string | null;
  keyPem?: string | null;
  uf?: string | null;
  cityIbgeCode?: string | null;
  /** Webservice de autorização da SEFAZ da UF, vindo da tabela oficial. */
  endpoint?: string | null;
};

// Endpoints oficiais da NFS-e Nacional.
//
// Quem emite é o contribuinte, e o serviço do contribuinte é o Sefin Nacional —
// o ADN é o ambiente de dados (distribuição para municípios) e o DANFSE. Mandar
// a DPS para o ADN devolveria 404 no dia da homologação.
//
// Fonte: gov.br/nfse → Documentação técnica → "APIs - Prod. Restrita e Produção"
// e Manual dos Contribuintes (Emissor Público Nacional, API NFS-e v1.2).
export const NFSE_ENDPOINTS = {
  homologacao: "https://sefin.producaorestrita.nfse.gov.br/SefinNacional",
  producao: "https://sefin.nfse.gov.br/SefinNacional",
} as const;

/** DANFSE fica no ADN, não no Sefin. */
export const DANFSE_ENDPOINTS = {
  homologacao: "https://adn.producaorestrita.nfse.gov.br/danfse",
  producao: "https://adn.nfse.gov.br/danfse",
} as const;

// Conexão com certificado cliente. O runtime das Edge Functions expõe
// Deno.createHttpClient, medido em fiscal-diagnostics — sem isso não há
// transmissão para autorizador nenhum.
function mtlsClient(certPem: string, keyPem: string) {
  const createHttpClient = (Deno as unknown as {
    createHttpClient?: (opts: Record<string, string>) => unknown;
  }).createHttpClient;

  if (typeof createHttpClient !== "function") {
    throw new Error(
      "Este runtime não expõe conexão com certificado cliente (mTLS), exigida pela SEFAZ " +
        "e pela NFS-e Nacional.",
    );
  }

  return createHttpClient({ cert: certPem, key: keyPem });
}

/** Mensagem de processamento do padrão oficial (codigo/descricao/complemento). */
type MensagemProcessamento = {
  codigo?: string;
  mensagem?: string;
  descricao?: string;
  complemento?: string;
};

function coletarMensagens(corpo: Record<string, unknown>): MensagemProcessamento[] {
  const lista = (corpo.erros ?? corpo.Erros) as MensagemProcessamento[] | undefined;
  if (Array.isArray(lista) && lista.length) return lista;
  const unico = (corpo.erro ?? corpo.Erro) as MensagemProcessamento | undefined;
  if (unico && typeof unico === "object") return [unico];
  return [];
}

function descreverMensagens(mensagens: MensagemProcessamento[]): string {
  return mensagens
    .map((m) =>
      [m.codigo, m.descricao || m.mensagem, m.complemento]
        .filter(Boolean)
        .join(" — ")
    )
    .filter(Boolean)
    .join("; ");
}

// A DPS assinada vai no corpo do POST /nfse da Sefin Nacional, em JSON com o
// XML em base64, e a conexão é autenticada pelo certificado da empresa.
// Fonte: gov.br/nfse — Manual de Contribuintes, API do Emissor Público.
async function transmitNfse(input: TransmitInput): Promise<TransmitOutcome> {
  if (!input.certPem || !input.keyPem) {
    return {
      outcome: "error",
      message:
        "Certificado digital da empresa não cadastrado. A NFS-e Nacional exige certificado " +
        "para assinar a DPS e autenticar a conexão.",
    };
  }

  const base = NFSE_ENDPOINTS[input.environment];
  let client: unknown;
  try {
    client = mtlsClient(input.certPem, input.keyPem);
  } catch (e) {
    return { outcome: "error", message: (e as Error).message };
  }

  try {
    const resposta = await fetch(`${base}/nfse`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dpsXmlGZipB64: input.xmlGzipBase64 ?? "" }),
      // @ts-ignore client é a opção de mTLS do Deno
      client,
    });

    const texto = await resposta.text();
    let corpo: Record<string, unknown> = {};
    try {
      corpo = JSON.parse(texto);
    } catch {
      corpo = { raw: texto };
    }

    if (resposta.ok) {
      // A NFS-e volta com chave de acesso e o XML da nota gerada. Sem chave,
      // não houve autorização — mesmo com HTTP 200.
      const chave = (corpo.chaveAcesso || corpo.chave) as string | undefined;
      if (!chave) {
        return {
          outcome: "error",
          message: "Sefin Nacional respondeu sem chave de acesso; nota não foi gerada",
          raw: corpo,
        };
      }
      return {
        outcome: "authorized",
        protocol: String(corpo.nsu ?? chave),
        accessKey: chave,
        xml: (corpo.nfseXmlGZipB64 as string) ?? undefined,
        raw: corpo,
      };
    }

    // Rejeição de regra de negócio vem em `erros` (NFSePostResponseErro) ou em
    // `erro` (ResponseErro), ambos no formato MensagemProcessamento. Isso é
    // rejeição do autorizador, não falha nossa — e precisa chegar ao lojista
    // com o código, que é por onde o contador resolve.
    const mensagens = coletarMensagens(corpo);
    if (resposta.status === 400 && mensagens.length) {
      return {
        outcome: "rejected",
        code: mensagens[0].codigo || String(resposta.status),
        message: descreverMensagens(mensagens),
        raw: corpo,
      };
    }

    return {
      outcome: "error",
      message: mensagens.length
        ? `Sefin Nacional recusou (HTTP ${resposta.status}): ${descreverMensagens(mensagens)}`
        : `Sefin Nacional respondeu HTTP ${resposta.status}`,
      raw: corpo,
    };
  } catch (e) {
    return {
      outcome: "error",
      message: `Falha ao transmitir para a NFS-e Nacional: ${(e as Error).message}`,
    };
  }
}

const NFE_NS = "http://www.portalfiscal.inf.br/nfe";
const NFE_AUTORIZACAO_WSDL = "http://www.portalfiscal.inf.br/nfe/wsdl/NFeAutorizacao4";
const NFE_RECEPCAO_EVENTO_WSDL = "http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4";
const NFE_CONSULTA_PROTOCOLO_WSDL = "http://www.portalfiscal.inf.br/nfe/wsdl/NFeConsultaProtocolo4";

const tag = (xml: string, nome: string): string | null => {
  const m = xml.match(new RegExp(`<${nome}[^>]*>([\\s\\S]*?)</${nome}>`));
  return m ? m[1].trim() : null;
};

/**
 * Lote síncrono de autorização (enviNFe, indSinc=1).
 *
 * Síncrono porque o PDV precisa da resposta enquanto o cliente está no caixa;
 * o assíncrono devolveria recibo e obrigaria a uma segunda consulta antes de
 * imprimir o cupom.
 */
const montarEnviNFe = (xmlAssinado: string, lote: string) =>
  `<enviNFe xmlns="${NFE_NS}" versao="4.00">` +
  `<idLote>${lote}</idLote>` +
  `<indSinc>1</indSinc>` +
  xmlAssinado.replace(/^<\?xml[^>]*\?>/, "") +
  `</enviNFe>`;

const montarEnvelope = (corpo: string, wsdl: string = NFE_AUTORIZACAO_WSDL) =>
  `<?xml version="1.0" encoding="utf-8"?>` +
  `<soap12:Envelope xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">` +
  `<soap12:Body>` +
  `<nfeDadosMsg xmlns="${wsdl}">${corpo}</nfeDadosMsg>` +
  `</soap12:Body></soap12:Envelope>`;

// NF-e (55) e NFC-e (65): XML assinado em XMLDSig com o certificado A1 da loja,
// enviado ao webservice NFeAutorizacao4 da SEFAZ da UF por SOAP 1.2 sobre mTLS.
//
// O endereço não está escrito aqui de propósito: cada UF tem o seu, muda por
// ambiente e por modelo, e a lista é republicada pelo Portal Nacional. Endpoint
// chutado no código vira nota perdida, então ele vem da tabela oficial
// carregada em fiscal_sefaz_endpoints (scripts/fiscal/import-sefaz-endpoints.mjs).
//
// Fonte do protocolo: Manual de Orientação do Contribuinte (MOC) 7.0, NF-e
// layout 4.00 — serviço NFeAutorizacao4.
async function transmitSefaz(input: TransmitInput): Promise<TransmitOutcome> {
  if (!input.certPem || !input.keyPem) {
    return {
      outcome: "error",
      message:
        "Certificado digital A1 não cadastrado. A SEFAZ só aceita documento assinado " +
        "com o certificado da empresa emitente.",
    };
  }

  if (!input.endpoint) {
    return {
      outcome: "error",
      message:
        `Endereço do serviço de autorização da SEFAZ${input.uf ? `-${input.uf}` : ""} ` +
        "não cadastrado para este ambiente. Carregue a tabela oficial de webservices " +
        "antes de emitir (o XML foi montado e guardado, mas não vale como documento " +
        "fiscal sem autorização).",
    };
  }

  let client: unknown;
  try {
    client = mtlsClient(input.certPem, input.keyPem);
  } catch (e) {
    return { outcome: "error", message: (e as Error).message };
  }

  try {
    const lote = String(Date.now()).slice(-15);
    const resposta = await fetch(input.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/soap+xml; charset=utf-8" },
      body: montarEnvelope(montarEnviNFe(input.xml, lote)),
      // @ts-ignore client é a opção de mTLS do Deno
      client,
    });

    const texto = await resposta.text();

    if (!resposta.ok) {
      return {
        outcome: "error",
        message: `SEFAZ${input.uf ? `-${input.uf}` : ""} respondeu HTTP ${resposta.status}`,
        raw: texto.slice(0, 2000),
      };
    }

    // O protNFe traz o status da nota; o cStat do lote fora dele é status do
    // processamento do lote, não autorização.
    const prot = tag(texto, "protNFe");
    const cStatNota = prot ? tag(prot, "cStat") : null;
    const xMotivoNota = prot ? tag(prot, "xMotivo") : null;
    const protocolo = prot ? tag(prot, "nProt") : null;
    const chave = prot ? tag(prot, "chNFe") : null;

    if (cStatNota === "100" || cStatNota === "150") {
      if (!protocolo) {
        return {
          outcome: "error",
          message: "SEFAZ respondeu autorização sem número de protocolo",
          raw: texto.slice(0, 2000),
        };
      }
      return {
        outcome: "authorized",
        protocol: protocolo,
        accessKey: chave ?? undefined,
        xml: texto,
        raw: { cStat: cStatNota, xMotivo: xMotivoNota },
      };
    }

    if (cStatNota) {
      return {
        outcome: "rejected",
        code: cStatNota,
        message: xMotivoNota || `Documento rejeitado pela SEFAZ (cStat ${cStatNota})`,
        raw: { cStat: cStatNota, xMotivo: xMotivoNota },
      };
    }

    // Lote recebido sem protocolo: processamento assíncrono. O documento fica
    // pendente com o recibo, para consulta posterior — jamais autorizado.
    const cStatLote = tag(texto, "cStat");
    const recibo = tag(texto, "nRec");
    if (recibo) {
      return { outcome: "pending", receipt: recibo, raw: { cStat: cStatLote } };
    }

    return {
      outcome: "error",
      message: cStatLote
        ? `SEFAZ recusou o lote (cStat ${cStatLote}: ${tag(texto, "xMotivo") || "sem motivo"})`
        : "Resposta da SEFAZ sem protocolo e sem recibo",
      raw: texto.slice(0, 2000),
    };
  } catch (e) {
    return {
      outcome: "error",
      message: `Falha ao transmitir para a SEFAZ: ${(e as Error).message}`,
    };
  }
}

export type ConsultaSituacaoOutcome =
  | { outcome: "authorized"; protocol: string; xml?: string; raw?: unknown }
  | { outcome: "not_authorized"; code: string; reason: string; raw?: unknown }
  | { outcome: "error"; message: string; raw?: unknown };

/**
 * Consulta situação da NF-e/NFC-e (NFeConsultaProtocolo4, consSitNFe) —
 * reconcilia um documento preso em 'transmitting' (SEFAZ pode ter autorizado
 * mesmo que a gravação local tenha falhado depois). Sem assinatura XMLDSig:
 * a consulta usa só a conexão mTLS com o certificado da empresa, igual ao
 * endpoint de autorização (MOC 7.0 — Consulta Situação).
 *
 * cStat 100/150 = autorizada (com protocolo); 217 = não consta na base;
 * 101/151/155 = cancelada; qualquer outro cStat reconhecível também conta
 * como 'not_authorized' — quem decide o que fazer com isso é a chamadora,
 * este adaptador só relata o que a SEFAZ respondeu, nunca inventa autorização.
 */
export async function consultarSituacaoNfe(input: {
  accessKey: string;
  environment: "homologacao" | "producao";
  certPem: string;
  keyPem: string;
  endpoint: string;
  uf?: string | null;
}): Promise<ConsultaSituacaoOutcome> {
  let client: unknown;
  try {
    client = mtlsClient(input.certPem, input.keyPem);
  } catch (e) {
    return { outcome: "error", message: (e as Error).message };
  }

  const chave = input.accessKey.replace(/\D/g, "").padStart(44, "0");
  const tpAmb = input.environment === "producao" ? "1" : "2";
  const consulta =
    `<consSitNFe xmlns="${NFE_NS}" versao="4.00">` +
    `<tpAmb>${tpAmb}</tpAmb>` +
    `<xServ>CONSULTAR</xServ>` +
    `<chNFe>${chave}</chNFe>` +
    `</consSitNFe>`;

  try {
    const resposta = await fetch(input.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/soap+xml; charset=utf-8" },
      body: montarEnvelope(consulta, NFE_CONSULTA_PROTOCOLO_WSDL),
      // @ts-ignore client é a opção de mTLS do Deno
      client,
    });

    const texto = await resposta.text();

    if (!resposta.ok) {
      return {
        outcome: "error",
        message: `SEFAZ${input.uf ? `-${input.uf}` : ""} respondeu HTTP ${resposta.status} na consulta de situação`,
        raw: texto.slice(0, 2000),
      };
    }

    const prot = tag(texto, "protNFe");
    const cStat = prot ? tag(prot, "cStat") : tag(texto, "cStat");
    const xMotivo = prot ? tag(prot, "xMotivo") : tag(texto, "xMotivo");
    const nProt = prot ? tag(prot, "nProt") : null;

    if ((cStat === "100" || cStat === "150") && nProt) {
      // xml: o retConsSitNFe (traz o protNFe), para montar o XML autorizado da nota reconciliada.
      return { outcome: "authorized", protocol: nProt, xml: texto, raw: { cStat, xMotivo } };
    }

    if (cStat) {
      return {
        outcome: "not_authorized",
        code: cStat,
        reason: xMotivo || `SEFAZ respondeu cStat ${cStat} para esta chave`,
        raw: { cStat, xMotivo },
      };
    }

    return {
      outcome: "error",
      message: "Resposta da SEFAZ à consulta de situação sem cStat reconhecível",
      raw: texto.slice(0, 2000),
    };
  } catch (e) {
    return {
      outcome: "error",
      message: `Falha ao consultar a situação na SEFAZ: ${(e as Error).message}`,
    };
  }
}

export async function transmit(input: TransmitInput): Promise<TransmitOutcome> {
  try {
    if (input.model === "nfse") return await transmitNfse(input);
    return await transmitSefaz(input);
  } catch (e) {
    return { outcome: "error", message: (e as Error).message || "Falha na transmissão" };
  }
}

export type CancelamentoNfeOutcome =
  | { outcome: "registered"; protocol: string; raw?: unknown }
  | { outcome: "rejected"; code: string; message: string; raw?: unknown }
  | { outcome: "error"; message: string; raw?: unknown };

/**
 * Evento de cancelamento (tpEvento 110111) de NF-e/NFC-e — webservice
 * NFeRecepcaoEvento4 da SEFAZ da UF, SOAP 1.2 sobre mTLS, mesmo transporte de
 * transmitSefaz. Só volta 'registered' com cStat 135 ou 155 (Evento
 * registrado e vinculado à NF-e / Cancelamento homologado fora de prazo) e
 * nProt do evento — qualquer outra resposta é 'rejected' ou 'error', e o
 * documento em fiscal_documents continua 'authorized' (quem decide o status
 * é a chamadora, não este adaptador).
 *
 * Fonte: MOC 7.0 — Evento de Cancelamento; endereço confirmado em
 * nfephp-org/sped-nfe (wsnfe_4.00_mod55.xml/mod65.xml, campo
 * NFeRecepcaoEvento4), mesma fonte já usada para os demais endpoints de GO.
 */
export async function transmitCancelamentoNfe(input: {
  xmlAssinado: string;
  endpoint: string;
  certPem: string;
  keyPem: string;
  uf?: string | null;
}): Promise<CancelamentoNfeOutcome> {
  let client: unknown;
  try {
    client = mtlsClient(input.certPem, input.keyPem);
  } catch (e) {
    return { outcome: "error", message: (e as Error).message };
  }

  try {
    const corpo = input.xmlAssinado.replace(/^<\?xml[^>]*\?>/, "");
    const resposta = await fetch(input.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/soap+xml; charset=utf-8" },
      body: montarEnvelope(corpo, NFE_RECEPCAO_EVENTO_WSDL),
      // @ts-ignore client é a opção de mTLS do Deno
      client,
    });

    const texto = await resposta.text();

    if (!resposta.ok) {
      return {
        outcome: "error",
        message: `SEFAZ${input.uf ? `-${input.uf}` : ""} respondeu HTTP ${resposta.status} ao evento de cancelamento`,
        raw: texto.slice(0, 2000),
      };
    }

    const retEvento = tag(texto, "retEvento");
    const infEvento = retEvento ? tag(retEvento, "infEvento") : null;
    const cStat = infEvento ? tag(infEvento, "cStat") : null;
    const xMotivo = infEvento ? tag(infEvento, "xMotivo") : null;
    const nProt = infEvento ? tag(infEvento, "nProt") : null;

    if (cStat === "135" || cStat === "155") {
      if (!nProt) {
        return {
          outcome: "error",
          message: "SEFAZ registrou o evento sem devolver o protocolo do cancelamento",
          raw: texto.slice(0, 2000),
        };
      }
      return { outcome: "registered", protocol: nProt, raw: { cStat, xMotivo } };
    }

    if (cStat) {
      return {
        outcome: "rejected",
        code: cStat,
        message: xMotivo || `Evento de cancelamento rejeitado pela SEFAZ (cStat ${cStat})`,
        raw: { cStat, xMotivo },
      };
    }

    return {
      outcome: "error",
      message: "Resposta da SEFAZ ao evento de cancelamento sem cStat reconhecível",
      raw: texto.slice(0, 2000),
    };
  } catch (e) {
    return {
      outcome: "error",
      message: `Falha ao transmitir o cancelamento para a SEFAZ: ${(e as Error).message}`,
    };
  }
}

type CredenciaisNfse = {
  environment: "homologacao" | "producao";
  certPem: string;
  keyPem: string;
};

export type ConsultaOutcome =
  | { outcome: "found"; accessKey: string; xmlGzipBase64?: string; raw?: unknown }
  | { outcome: "not_found"; message: string; raw?: unknown }
  | { outcome: "error"; message: string; raw?: unknown };

/**
 * GET /nfse/{chaveAcesso} — consulta a nota pela chave de acesso.
 *
 * Serve para reconciliar documento que ficou 'pending' ou 'error' por queda de
 * conexão depois do envio: a nota pode ter sido gerada do lado de lá, e sem
 * consultar a loja emitiria duplicado.
 */
export async function consultarNfse(
  chaveAcesso: string,
  cred: CredenciaisNfse,
): Promise<ConsultaOutcome> {
  let client: unknown;
  try {
    client = mtlsClient(cred.certPem, cred.keyPem);
  } catch (e) {
    return { outcome: "error", message: (e as Error).message };
  }

  try {
    const resposta = await fetch(
      `${NFSE_ENDPOINTS[cred.environment]}/nfse/${encodeURIComponent(chaveAcesso)}`,
      // @ts-ignore client é a opção de mTLS do Deno
      { method: "GET", client },
    );
    const corpo = await lerJson(resposta);

    if (resposta.ok) {
      const chave = String(corpo.chaveAcesso ?? chaveAcesso);
      return {
        outcome: "found",
        accessKey: chave,
        xmlGzipBase64: (corpo.nfseXmlGZipB64 as string) ?? undefined,
        raw: corpo,
      };
    }
    if (resposta.status === 404) {
      return { outcome: "not_found", message: "NFS-e não encontrada para esta chave", raw: corpo };
    }
    const mensagens = coletarMensagens(corpo);
    return {
      outcome: "error",
      message: mensagens.length
        ? descreverMensagens(mensagens)
        : `Sefin Nacional respondeu HTTP ${resposta.status}`,
      raw: corpo,
    };
  } catch (e) {
    return { outcome: "error", message: `Falha ao consultar a NFS-e: ${(e as Error).message}` };
  }
}

export type EventoOutcome =
  | { outcome: "registered"; xmlGzipBase64?: string; raw?: unknown }
  | { outcome: "rejected"; code: string; message: string; raw?: unknown }
  | { outcome: "error"; message: string; raw?: unknown };

/**
 * POST /nfse/{chaveAcesso}/eventos — registro de evento, incluindo o
 * cancelamento (e101101). O pedido vai assinado e compactado, igual à DPS.
 *
 * Só volta 'registered' com resposta do autorizador. Cancelamento local, sem
 * registro, não cancela nota nenhuma perante o fisco.
 */
export async function registrarEventoNfse(
  chaveAcesso: string,
  pedidoXmlGzipBase64: string,
  cred: CredenciaisNfse,
): Promise<EventoOutcome> {
  let client: unknown;
  try {
    client = mtlsClient(cred.certPem, cred.keyPem);
  } catch (e) {
    return { outcome: "error", message: (e as Error).message };
  }

  try {
    const resposta = await fetch(
      `${NFSE_ENDPOINTS[cred.environment]}/nfse/${encodeURIComponent(chaveAcesso)}/eventos`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pedidoRegistroEventoXmlGZipB64: pedidoXmlGzipBase64 }),
        // @ts-ignore client é a opção de mTLS do Deno
        client,
      },
    );
    const corpo = await lerJson(resposta);

    if (resposta.ok) {
      return {
        outcome: "registered",
        xmlGzipBase64: (corpo.eventoXmlGZipB64 as string) ?? undefined,
        raw: corpo,
      };
    }

    const mensagens = coletarMensagens(corpo);
    if (resposta.status === 400 && mensagens.length) {
      return {
        outcome: "rejected",
        code: mensagens[0].codigo || "400",
        message: descreverMensagens(mensagens),
        raw: corpo,
      };
    }
    return {
      outcome: "error",
      message: mensagens.length
        ? descreverMensagens(mensagens)
        : `Sefin Nacional respondeu HTTP ${resposta.status}`,
      raw: corpo,
    };
  } catch (e) {
    return { outcome: "error", message: `Falha ao registrar o evento: ${(e as Error).message}` };
  }
}

async function lerJson(resposta: Response): Promise<Record<string, unknown>> {
  const texto = await resposta.text();
  try {
    return JSON.parse(texto);
  } catch {
    return { raw: texto };
  }
}

/**
 * Sondagem do autorizador para o diagnóstico.
 *
 * O Sefin Nacional exige autenticação mútua: conectar sem certificado derruba o
 * handshake. Um "fetch failed" sem certificado, portanto, não prova que o
 * serviço caiu — e mostrar vermelho nesse caso seria alarme falso. Por isso a
 * sondagem só vale como verificação de disponibilidade quando há certificado.
 */
export async function sondarNfse(
  environment: "homologacao" | "producao",
  cred?: { certPem: string; keyPem: string } | null,
): Promise<{ status: "configurado" | "pendente" | "erro"; detail: string }> {
  const base = NFSE_ENDPOINTS[environment];

  if (!cred?.certPem || !cred?.keyPem) {
    return {
      status: "pendente",
      detail:
        `${base} exige autenticação mútua por certificado. Sem certificado cadastrado ` +
        "não é possível verificar a disponibilidade do autorizador.",
    };
  }

  let client: unknown;
  try {
    client = mtlsClient(cred.certPem, cred.keyPem);
  } catch (e) {
    return { status: "erro", detail: (e as Error).message };
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    // Chave inexistente de propósito: o que interessa é o handshake mTLS ter
    // funcionado e o serviço ter respondido, não o conteúdo.
    const resposta = await fetch(`${base}/nfse/00000000000000000000000000000000000000000000000000`, {
      method: "GET",
      signal: controller.signal,
      // @ts-ignore client é a opção de mTLS do Deno
      client,
    });
    clearTimeout(timeout);
    return {
      status: "configurado",
      detail: `${base} respondeu HTTP ${resposta.status} com o certificado da empresa`,
    };
  } catch (e) {
    return {
      status: "erro",
      detail: `Não foi possível estabelecer conexão autenticada com ${base}: ${(e as Error).message}`,
    };
  }
}
