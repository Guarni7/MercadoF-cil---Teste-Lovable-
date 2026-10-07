/**
 * Smoke das funções puras do DANFE NFC-e (src/lib/nfceDanfeFormat.js).
 *
 * Roda sem Supabase e sem navegador: só garante que a formatação da chave de
 * acesso, do CNPJ, a extração do QR Code do XML autorizado e o mapeamento do
 * código de forma de pagamento (tPag) não regridem.
 *
 * Uso: node scripts/smoke-fiscal-danfe.mjs
 */
import { readFileSync } from "fs";
import { resolve } from "path";
import {
  DANFE_SEM_QR_MENSAGEM,
  extractDanfeXmlData,
  extractPaymentLabel,
  extractQrCodeUrl,
  formatAccessKey,
  formatCnpj,
} from "../src/lib/nfceDanfeFormat.js";

const falhas = [];
const ok = [];
const check = (cond, msg) => (cond ? ok.push(msg) : falhas.push(msg));

// Chave de acesso em grupos de 4
const chave = "52260311222333000181650010000000011000000015";
check(
  formatAccessKey(chave) === "5226 0311 2223 3300 0181 6500 1000 0000 0110 0000 0015",
  `chave de acesso formatada em grupos de 4 (${formatAccessKey(chave)})`,
);

// CNPJ
check(formatCnpj("11222333000181") === "11.222.333/0001-81", `CNPJ formatado (${formatCnpj("11222333000181")})`);

// QR Code — com CDATA (como o backend grava)
const xmlComCdata = `<infNFeSupl><qrCode><![CDATA[https://nfewebhomolog.sefaz.go.gov.br/nfeweb/sites/nfce/danfeNFCe?p=${chave}|2|2|000001|ABCDEF1234567890ABCDEF1234567890ABCDEF12]]></qrCode><urlChave>https://nfewebhomolog.sefaz.go.gov.br/nfeweb/sites/nfce/danfeNFCe</urlChave></infNFeSupl>`;
const qrExtraido = extractQrCodeUrl(xmlComCdata);
check(
  qrExtraido?.startsWith("https://nfewebhomolog.sefaz.go.gov.br") && qrExtraido.includes(`p=${chave}`),
  `QR Code extraído do XML autorizado (${qrExtraido})`,
);

// QR Code — sem CDATA
const xmlSemCdata = `<qrCode>https://nfeweb.sefaz.go.gov.br/nfeweb/sites/nfce/danfeNFCe?p=abc</qrCode>`;
check(
  extractQrCodeUrl(xmlSemCdata) === "https://nfeweb.sefaz.go.gov.br/nfeweb/sites/nfce/danfeNFCe?p=abc",
  "QR Code extraído mesmo sem CDATA",
);

// XML sem grupo qrCode
check(extractQrCodeUrl("<infNFe></infNFe>") === null, "sem grupo qrCode, extração devolve null");

// Forma de pagamento a partir do tPag
check(extractPaymentLabel("<detPag><tPag>17</tPag></detPag>") === "PIX", "tPag 17 mapeado para PIX");
check(extractPaymentLabel("<detPag><tPag>01</tPag></detPag>") === "Dinheiro", "tPag 01 mapeado para Dinheiro");
check(extractPaymentLabel("<detPag><tPag>99</tPag></detPag>") === "Código 99", "tPag desconhecido mostra o código, não quebra");
check(extractPaymentLabel("<detPag></detPag>") === null, "sem tPag no XML, forma de pagamento não aparece");

// ---- DANFE: fonte do QR Code e da forma de pagamento (NFC-e nº 4, autorizada em homologação) ----
// xml_authorized guarda só a resposta SOAP da SEFAZ (sem <NFe>); xml_signed é o XML enviado.
const chaveReal = "52261052481599000126650010000000041856705862";
const urlQr = `https://nfewebhomolog.sefaz.go.gov.br/nfeweb/sites/nfce/danfeNFCe?p=${chaveReal}|2|2|1|1872A926B0A244C234E46FD721AF4B781EE9F81E`;
const xmlSigned =
  `<NFe xmlns="http://www.portalfiscal.inf.br/nfe"><infNFe Id="NFe${chaveReal}" versao="4.00"><pag><detPag><tPag>03</tPag><vPag>1.00</vPag><card><tpIntegra>2</tpIntegra></card></detPag></pag></infNFe>` +
  `<infNFeSupl><qrCode><![CDATA[${urlQr}]]></qrCode><urlChave>https://nfewebhomolog.sefaz.go.gov.br/nfeweb/sites/nfce/danfeNFCe</urlChave></infNFeSupl><Signature xmlns="http://www.w3.org/2000/09/xmldsig#"></Signature></NFe>`;
