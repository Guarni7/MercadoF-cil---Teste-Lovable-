// Testes da montagem da NFC-e (documents.ts) e da assinatura sobre ela.
//
// Cobrem o que a SEFAZ-GO recusou com cStat 225 (falha de schema): dhEmi com
// fuso e sem milissegundos, ICMSTot completo, xProd fixo em homologação. E que a
// assinatura continua conferindo com o XML exatamente como ele é transmitido.
//
// Uso: deno test --allow-net supabase/functions/_shared/fiscal/documents.test.ts
import { assert, assertEquals, assertMatch, assertNotMatch } from "https://deno.land/std@0.224.0/assert/mod.ts";
import forge from "https://esm.sh/node-forge@1.3.1";
import { buildNfceXml } from "./documents.ts";
import { applyTaxRules, type TaxRule } from "./taxEngine.ts";
import { signXml } from "./signature.ts";
type ParsedCertificate = Parameters<typeof signXml>[1];

const settings = {
  company_id: "c1",
  cnpj: "52481599000126",
  legal_name: "EMPRESA TESTE LTDA",
  trade_name: "TESTE",
  ie: "200843354",
  uf: "GO",
  city_name: "Anapolis",
  city_ibge_code: "5201108",
  crt: "1",
  tax_regime: "simples",
  address: "Rua Teste",
  address_number: "10",
  neighborhood: "Centro",
  cep: "75050210",
};

const regra: TaxRule = {
  id: "r1", company_id: "c1", priority: 0, match: {}, valid_from: "2026-01-01", valid_to: null, active: true,
  taxes: { icms: { csosn: "102" }, pis: { cst: "01", aliquota: 0 }, cofins: { cst: "01", aliquota: 0 } },
};

const itens = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    product_id: `p${i + 1}`, name: `Produto ${i + 1}`, quantity: 1, unit: "UN", price: 1, total: 1,
    ncm: "22021000", cfop: "5102", origin: "0",
  }));

const monta = (environment: "homologacao" | "producao", n = 1, pagamento: Record<string, unknown> = {}) => {
  const taxed = applyTaxRules([regra], itens(n), {
    model: "65", uf: "GO", crt: "1", tax_regime: "simples", issued_at: new Date(),
  });
  assertEquals(taxed.errors, []);
  return buildNfceXml({
    settings, items: taxed.items, totals: taxed.totals, recipient: null, series: 1, number: 1,
    environment, model: "65", paymentMethod: "credito", ...pagamento,
  });
};

const pag = (xml: string) => xml.match(/<pag>.*<\/pag>/)![0];

Deno.test("dhEmi: hora local com offset -03:00, sem milissegundos nem Z", () => {
  const xml = monta("homologacao");
  assertMatch(xml, /<dhEmi>\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}-03:00<\/dhEmi>/);
  assertNotMatch(xml, /<dhEmi>[^<]*(Z|\.\d{3})/);
});

Deno.test("chave de acesso: AAMM igual ao mês do dhEmi", () => {
  const xml = monta("homologacao");
  const dh = xml.match(/<dhEmi>(\d{4})-(\d{2})/)!;
  const chave = xml.match(/Id="NFe(\d{44})"/)![1];
  assertEquals(chave.slice(2, 6), `${dh[1].slice(2)}${dh[2]}`);
});

Deno.test("ICMSTot: todos os campos do leiaute, na ordem", () => {
  const xml = monta("homologacao", 2);
  const grupo = xml.match(/<ICMSTot>(.*?)<\/ICMSTot>/)![1];
  const campos = [...grupo.matchAll(/<(\w+)>/g)].map((m) => m[1]);
  assertEquals(campos, [
    "vBC", "vICMS", "vICMSDeson", "vFCP", "vBCST", "vST", "vFCPST", "vFCPSTRet", "vProd", "vFrete",
    "vSeg", "vDesc", "vII", "vIPI", "vIPIDevol", "vPIS", "vCOFINS", "vOutro", "vNF",
  ]);
  assertMatch(grupo, /<vProd>2\.00<\/vProd>/);
  assertMatch(grupo, /<vNF>2\.00<\/vNF>/);
  assertMatch(grupo, /<vPIS>0\.00<\/vPIS>/);
});

Deno.test("xProd: homologação troca só o primeiro item; produção mantém o nome", () => {
  const hom = [...monta("homologacao", 2).matchAll(/<xProd>(.*?)<\/xProd>/g)].map((m) => m[1]);
  assertEquals(hom, ["NOTA FISCAL EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL", "Produto 2"]);
  const prod = [...monta("producao", 2).matchAll(/<xProd>(.*?)<\/xProd>/g)].map((m) => m[1]);
  assertEquals(prod, ["Produto 1", "Produto 2"]);
});

Deno.test("XML sem espaço entre tags (o assinado é o transmitido)", () => {
  assertNotMatch(monta("homologacao"), />\s+</);
});

// Certificado autoassinado só para o teste.
const certificadoDeTeste = (): ParsedCertificate => {
  const keys = forge.pki.rsa.generateKeyPair(1024);
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
    certPem: forge.pki.certificateToPem(cert), keyPem: forge.pki.privateKeyToPem(keys.privateKey),
    subject: "CN=TESTE", issuer: "CN=TESTE", validFrom: cert.validity.notBefore, validTo: cert.validity.notAfter, cnpj: "52481599000126",
  };
};

