// xml_authorized gravado quando a SEFAZ autoriza no envio (ramo "authorized" do handler do
// fiscal-emit). Regressão do ReferenceError "xmlAutorizado is not defined", que deixou a NFC-e nº 5
// autorizada na SEFAZ e presa em 'transmitting' no banco.
//
// Uso: deno test --no-check --allow-read supabase/functions/_shared/fiscal/xmlAutorizadoTransmissao.test.ts
import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { xmlAutorizadoDaTransmissao } from "./nfeProc.ts";

const CHAVE = "52261052481599000126650010000000051928064644";
const DIGEST = "abc123digest=";
const NFE =
  `<NFe xmlns="http://www.portalfiscal.inf.br/nfe"><infNFe Id="NFe${CHAVE}" versao="4.00"></infNFe>` +
  `<Signature xmlns="http://www.w3.org/2000/09/xmldsig#"><SignedInfo><Reference URI="#NFe${CHAVE}"><DigestValue>${DIGEST}</DigestValue></Reference></SignedInfo></Signature></NFe>`;
const RESPOSTA =
  `<retEnviNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><protNFe versao="4.00"><infProt>` +
  `<chNFe>${CHAVE}</chNFe><dhRecbto>2026-10-04T21:05:34-03:00</dhRecbto><nProt>152260027754134</nProt>` +
  `<digVal>${DIGEST}</digVal><cStat>100</cStat><xMotivo>Autorizado o uso da NF-e</xMotivo></infProt></protNFe></retEnviNFe>`;

Deno.test("NFC-e autorizada: devolve o nfeProc com a NFe enviada e o protNFe", () => {
  const r = xmlAutorizadoDaTransmissao("65", NFE, RESPOSTA);
  assertEquals(r.aviso, null);
  assertStringIncludes(r.xml!, "<nfeProc");
  assertStringIncludes(r.xml!, NFE);
  assertStringIncludes(r.xml!, "<nProt>152260027754134</nProt>");
});

Deno.test("NFC-e que não monta o nfeProc: cai na resposta da SEFAZ e avisa o motivo (nunca lança)", () => {
  const r = xmlAutorizadoDaTransmissao("65", null, RESPOSTA);
  assertEquals(r.xml, RESPOSTA);
  assertEquals(r.aviso, "XML assinado ausente");
  assertEquals(xmlAutorizadoDaTransmissao("65", NFE, undefined), { xml: null, aviso: "resposta da SEFAZ ausente" });
});

Deno.test("outros modelos (NF-e, NFS-e): grava a resposta como antes, sem nfeProc", () => {
  for (const model of ["55", "nfse"]) {
    assertEquals(xmlAutorizadoDaTransmissao(model, NFE, "resposta"), { xml: "resposta", aviso: null });
  }
});

// O deno test roda com --no-check, então um nome fora de escopo no index.ts só aparece em produção.
// Esta checagem lê o ramo "authorized" do handler e exige a declaração antes do uso.
Deno.test("fiscal-emit: o ramo authorized do handler declara xmlAutorizado antes de usá-la", async () => {
  const fonte = await Deno.readTextFile(new URL("../../fiscal-emit/index.ts", import.meta.url));
  const handler = fonte.slice(fonte.indexOf("// 9. Retorno oficial"));
  const decl = handler.indexOf("const { xml: xmlAutorizado");
  const uso = handler.indexOf("xml_authorized: xmlAutorizado");
  assertEquals(decl > -1 && uso > -1 && decl < uso, true, "declaração de xmlAutorizado ausente ou depois do uso");
});
