// Verificação INDEPENDENTE da assinatura XMLDSig (signature.ts).
//
// Quem confere aqui é o xml-crypto (com @xmldom/xmldom), não o signXml: ele
// canoniza o XML pelo C14N 1.0 da especificação, recalcula o digest e verifica o
// RSA com a chave pública do certificado — o que a SEFAZ faz. O teste anterior
// reaproveitava o texto cru assinado pelo próprio signXml e por isso não pegou o
// cStat 202 (SignedInfo assinado com <X/> em vez de <X></X>).
//
// Cobre todos os usos do signXml: infNFe (NFC-e/NF-e, SHA-1), infDPS e infPedReg
// (NFS-e, SHA-256) e infEvento (eventos de NF-e/NFC-e, SHA-1).
//
// Uso: deno test --no-check --allow-net --allow-read supabase/functions/_shared/fiscal/signature.test.ts
import { assert, assertEquals, assertNotEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import forge from "https://esm.sh/node-forge@1.3.1";
import { C14nCanonicalization, SignedXml } from "npm:xml-crypto@6";
import { DOMParser } from "npm:@xmldom/xmldom@0.8.10";
import { createHash, createSign } from "node:crypto";
import { signXml } from "./signature.ts";
import { buildNfceXml } from "./documents.ts";
import { applyTaxRules, type TaxRule } from "./taxEngine.ts";

type Cert = Parameters<typeof signXml>[1];
const DSIG = "http://www.w3.org/2000/09/xmldsig#";

const certificadoDeTeste = () => {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = "01";
  cert.validity.notBefore = new Date(Date.now() - 86_400_000);
  cert.validity.notAfter = new Date(Date.now() + 86_400_000);
  const attrs = [{ name: "commonName", value: "TESTE:52481599000126" }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  return {
    certPem: forge.pki.certificateToPem(cert),
    keyPem: forge.pki.privateKeyToPem(keys.privateKey),
    subject: "CN=TESTE", issuer: "CN=TESTE", validFrom: cert.validity.notBefore, validTo: cert.validity.notAfter, cnpj: "52481599000126",
  } as Cert;
};

const certificado = certificadoDeTeste();

const settings = {
  company_id: "c1", cnpj: "52481599000126", legal_name: "EMPRESA TESTE LTDA", trade_name: "TESTE", ie: "200843354",
  uf: "GO", city_name: "Anapolis", city_ibge_code: "5201108", crt: "1", tax_regime: "simples",
  address: "Rua Teste", address_number: "10", neighborhood: "Centro", cep: "75050210",
};
const regra: TaxRule = {
  id: "r1", company_id: "c1", priority: 0, match: {}, valid_from: "2026-01-01", valid_to: null, active: true,
  taxes: { icms: { csosn: "102" }, pis: { cst: "01", aliquota: 0 }, cofins: { cst: "01", aliquota: 0 } },
};
const documentoFiscal = (model: "55" | "65") => {
  const taxed = applyTaxRules(
    [regra],
    [{ product_id: "p1", name: "Produto", quantity: 1, unit: "UN", price: 1, total: 1, ncm: "22021000", cfop: "5102", origin: "0" }],
    { model, uf: "GO", crt: "1", tax_regime: "simples", issued_at: new Date() },
  );
  return buildNfceXml({
    settings, items: taxed.items, totals: taxed.totals, recipient: null, series: 1, number: 1,
    environment: "homologacao", model, paymentMethod: "credito",
  });
};

const casos: { nome: string; xml: string; tag: Parameters<typeof signXml>[2]; digest: "sha1" | "sha256" }[] = [
  { nome: "NFC-e (modelo 65)", xml: documentoFiscal("65"), tag: "infNFe", digest: "sha1" },
  { nome: "NF-e (modelo 55)", xml: documentoFiscal("55"), tag: "infNFe", digest: "sha1" },
  {
    nome: "NFS-e (DPS)",
    xml: `<DPS xmlns="http://www.sped.fazenda.gov.br/nfse" versao="1.00"><infDPS Id="DPS5201108252481599000126000010000000000000001"><tpAmb>2</tpAmb><serie>00001</serie></infDPS></DPS>`,
    tag: "infDPS", digest: "sha256",
  },
  {
    nome: "NFS-e (pedido de registro de evento)",
    xml: `<pedRegEvento xmlns="http://www.sped.fazenda.gov.br/nfse" versao="1.00"><infPedReg Id="PRE1"><tpAmb>2</tpAmb></infPedReg></pedRegEvento>`,
    tag: "infPedReg", digest: "sha256",
  },
  {
    nome: "evento de NF-e/NFC-e",
    xml: `<evento xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.00"><infEvento Id="ID1101115226105248159900012665001000000002134042439301"><tpEvento>110111</tpEvento></infEvento></evento>`,
    tag: "infEvento", digest: "sha1",
  },
];

const parse = (xml: string) => new DOMParser().parseFromString(xml, "text/xml");
const filho = (doc: ReturnType<typeof parse>, nome: string) => doc.getElementsByTagNameNS("*", nome)[0];
const c14n = new C14nCanonicalization();

for (const caso of casos) {
  Deno.test(`assinatura independente (xml-crypto): ${caso.nome}`, async () => {
    const assinado = await signXml(caso.xml, certificado, caso.tag);
    const doc = parse(assinado);
    const assinatura = filho(doc, "Signature");

    // 1) SignatureValue valida com o verificador independente (digest + RSA).
    const sx = new SignedXml({ publicCert: certificado.certPem });
    sx.loadSignature(assinatura);
    assert(sx.checkSignature(assinado), `xml-crypto recusou: ${sx.getSignedReferences?.().length ?? ""} ${sx.validationErrors?.join(" | ")}`);

    // 2) O SignedInfo assinado é byte a byte o resultado da C14N dele no documento.
    const signedInfoCru = assinado.match(/<SignedInfo\b[\s\S]*?<\/SignedInfo>/)![0];
    const signedInfoC14n = c14n.process(filho(doc, "SignedInfo"), { ancestorNamespaces: [{ prefix: "", namespaceURI: DSIG }] });
    assertEquals(signedInfoCru, signedInfoC14n);
    assert(!/\/>/.test(signedInfoCru), "SignedInfo não pode ter elemento vazio auto-fechado");

    // 3) DigestValue confere com o digest da C14N do elemento assinado, calculado fora do signXml.
    const alvo = filho(doc, caso.tag);
    const digestEsperado = createHash(caso.digest).update(c14n.process(alvo, {}), "utf8").digest("base64");
    assertEquals(filho(doc, "DigestValue").textContent, digestEsperado);

    // 4) Adulterar o documento depois de assinar invalida (o verificador não aceita qualquer coisa).
    const adulterado = assinado.replace(new RegExp(`(<${caso.tag}\\b[^>]*>)`), "$1<adulterado>1</adulterado>");
    assertNotEquals(adulterado, assinado);
    const sx2 = new SignedXml({ publicCert: certificado.certPem });
    sx2.loadSignature(filho(parse(adulterado), "Signature"));
    let valido = true;
    try {
      valido = sx2.checkSignature(adulterado);
    } catch {
      valido = false;
    }
    assertEquals(valido, false);
  });
}

Deno.test("assinar o SignedInfo com <X/> (texto antigo) é recusado pelo verificador — regressão do cStat 202", async () => {
  const assinado = await signXml(casos[0].xml, certificado, "infNFe");
  const novo = assinado.match(/<SignedInfo\b[\s\S]*?<\/SignedInfo>/)![0];
  // Mesmos elementos do texto antigo, auto-fechados, assinados com a mesma chave.
  const antigo = novo.replace(/<(CanonicalizationMethod|SignatureMethod|Transform|DigestMethod)( [^>]*)><\/\1>/g, "<$1$2/>");
  assertNotEquals(antigo, novo);
  const valorAntigo = createSign("RSA-SHA1").update(antigo, "utf8").sign(certificado.keyPem, "base64");
  const valorNovo = assinado.match(/<SignatureValue>([^<]+)<\/SignatureValue>/)![1];
  const comTextoAntigo = assinado.replace(valorNovo, valorAntigo);
  assertNotEquals(comTextoAntigo, assinado);

  const sx = new SignedXml({ publicCert: certificado.certPem });
  sx.loadSignature(filho(parse(comTextoAntigo), "Signature"));
  let valido = true;
  try {
    valido = sx.checkSignature(comTextoAntigo);
  } catch {
    valido = false;
  }
  assertEquals(valido, false, "RSA sobre o SignedInfo auto-fechado não bate com o C14N que a SEFAZ calcula");
});