Deno.test("assinatura confere com o XML como é transmitido", async () => {
  const cert = certificadoDeTeste();
  const assinado = await signXml(monta("homologacao"), cert, "infNFe");

  const infNFe = assinado.match(/<infNFe\b[\s\S]*<\/infNFe>/)![0];
  // C14N do elemento transmitido: herda o namespace da raiz, sem espaço entre tags.
  const canonico = infNFe.replace(/^<infNFe/, '<infNFe xmlns="http://www.portalfiscal.inf.br/nfe"');
  const md = forge.md.sha1.create();
  md.update(canonico, "utf8");
  const digest = assinado.match(/<DigestValue>([^<]+)<\/DigestValue>/)![1];
  assertEquals(digest, forge.util.encode64(md.digest().getBytes()));

  const signedInfo = assinado.match(/<SignedInfo\b[\s\S]*<\/SignedInfo>/)![0];
  const sig = forge.util.decode64(assinado.match(/<SignatureValue>([^<]+)<\/SignatureValue>/)![1]);
  const mdSi = forge.md.sha1.create();
  mdSi.update(signedInfo, "utf8");
  const publica = forge.pki.certificateFromPem(cert.certPem).publicKey as forge.pki.rsa.PublicKey;
  assert(publica.verify(mdSi.digest().getBytes(), sig));
  assertNotMatch(assinado, />\s+</);
});

// ---- Grupo card (cStat 391): cartão da maquininha, tpIntegra=2 ----

Deno.test("card: crédito na maquininha gera card/tpIntegra=2, depois do vPag, sem CNPJ nem bandeira", () => {
  const xml = monta("homologacao", 1, {
    paymentMethod: "credito",
    payments: [{ method: "credito", channel: "maquininha", confirmationType: "manual" }],
  });
  assertEquals(pag(xml), "<pag><detPag><tPag>03</tPag><vPag>1.00</vPag><card><tpIntegra>2</tpIntegra></card></detPag></pag>");
});

Deno.test("card: débito (tPag 04) também gera o grupo card", () => {
  const xml = monta("homologacao", 1, { paymentMethod: "debito", payments: [{ method: "debito", channel: "maquininha" }] });
  assertEquals(pag(xml), "<pag><detPag><tPag>04</tPag><vPag>1.00</vPag><card><tpIntegra>2</tpIntegra></card></detPag></pag>");
});

Deno.test("card: NSU informado vai em cAut; sem NSU não sai cAut", () => {
  const com = monta("homologacao", 1, { payments: [{ method: "credito", channel: "maquininha", nsu: " 123456 " }] });
  assertEquals(pag(com), "<pag><detPag><tPag>03</tPag><vPag>1.00</vPag><card><tpIntegra>2</tpIntegra><cAut>123456</cAut></card></detPag></pag>");
  for (const nsu of [null, "", "   "]) {
    assertNotMatch(monta("homologacao", 1, { payments: [{ method: "credito", channel: "maquininha", nsu }] }), /<cAut>/);
  }
});

Deno.test("card: NSU com caracteres especiais é escapado e limitado a 128", () => {
  const xml = monta("homologacao", 1, { payments: [{ method: "credito", channel: "maquininha", nsu: "A&B<1>" }] });
  assertMatch(xml, /<cAut>A&amp;B&lt;1&gt;<\/cAut>/);
  const longo = monta("homologacao", 1, { payments: [{ method: "credito", channel: "maquininha", nsu: "9".repeat(300) }] });
  assertEquals(longo.match(/<cAut>(\d+)<\/cAut>/)![1].length, 128);
});

Deno.test("card: venda antiga sem payments[] (só payment_method) segue como maquininha", () => {
  for (const payments of [undefined, null, []]) {
    assertMatch(monta("homologacao", 1, { payments }), /<card><tpIntegra>2<\/tpIntegra><\/card>/);
  }
});

Deno.test("card: nunca inventa CNPJ da credenciadora nem bandeira", () => {
  const card = monta("homologacao", 1, { payments: [{ method: "credito", channel: "maquininha", nsu: "1" }] }).match(/<card>.*<\/card>/)![0];
  assertNotMatch(card, /<CNPJ>|<tBand>|<CNPJReceb>|<idTermPag>/);
});

Deno.test("card: TEF e Smart POS (integrados) ficam como antes, sem card", () => {
  for (const payments of [
    [{ method: "credito", channel: "smartpos" }],
    [{ method: "credito", channel: "tef" }],
    [{ method: "credito", provider: "connecttef" }],
    [{ method: "credito", transactionId: "T1" }],
  ]) {
    assertEquals(pag(monta("homologacao", 1, { payments })), "<pag><detPag><tPag>03</tPag><vPag>1.00</vPag></detPag></pag>");
  }
});

Deno.test("card: dinheiro, PIX e outros não ganham card", () => {
  for (const [paymentMethod, tPag] of [["dinheiro", "01"], ["pix", "17"], ["crediario", "05"], ["outro", "99"]]) {
    assertEquals(
      pag(monta("homologacao", 1, { paymentMethod, payments: [{ method: paymentMethod, channel: "maquininha" }] })),
      `<pag><detPag><tPag>${tPag}</tPag><vPag>1.00</vPag></detPag></pag>`,
    );
  }
});

Deno.test("card: assinatura continua valendo com o grupo card", async () => {
  const cert = certificadoDeTeste();
  const assinado = await signXml(monta("homologacao", 1, { payments: [{ method: "credito", channel: "maquininha", nsu: "42" }] }), cert, "infNFe");
  const canonico = assinado.match(/<infNFe\b[\s\S]*<\/infNFe>/)![0].replace(/^<infNFe/, '<infNFe xmlns="http://www.portalfiscal.inf.br/nfe"');
  const md = forge.md.sha1.create();
  md.update(canonico, "utf8");
  assertEquals(assinado.match(/<DigestValue>([^<]+)<\/DigestValue>/)![1], forge.util.encode64(md.digest().getBytes()));
});
