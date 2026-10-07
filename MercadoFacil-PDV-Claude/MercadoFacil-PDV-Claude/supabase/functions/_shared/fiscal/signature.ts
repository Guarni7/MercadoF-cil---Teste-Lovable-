// Assinatura XMLDSig dos documentos fiscais.
//
// NF-e, NFC-e e DPS usam assinatura enveloped sobre o elemento identificado
// (infNFe ou infDPS), com os algoritmos fixados pelos manuais:
//   canonicalização  http://www.w3.org/TR/2001/REC-xml-c14n-20010315
//   assinatura       RSA-SHA1 (NF-e/NFC-e 4.00) ou RSA-SHA256 (NFS-e Nacional)
//   transformações   enveloped-signature + C14N
//
// A canonicalização aqui cobre o subconjunto que nós mesmos geramos: XML sem
// prefixo de namespace, sem comentários, sem instrução de processamento e sem
// atributos fora de ordem. Isso é suficiente porque o documento assinado é o
// que sai de documents.ts, e não um XML arbitrário de terceiro — mas é por isso
// que a função recusa entrada que fuja desse formato, em vez de assinar errado.

import forge from "https://esm.sh/node-forge@1.3.1";
import type { ParsedCertificate } from "./certificate.ts";

const extractElement = (xml: string, tag: string) => {
  const abertura = new RegExp(`<${tag}\\b[^>]*>`);
  const match = xml.match(abertura);
  if (!match || match.index === undefined) {
    throw new Error(`Elemento <${tag}> não encontrado para assinatura`);
  }
  const fim = xml.indexOf(`</${tag}>`);
  if (fim === -1) throw new Error(`Elemento <${tag}> sem fechamento`);
  return xml.slice(match.index, fim + `</${tag}>`.length);
};

const extractId = (elemento: string) => {
  const match = elemento.match(/\bId="([^"]+)"/);
  if (!match) throw new Error("Elemento a assinar não possui atributo Id");
  return match[1];
};

// C14N do subconjunto que geramos: sem comentários, sem PI, tags já em ordem.
// O namespace herdado do elemento raiz precisa ser materializado no elemento
// assinado, senão o digest não confere do outro lado.
const canonicalize = (elemento: string, namespace: string | null) => {
  if (/<!--|<\?/.test(elemento)) {
    throw new Error("XML com comentário ou instrução de processamento não é aceito para assinatura");
  }

  const limpo = elemento.replace(/>\s+</g, "><").trim();

  if (!namespace) return limpo;
  if (/\bxmlns=/.test(limpo.slice(0, limpo.indexOf(">")))) return limpo;

  // C14N: declaração de namespace vem antes dos atributos (Id, versao).
  const nome = limpo.match(/^<[\w:.-]+/)![0];
  return `${nome} xmlns="${namespace}"${limpo.slice(nome.length)}`;
};

const rootNamespace = (xml: string) => xml.match(/<\w+[^>]*\sxmlns="([^"]+)"/)?.[1] ?? null;

type Algoritmo = { digest: "sha1" | "sha256"; digestUri: string; signatureUri: string };

const ALGORITMOS: Record<string, Algoritmo> = {
  // NF-e/NFC-e 4.00 — Manual de Orientação do Contribuinte.
  infNFe: {
    digest: "sha1",
    digestUri: "http://www.w3.org/2000/09/xmldsig#sha1",
    signatureUri: "http://www.w3.org/2000/09/xmldsig#rsa-sha1",
  },
  // Evento de NF-e/NFC-e (cancelamento e demais eventos) — mesmos algoritmos
  // do infNFe, MOC 7.0.
  infEvento: {
    digest: "sha1",
    digestUri: "http://www.w3.org/2000/09/xmldsig#sha1",
    signatureUri: "http://www.w3.org/2000/09/xmldsig#rsa-sha1",
  },
  // NFS-e Nacional — leiaute DPS v1.01.
  infDPS: {
    digest: "sha256",
    digestUri: "http://www.w3.org/2001/04/xmlenc#sha256",
    signatureUri: "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256",
  },
  // Pedido de registro de evento da NFS-e (cancelamento e demais eventos):
  // mesmos algoritmos da DPS, assinando o infPedReg.
  infPedReg: {
    digest: "sha256",
    digestUri: "http://www.w3.org/2001/04/xmlenc#sha256",
    signatureUri: "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256",
  },
};

export const signXml = async (
  xml: string,
  certificate: ParsedCertificate,
  tag: "infNFe" | "infDPS" | "infPedReg" | "infEvento",
): Promise<string> => {
  const algoritmo = ALGORITMOS[tag];
  if (!algoritmo) throw new Error(`Algoritmo de assinatura não definido para <${tag}>`);

  const elemento = extractElement(xml, tag);
  const id = extractId(elemento);
  const ns = rootNamespace(xml);
  const canonico = canonicalize(elemento, ns);

  const md = algoritmo.digest === "sha1" ? forge.md.sha1.create() : forge.md.sha256.create();
  md.update(canonico, "utf8");
  const digestValue = forge.util.encode64(md.digest().getBytes());

  // O SignedInfo é assinado exatamente como está escrito aqui, então já tem de estar
  // em C14N: elemento vazio sai como <X ...></X>, nunca <X .../>, e o xmlns do
  // SignedInfo vem declarado (a SEFAZ o canoniza dentro de <Signature xmlns=...>).
  // Com <X/> o RSA não bate com o que o autorizador recalcula (cStat 202).
  const signedInfo =
    `<SignedInfo xmlns="http://www.w3.org/2000/09/xmldsig#">` +
    `<CanonicalizationMethod Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"></CanonicalizationMethod>` +
    `<SignatureMethod Algorithm="${algoritmo.signatureUri}"></SignatureMethod>` +
    `<Reference URI="#${id}">` +
    `<Transforms>` +
    `<Transform Algorithm="http://www.w3.org/2000/09/xmldsig#enveloped-signature"></Transform>` +
    `<Transform Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"></Transform>` +
    `</Transforms>` +
    `<DigestMethod Algorithm="${algoritmo.digestUri}"></DigestMethod>` +
    `<DigestValue>${digestValue}</DigestValue>` +
    `</Reference>` +
    `</SignedInfo>`;

  const mdSigned = algoritmo.digest === "sha1" ? forge.md.sha1.create() : forge.md.sha256.create();
  mdSigned.update(signedInfo, "utf8");

  const privateKey = forge.pki.privateKeyFromPem(certificate.keyPem);
  const signatureValue = forge.util.encode64(privateKey.sign(mdSigned));

  const certBase64 = certificate.certPem
    .replace(/-----(BEGIN|END) CERTIFICATE-----/g, "")
    .replace(/\s+/g, "");

  const signature =
    `<Signature xmlns="http://www.w3.org/2000/09/xmldsig#">` +
    signedInfo +
    `<SignatureValue>${signatureValue}</SignatureValue>` +
    `<KeyInfo><X509Data><X509Certificate>${certBase64}</X509Certificate></X509Data></KeyInfo>` +
    `</Signature>`;

  // A assinatura é irmã do elemento assinado, logo depois do fechamento dele.
  const fechamento = `</${tag}>`;
  const posicao = xml.indexOf(fechamento) + fechamento.length;
  return xml.slice(0, posicao) + signature + xml.slice(posicao);
};