const xmlAutorizadoSoap =
  `<env:Envelope xmlns:env="http://www.w3.org/2003/05/soap-envelope"><env:Body><nfeResultMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeAutorizacao4"><retEnviNFe versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe"><cStat>104</cStat><protNFe versao="4.00"><infProt><chNFe>${chaveReal}</chNFe><nProt>152260027753952</nProt><cStat>100</cStat><xMotivo>Autorizado o uso da NF-e</xMotivo></infProt></protNFe></retEnviNFe></nfeResultMsg></env:Body></env:Envelope>`;

check(extractQrCodeUrl(xmlAutorizadoSoap) === null && extractPaymentLabel(xmlAutorizadoSoap) === null, "xml_authorized (resposta SOAP da SEFAZ) não traz qrCode nem tPag — por isso não serve de fonte");
const dados = extractDanfeXmlData({ xml_signed: xmlSigned, xml_authorized: xmlAutorizadoSoap });
check(dados.qrUrl === urlQr, `QR Code vem do xml_signed mesmo com xml_authorized só de resposta (${dados.qrUrl})`);
check(dados.formaPagamento === "Crédito", `forma de pagamento (tPag 03) vem do xml_signed (${dados.formaPagamento})`);
check(extractDanfeXmlData({ xml_signed: xmlSigned, xml_authorized: xmlAutorizadoSoap }).qrUrl.startsWith("https://nfewebhomolog.sefaz.go.gov.br"), "o QR Code do DANFE é o que foi enviado à SEFAZ");
check(
  extractDanfeXmlData({ xml_signed: null, xml_authorized: xmlSigned }).qrUrl === urlQr,
  "sem xml_signed, ainda aproveita um xml_authorized que traga o <NFe> (nfeProc futuro)",
);
const semNada = extractDanfeXmlData({ xml_signed: null, xml_authorized: xmlAutorizadoSoap });
check(semNada.qrUrl === null && semNada.formaPagamento === null, "sem qrCode/tPag em nenhum XML, devolve null (não quebra)");
check(extractDanfeXmlData(null).qrUrl === null && extractDanfeXmlData({}).formaPagamento === null, "documento vazio ou nulo não quebra");
check(!/CSC/i.test(DANFE_SEM_QR_MENSAGEM), `a mensagem de QR ausente não atribui a causa ao CSC (${DANFE_SEM_QR_MENSAGEM})`);

// nfceDanfePdf.js (usa jsPDF, não roda em Node): confere no código que usa as fontes certas.
const pdfSrc = readFileSync(resolve(process.cwd(), "src/lib/nfceDanfePdf.js"), "utf8");
check(pdfSrc.includes("extractDanfeXmlData(document)"), "DANFE: QR Code e forma de pagamento saem de extractDanfeXmlData (xml_signed primeiro)");
check(!/extractQrCodeUrl\(document\.xml_authorized\)|extractPaymentLabel\(document\.xml_authorized\)/.test(pdfSrc), "DANFE: não lê mais qrCode/tPag só do xml_authorized");
check(!pdfSrc.includes("CSC não configurado") && pdfSrc.includes("DANFE_SEM_QR_MENSAGEM"), "DANFE: a mensagem antiga 'CSC não configurado' saiu");

console.log("\nSmoke fiscal — formatação do DANFE NFC-e\n");
for (const m of ok) console.log(`  PASS  ${m}`);
for (const m of falhas) console.log(`  FAIL  ${m}`);
console.log(`\n${ok.length} passaram, ${falhas.length} falharam\n`);
process.exit(falhas.length ? 1 : 0);
