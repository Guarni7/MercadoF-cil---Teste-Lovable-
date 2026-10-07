// Testes do QR Code da NFC-e (NT 2015.002) e da inserção do infNFeSupl.
//
// Roda sem Supabase: só exercita a função pura de hash/URL e a manipulação de
// string do XML. O vetor de referência é o exemplo oficial do Manual de Padrões
// Técnicos do DANFE NFC-e e QR Code v6.0 (item 4.3.6.1): chave, ambiente, idCSC e
// CSC de exemplo publicados lá, com o hash DC6AE2C2B9A992BE59679AC365E29922DE6B7511.
// A URL gerada também é conferida contra o padrão "QRCODE V2 ONLINE" do XSD oficial
// (leiauteNFe_v4.00.xsd, pacote PL_010f).
//
// Uso: deno test --allow-none supabase/functions/_shared/fiscal/qrcode.test.ts
import { assertEquals, assertMatch, assertRejects, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildNfceQrCode, insertInfNFeSupl } from "./qrcode.ts";

const CHAVE = "52260311222333000181650010000000011000000015";
const ID_CSC = "1";
const CSC = "12345678-1234-1234-1234-123456789012";
const BASE_URL = "https://nfewebhomolog.sefaz.go.gov.br/nfeweb/sites/nfce/danfeNFCe";

// Padrão "QRCODE V2 ONLINE" do XSD oficial (leiauteNFe_v4.00.xsd, elemento qrCode).
const PADRAO_XSD_V2_ONLINE =
  /^((HTTPS?|https?):\/\/.*\?p=([0-9]{6}[0-9A-Z]{12}[0-9]{16}(1|3|4)[0-9]{9})\|[2]\|[1-2]\|(0|[1-9]{1}([0-9]{1,5})?)\|[A-Fa-f0-9]{40})$/;

Deno.test("buildNfceQrCode - vetor oficial do Manual v6.0 (4.3.6.1): hash e URL idênticos", async () => {
  const { url } = await buildNfceQrCode({
    accessKey: "28170800156225000131650110000151341562040824",
    environment: "producao",
    idCsc: "1",
    csc: "SEU-CODIGO-CSC-CONTRIBUINTE-36-CARACTERES",
    baseUrl: "http://www.sefazexemplo.gov.br/NFC-e/QRCode",
  });
  assertEquals(
    url,
    "http://www.sefazexemplo.gov.br/NFC-e/QRCode?p=28170800156225000131650110000151341562040824|2|1|1|DC6AE2C2B9A992BE59679AC365E29922DE6B7511",
  );
});

Deno.test("buildNfceQrCode - idCSC sem zeros não significativos, na URL e no hash", async () => {
  const base = { accessKey: CHAVE, environment: "homologacao" as const, csc: CSC, baseUrl: BASE_URL };
  const comZeros = await buildNfceQrCode({ ...base, idCsc: "000001" });
  const semZeros = await buildNfceQrCode({ ...base, idCsc: "1" });
  assertEquals(comZeros.url, semZeros.url, "000001 e 1 são o mesmo CSC e geram a mesma URL");
  assertEquals(semZeros.url.split("?p=")[1].split("|")[3], "1");
  assertEquals((await buildNfceQrCode({ ...base, idCsc: "000012" })).url.split("|")[3], "12");
  assertEquals((await buildNfceQrCode({ ...base, idCsc: "123456" })).url.split("|")[3], "123456");
  assertEquals((await buildNfceQrCode({ ...base, idCsc: "0" })).url.split("|")[3], "0");
});

Deno.test("buildNfceQrCode - idCSC inválido é recusado (1 a 6 dígitos numéricos)", async () => {
  const base = { accessKey: CHAVE, environment: "homologacao" as const, csc: CSC, baseUrl: BASE_URL };
  for (const ruim of ["", "abc", "1234567", "1.5", "-1"]) {
    await assertRejects(() => buildNfceQrCode({ ...base, idCsc: ruim }), Error, "ID do CSC inválido");
  }
});

Deno.test("buildNfceQrCode - hash usa os pipes: SHA-1(chave|2|tpAmb|idCSC + CSC)", async () => {
  const { url } = await buildNfceQrCode({ accessKey: CHAVE, environment: "homologacao", idCsc: "000001", csc: CSC, baseUrl: BASE_URL });
  const bytes = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(`${CHAVE}|2|2|1${CSC}`));
  const esperado = Array.from(new Uint8Array(bytes)).map((b) => b.toString(16).padStart(2, "0")).join("").toUpperCase();
  assertEquals(url.split("|")[4], esperado);
});

