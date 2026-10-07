// Evento de cancelamento de NFC-e/NF-e (110111): a assinatura do infEvento tem de valer no XML
// exatamente como é transmitido.
//
// O defeito que isto cobre: buildCancelamentoNfeXml devolvia o XML indentado (espaço e quebra de
// linha entre as tags), enquanto signXml calcula o digest do infEvento SEM esses espaços. O que
// ia para a SEFAZ tinha outro digest. Quem confere aqui é o xml-crypto (C14N da especificação),
// não o signXml. Nenhuma chamada à SEFAZ: tudo local, com certificado de teste.
//
// Uso: deno test --no-check --node-modules-dir=none --allow-net --allow-read --allow-env supabase/functions/_shared/fiscal/cancelamentoNfe.test.ts
import { assert, assertEquals, assertMatch, assertNotMatch, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import forge from "https://esm.sh/node-forge@1.3.1";
import { C14nCanonicalization, SignedXml } from "npm:xml-crypto@6";
import { DOMParser } from "npm:@xmldom/xmldom@0.8.10";
import { createHash } from "node:crypto";
import { buildCancelamentoNfeXml } from "./documents.ts";
import { signXml } from "./signature.ts";

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

const CHAVE = "52261052481599000126650010000000041856705862";
const evento = (justificativa = "Cancelamento de teste em homologacao") =>
  buildCancelamentoNfeXml({
    accessKey: CHAVE, cnpjAutor: "52481599000126", uf: "GO", protocol: "152260027753952", justificativa, environment: "homologacao",
  });

// Como transmitCancelamentoNfe envia: o evento assinado, sem a declaração <?xml?>, sem mexer em mais nada.
const transmitido = async (xml: string) => (await signXml(xml, certificado, "infEvento")).replace(/^<\?xml[^>]*\?>/, "");

const parse = (xml: string) => new DOMParser().parseFromString(xml, "text/xml");
const filhos = (el: Element) => Array.from({ length: el.childNodes.length }, (_, i) => el.childNodes[i] as Element);
const valida = (xml: string) => {
  const doc = parse(xml);
  const sx = new SignedXml({ publicCert: certificado.certPem });
  sx.loadSignature(doc.getElementsByTagNameNS("http://www.w3.org/2000/09/xmldsig#", "Signature")[0]);
  try {
    return sx.checkSignature(xml);
  } catch {
    return false;
  }
};

Deno.test("cancelamento: XML sem espaço nem quebra de linha entre as tags", () => {
  const xml = evento();
  assertNotMatch(xml, />\s+</);
  assertMatch(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?><envEvento xmlns="http:\/\/www\.portalfiscal\.inf\.br\/nfe" versao="1\.00"><idLote>/);
});

Deno.test("cancelamento: assinatura do infEvento valida (xml-crypto) no XML como é transmitido", async () => {
  const enviado = await transmitido(evento());
  assertNotMatch(enviado, />\s+</);
  assert(valida(enviado), "xml-crypto recusou a assinatura do evento como transmitido");
});

Deno.test("cancelamento: DigestValue confere com a C14N do infEvento transmitido (calculado fora do signXml)", async () => {
  const doc = parse(await transmitido(evento()));
  const inf = doc.getElementsByTagNameNS("*", "infEvento")[0];
  const esperado = createHash("sha1").update(new C14nCanonicalization().process(inf, {}), "utf8").digest("base64");
  assertEquals(doc.getElementsByTagNameNS("*", "DigestValue")[0].textContent, esperado);
});

Deno.test("cancelamento: estrutura envEvento > idLote + evento > infEvento + Signature, com os dados da nota", async () => {
  const doc = parse(await transmitido(evento()));
  const env = doc.documentElement;
  assertEquals(env.localName, "envEvento");
  assertEquals(filhos(env).map((n) => n.localName), ["idLote", "evento"]);
  const ev = filhos(env)[1];
  assertEquals(filhos(ev).map((n) => n.localName), ["infEvento", "Signature"]);
  const inf = filhos(ev)[0];
  assertEquals(inf.getAttribute("Id"), `ID110111${CHAVE}01`);
  assertEquals(filhos(inf).map((n) => n.localName), ["cOrgao", "tpAmb", "CNPJ", "chNFe", "dhEvento", "tpEvento", "nSeqEvento", "verEvento", "detEvento"]);
  const campo = (n: string) => inf.getElementsByTagNameNS("*", n)[0].textContent;
  assertEquals([campo("cOrgao"), campo("tpAmb"), campo("CNPJ"), campo("chNFe"), campo("tpEvento"), campo("nSeqEvento")], ["52", "2", "52481599000126", CHAVE, "110111", "1"]);
  assertEquals([campo("descEvento"), campo("nProt"), campo("xJust")], ["Cancelamento", "152260027753952", "Cancelamento de teste em homologacao"]);
  // dhEvento no padrão TDateTimeUTC do leiaute: AAAA-MM-DDThh:mm:ss±hh:00
  assertMatch(campo("dhEvento")!, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[-+]\d{2}:00$/);
});

Deno.test("cancelamento: justificativa com caracteres especiais continua escapada e a assinatura vale", async () => {
  const enviado = await transmitido(evento("Erro de digitacao & valor <errado> da venda"));
  assertMatch(enviado, /<xJust>Erro de digitacao &amp; valor &lt;errado&gt; da venda<\/xJust>/);
  assert(valida(enviado));
});

Deno.test("cancelamento: justificativa fora de 15 a 255 caracteres segue recusada", () => {
  assertThrows(() => evento("curta demais"), Error, "entre 15 e 255");
  assertThrows(() => evento("x".repeat(256)), Error, "entre 15 e 255");
  assertEquals(evento("x".repeat(15)).includes("<xJust>" + "x".repeat(15) + "</xJust>"), true);
});

Deno.test("regressão: o evento INDENTADO (como era gerado) assinado e transmitido com espaços não valida", async () => {
  // Reproduz o defeito: o mesmo evento, só que com quebra de linha e indentação entre as tags.
  const indentado = evento().replace(/></g, ">\n  <");
  assertMatch(indentado, />\s+</);
  const enviado = await transmitido(indentado);
  assertMatch(enviado, />\s+</);
  assertEquals(valida(enviado), false, "o XML com espaços tem outro digest do que foi assinado");
});
