// XML autorizado completo da NFC-e (nfeProc): <NFe> enviado + <protNFe> devolvido pela SEFAZ.
//
// É o arquivo que o cliente e o contador guardam. A SEFAZ responde ao envio com um SOAP
// (retEnviNFe) que traz só o protNFe; o <NFe> é o xml_signed que nós mesmos enviamos. O
// nfeProc junta os dois, sem reescrever nada: o <NFe> entra byte a byte como foi assinado,
// senão o digest da assinatura deixaria de bater.
//
// Função pura (sem rede nem banco). Em vez de lançar erro, devolve o motivo: quem chama
// (fiscal-emit) nunca pode perder uma autorização já obtida por causa da montagem do XML.

export type NfeProcResult = { ok: true; xml: string } | { ok: false; motivo: string };

const NS_NFE = "http://www.portalfiscal.inf.br/nfe";

const tag = (xml: string, nome: string): string | null => {
  const m = xml.match(new RegExp(`<${nome}(?:\\s[^>]*)?>([^<]*)</${nome}>`));
  return m ? m[1].trim() : null;
};

const contar = (xml: string, re: RegExp) => (xml.match(re) || []).length;

/** Monta o nfeProc 4.00. Só devolve ok com cStat 100, chave e digVal conferindo com a NFe enviada. */
export const buildNfeProc = (xmlAssinado: string | null | undefined, respostaSefaz: string | null | undefined): NfeProcResult => {
  if (!xmlAssinado) return { ok: false, motivo: "XML assinado ausente" };
  if (!respostaSefaz) return { ok: false, motivo: "resposta da SEFAZ ausente" };

  // <NFe> exatamente como foi enviado (inclui infNFeSupl e Signature).
  if (contar(xmlAssinado, /<NFe[\s>]/g) !== 1) return { ok: false, motivo: "o XML assinado não tem exatamente um <NFe>" };
  const nfe = xmlAssinado.match(/<NFe[\s>][\s\S]*<\/NFe>/)?.[0];
  if (!nfe) return { ok: false, motivo: "<NFe> não encontrado no XML assinado" };
  if (!nfe.includes("<Signature")) return { ok: false, motivo: "<NFe> sem assinatura" };

  const chave = nfe.match(/<infNFe\b[^>]*\sId="NFe(\d{44})"/)?.[1];
  if (!chave) return { ok: false, motivo: "chave de acesso não encontrada no <infNFe>" };
  const digestNfe = nfe.match(/<DigestValue>([^<]+)<\/DigestValue>/)?.[1]?.trim();
  if (!digestNfe) return { ok: false, motivo: "DigestValue não encontrado na assinatura da NFe" };

  // <protNFe> da resposta. Lote com uma NFe só: tem de haver exatamente um.
  if (contar(respostaSefaz, /<protNFe[\s>]/g) !== 1) return { ok: false, motivo: "a resposta não tem exatamente um <protNFe>" };
  const prot = respostaSefaz.match(/<protNFe[\s>][\s\S]*?<\/protNFe>/)?.[0];
  if (!prot) return { ok: false, motivo: "<protNFe> não encontrado na resposta" };

  // O protNFe é copiado sem a declaração de namespace do pai (retEnviNFe). Com prefixo
  // (ex.: ns0:Signature) a cópia ficaria inválida, então não monta.
  if (/<\/?[A-Za-z_][\w.-]*:[\w.-]+/.test(prot) || /\sxmlns:/.test(prot)) {
    return { ok: false, motivo: "o <protNFe> usa prefixo de namespace" };
  }
  if (!/\sxmlns="/.test(prot) && !respostaSefaz.includes(`xmlns="${NS_NFE}"`)) {
    return { ok: false, motivo: "o <protNFe> não herda o namespace da NF-e" };
  }

  const infProt = prot.match(/<infProt[\s>][\s\S]*?<\/infProt>/)?.[0];
  if (!infProt) return { ok: false, motivo: "<infProt> não encontrado no <protNFe>" };

  const cStat = tag(infProt, "cStat");
  if (cStat !== "100") return { ok: false, motivo: `cStat do protocolo é ${cStat ?? "ausente"}, não 100` };
  if (!tag(infProt, "nProt")) return { ok: false, motivo: "protocolo (nProt) ausente" };
  if (tag(infProt, "chNFe") !== chave) return { ok: false, motivo: "chNFe do protocolo difere da chave da NFe enviada" };
  if (tag(infProt, "digVal") !== digestNfe) return { ok: false, motivo: "digVal do protocolo difere do DigestValue da NFe enviada" };

  return {
    ok: true,
    xml: `<?xml version="1.0" encoding="UTF-8"?><nfeProc versao="4.00" xmlns="${NS_NFE}">${nfe}${prot}</nfeProc>`,
  };
};

/**
 * XML a gravar em xml_authorized quando a SEFAZ autoriza no envio. NFC-e: nfeProc completo; se não
 * montar (ou outro modelo), cai na resposta da SEFAZ como antes. Nunca lança: a autorização já
 * obtida não pode se perder por causa do XML. `aviso` traz o motivo da queda, para quem chama logar.
 */
export const xmlAutorizadoDaTransmissao = (
  model: string,
  xmlAssinado: string | null | undefined,
  respostaSefaz: string | null | undefined,
): { xml: string | null; aviso: string | null } => {
  const resposta = respostaSefaz ?? null;
  if (model !== "65") return { xml: resposta, aviso: null };
  try {
    const proc = buildNfeProc(xmlAssinado, resposta);
    return proc.ok ? { xml: proc.xml, aviso: null } : { xml: resposta, aviso: proc.motivo };
  } catch (e) {
    return { xml: resposta, aviso: String(e) };
  }
};
