// Testes do nfeProc (XML autorizado completo da NFC-e).
//
// O que tem de valer: o <NFe> entra byte a byte como foi assinado, o protNFe é o da SEFAZ,
// a assinatura continua válida DENTRO do nfeProc (verificada pelo xml-crypto, não pelo
// signXml), e nada é montado sem cStat 100, chave e digVal conferindo.
//
// Uso: deno test --no-check --node-modules-dir=none --allow-net --allow-read --allow-env supabase/functions/_shared/fiscal/nfeProc.test.ts
import { assert, assertEquals, assertMatch, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import forge from "https://esm.sh/node-forge@1.3.1";
import { C14nCanonicalization, SignedXml } from "npm:xml-crypto@6";
import { DOMParser } from "npm:@xmldom/xmldom@0.8.10";
import { createHash } from "node:crypto";
import { buildNfceXml } from "./documents.ts";
import { applyTaxRules, type TaxRule } from "./taxEngine.ts";
import { signXml } from "./signature.ts";
import { buildNfceQrCode, insertInfNFeSupl } from "./qrcode.ts";
import { buildNfeProc } from "./nfeProc.ts";

type Cert = Parameters<typeof signXml>[1];

const keys = forge.pki.rsa.generateKeyPair(2048);
const cert = forge.pki.createCertificate();
cert.publicKey = keys.publicKey;
cert.serialNumber = "01";
cert.validity.notBefore = new Date(Date.now() - 86_400_000);
cert.validity.notAfter = new Date(Date.now() + 86_400_000);
cert.setSubject([{ name: "commonName", value: "TESTE:52481599000126" }]);
cert.setIssuer([{ name: "commonName", value: "TESTE:52481599000126" }]);
cert.sign(keys.privateKey, forge.md.sha256.create());
const certificado = {
  certPem: forge.pki.certificateToPem(cert), keyPem: forge.pki.privateKeyToPem(keys.privateKey),
  subject: "CN=TESTE", issuer: "CN=TESTE", validFrom: cert.validity.notBefore, validTo: cert.validity.notAfter, cnpj: "52481599000126",
} as Cert;

const settings = {
  company_id: "c1", cnpj: "52481599000126", legal_name: "EMPRESA TESTE LTDA", trade_name: "TESTE", ie: "200843354",
  uf: "GO", city_name: "Anapolis", city_ibge_code: "5201108", crt: "1", tax_regime: "simples",
  address: "Rua Teste", address_number: "10", neighborhood: "Centro", cep: "75050210",
};
const regra: TaxRule = {
  id: "r1", company_id: "c1", priority: 0, match: {}, valid_from: "2026-01-01", valid_to: null, active: true,
  taxes: { icms: { csosn: "102" }, pis: { cst: "01", aliquota: 0 }, cofins: { cst: "01", aliquota: 0 } },
};

// NFC-e assinada e com QR Code, como o fiscal-emit a envia (xmlAssinado).
const taxed = applyTaxRules(
  [regra],
  [{ product_id: "p1", name: "Produto", quantity: 1, unit: "UN", price: 1, total: 1, ncm: "22021000", cfop: "5102", origin: "0" }],
  { model: "65", uf: "GO", crt: "1", tax_regime: "simples", issued_at: new Date() },
);
const xmlNfce = buildNfceXml({
  settings, items: taxed.items, totals: taxed.totals, recipient: null, series: 1, number: 4,
  environment: "homologacao", model: "65", paymentMethod: "credito", payments: [{ method: "credito", channel: "maquininha" }],
});
let xmlAssinado = await signXml(xmlNfce, certificado, "infNFe");
const chave = xmlAssinado.match(/Id="NFe(\d{44})"/)![1];
xmlAssinado = insertInfNFeSupl(
  xmlAssinado,
  await buildNfceQrCode({
    accessKey: chave, environment: "homologacao", idCsc: "1", csc: "AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE",
    baseUrl: "https://nfewebhomolog.sefaz.go.gov.br/nfeweb/sites/nfce/danfeNFCe",
  }),
);
const digest = xmlAssinado.match(/<DigestValue>([^<]+)<\/DigestValue>/)![1];
const semDeclaracao = xmlAssinado.replace(/^<\?xml[^>]*\?>/, "");

// Resposta no formato real da SEFAZ-GO (retEnviNFe dentro do envelope SOAP).
const soap = (o: { cStat?: string; chave?: string; digVal?: string; nProt?: string; extra?: string } = {}) =>
  `<?xml version='1.0' encoding='UTF-8'?><env:Envelope xmlns:env="http://www.w3.org/2003/05/soap-envelope"><env:Header/><env:Body>` +
  `<nfeResultMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeAutorizacao4"><retEnviNFe versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe" xmlns:ns0="http://www.w3.org/2000/09/xmldsig#">` +
  `<tpAmb>2</tpAmb><verAplic>GO4.0</verAplic><cStat>104</cStat><xMotivo>Lote processado</xMotivo><cUF>52</cUF><dhRecbto>2026-10-04T11:57:26-03:00</dhRecbto>` +
  `<protNFe versao="4.00"><infProt><tpAmb>2</tpAmb><verAplic>GO4.0</verAplic><chNFe>${o.chave ?? chave}</chNFe><dhRecbto>2026-10-04T11:57:27-03:00</dhRecbto>` +
  `<nProt>${o.nProt ?? "152260027753952"}</nProt><digVal>${o.digVal ?? digest}</digVal><cStat>${o.cStat ?? "100"}</cStat><xMotivo>Autorizado o uso da NF-e</xMotivo></infProt>${o.extra ?? ""}</protNFe>` +
  `</retEnviNFe></nfeResultMsg></env:Body></env:Envelope>`;

// NodeList do xmldom não é iterável.
const filhos = (el: Element) => Array.from({ length: el.childNodes.length }, (_, i) => el.childNodes[i] as Element);

const ok = () => {
  const r = buildNfeProc(xmlAssinado, soap());
  assert(r.ok, r.ok ? "" : r.motivo);
  return r.xml;
};
const recusa = (r: ReturnType<typeof buildNfeProc>, trecho: string) => {
  assert(!r.ok, "devia recusar");
  assertStringIncludes(r.motivo, trecho);
};

Deno.test("nfeProc: raiz 4.00 com NFe e depois protNFe, declaração XML e namespace da NF-e", () => {
  const xml = ok();
  assertMatch(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?><nfeProc versao="4\.00" xmlns="http:\/\/www\.portalfiscal\.inf\.br\/nfe"><NFe[\s>]/);
  assert(xml.endsWith("</protNFe></nfeProc>"));
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  const raiz = doc.documentElement;
  assertEquals(raiz.localName, "nfeProc");
  assertEquals(filhos(raiz).map((n) => n.localName), ["NFe", "protNFe"]);
  const nfe = raiz.childNodes[0] as Element;
  assertEquals(filhos(nfe).map((n) => n.localName), ["infNFe", "infNFeSupl", "Signature"]);
  assertEquals((raiz.childNodes[1] as Element).getElementsByTagName("nProt")[0].textContent, "152260027753952");
});

Deno.test("nfeProc: o <NFe> é byte a byte o xml_signed, e o protNFe é o da SEFAZ", () => {
  const xml = ok();
  assert(xml.includes(semDeclaracao), "NFe alterado");
  assertEquals(xml.indexOf(semDeclaracao), xml.indexOf("<NFe"));
  const protSefaz = soap().match(/<protNFe[\s>][\s\S]*?<\/protNFe>/)![0];
  assert(xml.includes(protSefaz), "protNFe alterado");
  assertEquals(xml, `<?xml version="1.0" encoding="UTF-8"?><nfeProc versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe">${semDeclaracao}${protSefaz}</nfeProc>`);
});

Deno.test("nfeProc: assinatura continua válida dentro do nfeProc (xml-crypto) e digVal bate com o digest recalculado", () => {
  const xml = ok();
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  const sx = new SignedXml({ publicCert: certificado.certPem });
  sx.loadSignature(doc.getElementsByTagNameNS("http://www.w3.org/2000/09/xmldsig#", "Signature")[0]);
  assert(sx.checkSignature(xml), `xml-crypto recusou: ${sx.validationErrors?.join(" | ")}`);

  const infNFe = doc.getElementsByTagNameNS("*", "infNFe")[0];
  const recalculado = createHash("sha1").update(new C14nCanonicalization().process(infNFe, {}), "utf8").digest("base64");
  assertEquals(doc.getElementsByTagNameNS("*", "digVal")[0].textContent, recalculado);
});

Deno.test("nfeProc: só monta com cStat 100", () => {
  for (const cStat of ["150", "204", "110", "301", ""]) {
    recusa(buildNfeProc(xmlAssinado, soap({ cStat })), "não 100");
  }
});

Deno.test("nfeProc: chave do protocolo diferente da NFe enviada é recusada", () => {
  recusa(buildNfeProc(xmlAssinado, soap({ chave: "5".repeat(44) })), "chNFe");
});

Deno.test("nfeProc: digVal diferente do DigestValue da NFe enviada é recusado", () => {
  recusa(buildNfeProc(xmlAssinado, soap({ digVal: "AAAAAAAAAAAAAAAAAAAAAAAAAAA=" })), "digVal");
});

Deno.test("nfeProc: sem protocolo (nProt) ou sem protNFe é recusado", () => {
  recusa(buildNfeProc(xmlAssinado, soap({ nProt: "" })), "nProt");
  recusa(buildNfeProc(xmlAssinado, soap().replace(/<protNFe[\s\S]*<\/protNFe>/, "")), "protNFe");
  recusa(buildNfeProc(xmlAssinado, "<retEnviNFe><cStat>225</cStat></retEnviNFe>"), "protNFe");
});

Deno.test("nfeProc: dois protNFe (lote com mais de uma nota) é recusado", () => {
  const prot = soap().match(/<protNFe[\s>][\s\S]*?<\/protNFe>/)![0];
  recusa(buildNfeProc(xmlAssinado, soap().replace(prot, prot + prot)), "exatamente um <protNFe>");
});

Deno.test("nfeProc: protNFe com prefixo de namespace é recusado (cópia ficaria inválida)", () => {
  recusa(buildNfeProc(xmlAssinado, soap({ extra: '<ns0:Signature><ns0:SignatureValue>x</ns0:SignatureValue></ns0:Signature>' })), "prefixo");
});

Deno.test("nfeProc: NFe sem assinatura, sem chave ou com dois <NFe> é recusado", () => {
  recusa(buildNfeProc(semDeclaracao.replace(/<Signature[\s\S]*<\/Signature>/, ""), soap()), "assinatura");
  recusa(buildNfeProc(semDeclaracao.replace(/Id="NFe\d{44}"/, 'Id="x"'), soap()), "chave");
  recusa(buildNfeProc(semDeclaracao + semDeclaracao, soap()), "exatamente um <NFe>");
});

Deno.test("nfeProc: entradas vazias ou nulas não lançam erro, devolvem o motivo", () => {
  for (const [a, b] of [[null, soap()], [xmlAssinado, null], [undefined, undefined], ["", ""]] as const) {
    const r = buildNfeProc(a, b);
    assert(!r.ok && r.motivo.length > 0);
  }
});

Deno.test("nfeProc: aceita o formato real da resposta da SEFAZ-GO (NFC-e nº 4, homologação)", () => {
  // Resposta literal da SEFAZ-GO guardada em xml_authorized da NFC-e nº 4; a NFe aqui só reproduz
  // o que o protocolo confere (chave e DigestValue reais da nota).
  const respostaReal =
    `<?xml version='1.0' encoding='UTF-8'?><env:Envelope xmlns:env="http://www.w3.org/2003/05/soap-envelope"><env:Header/><env:Body><nfeResultMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeAutorizacao4"><retEnviNFe versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe" xmlns:ns0="http://www.w3.org/2000/09/xmldsig#"><tpAmb>2</tpAmb><verAplic>GO4.0</verAplic><cStat>104</cStat><xMotivo>Lote processado</xMotivo><cUF>52</cUF><dhRecbto>2026-10-04T11:57:26-03:00</dhRecbto><protNFe versao="4.00"><infProt><tpAmb>2</tpAmb><verAplic>GO4.0</verAplic><chNFe>52261052481599000126650010000000041856705862</chNFe><dhRecbto>2026-10-04T11:57:27-03:00</dhRecbto><nProt>152260027753952</nProt><digVal>tjXM8ymm/oTyDGhudzIkmxBBOpA=</digVal><cStat>100</cStat><xMotivo>Autorizado o uso da NF-e</xMotivo></infProt></protNFe></retEnviNFe></nfeResultMsg></env:Body></env:Envelope>`;
  const nfeMinima =
    `<?xml version="1.0" encoding="UTF-8"?><NFe xmlns="http://www.portalfiscal.inf.br/nfe"><infNFe Id="NFe52261052481599000126650010000000041856705862" versao="4.00"></infNFe>` +
    `<Signature xmlns="http://www.w3.org/2000/09/xmldsig#"><SignedInfo xmlns="http://www.w3.org/2000/09/xmldsig#"><Reference URI="#NFe52261052481599000126650010000000041856705862"><DigestValue>tjXM8ymm/oTyDGhudzIkmxBBOpA=</DigestValue></Reference></SignedInfo></Signature></NFe>`;
  const r = buildNfeProc(nfeMinima, respostaReal);
  assert(r.ok, r.ok ? "" : r.motivo);
  assertStringIncludes(r.xml, "<nProt>152260027753952</nProt>");
  assert(r.xml.endsWith("</protNFe></nfeProc>"));
});