Deno.test("buildNfceQrCode - URL gerada casa com o padrão QRCODE V2 ONLINE do XSD oficial", async () => {
  for (const environment of ["homologacao", "producao"] as const) {
    const { url } = await buildNfceQrCode({ accessKey: CHAVE, environment, idCsc: "000001", csc: CSC, baseUrl: BASE_URL });
    assertMatch(url, PADRAO_XSD_V2_ONLINE);
  }
});

Deno.test("buildNfceQrCode - homologação: tpAmb=2, idCSC sem zeros à esquerda", async () => {
  const { url, urlChave } = await buildNfceQrCode({
    accessKey: CHAVE,
    environment: "homologacao",
    idCsc: ID_CSC,
    csc: CSC,
    baseUrl: BASE_URL,
  });

  assertEquals(urlChave, BASE_URL);
  const partes = url.replace(`${BASE_URL}?p=`, "").split("|");
  assertEquals(partes[0], CHAVE);
  assertEquals(partes[1], "2"); // versão do QR Code
  assertEquals(partes[2], "2"); // tpAmb homologação
  assertEquals(partes[3], "1"); // idCSC sem zeros não significativos
  assertEquals(partes[4].length, 40); // SHA-1 em hex
  assertEquals(partes[4], partes[4].toUpperCase()); // hash em maiúsculo
});

Deno.test("buildNfceQrCode - produção usa tpAmb=1", async () => {
  const { url } = await buildNfceQrCode({
    accessKey: CHAVE,
    environment: "producao",
    idCsc: ID_CSC,
    csc: CSC,
    baseUrl: BASE_URL,
  });
  const partes = url.split("|");
  assertEquals(partes[2], "1");
});

Deno.test("buildNfceQrCode - hash é determinístico e muda se o CSC mudar", async () => {
  const a = await buildNfceQrCode({ accessKey: CHAVE, environment: "homologacao", idCsc: ID_CSC, csc: CSC, baseUrl: BASE_URL });
  const b = await buildNfceQrCode({ accessKey: CHAVE, environment: "homologacao", idCsc: ID_CSC, csc: CSC, baseUrl: BASE_URL });
  const c = await buildNfceQrCode({ accessKey: CHAVE, environment: "homologacao", idCsc: ID_CSC, csc: "outro-csc", baseUrl: BASE_URL });

  assertEquals(a.url, b.url, "mesma entrada produz o mesmo hash");
  assertEquals(a.url === c.url, false, "CSC diferente produz hash diferente — senão o QR não protegeria nada");
});

Deno.test("insertInfNFeSupl - infNFeSupl fica entre </infNFe> e <Signature>, na ordem exigida pelo schema TNFe", () => {
  const assinado =
    `<?xml version="1.0"?><NFe xmlns="ns"><infNFe Id="NFe${CHAVE}" versao="4.00"><ide></ide></infNFe>` +
    `<Signature xmlns="http://www.w3.org/2000/09/xmldsig#"><SignedInfo></SignedInfo></Signature></NFe>`;

  const resultado = insertInfNFeSupl(assinado, { url: "https://exemplo/qr?p=1", urlChave: "https://exemplo/qr" });

  const posInfNFe = resultado.indexOf("</infNFe>");
  const posSupl = resultado.indexOf("<infNFeSupl>");
  const posSignature = resultado.indexOf("<Signature");

  assertEquals(posInfNFe < posSupl && posSupl < posSignature, true, "ordem: infNFe, infNFeSupl, Signature");
  assertEquals(resultado.includes("<![CDATA[https://exemplo/qr?p=1]]>"), true, "qrCode vai em CDATA");
  assertEquals(resultado.includes("<urlChave>https://exemplo/qr</urlChave>"), true, "urlChave sem query string");
});

Deno.test("insertInfNFeSupl - XML sem Signature (não assinado) falha com mensagem clara, não insere QR em documento não assinado", () => {
  const naoAssinado = `<NFe><infNFe Id="NFe${CHAVE}"><ide></ide></infNFe></NFe>`;
  assertThrows(() => insertInfNFeSupl(naoAssinado, { url: "x", urlChave: "y" }));
});
