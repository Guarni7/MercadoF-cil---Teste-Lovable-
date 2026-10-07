/**
 * Smoke do XML autorizado completo da NFC-e (nfeProc) e do download.
 *
 * 1. src/lib/nfceXml.js (puro): só há XML para baixar em NFC-e (65) autorizada com nfeProc;
 *    o nome é <chave>.xml; resposta SOAP de nota antiga não conta como XML autorizado.
 * 2. Código: o fiscal-emit só monta o nfeProc para o modelo 65, com fallback para a resposta da
 *    SEFAZ e sem lançar erro; os botões "Baixar XML" estão no NfceDialog e no Sales; o que não
 *    pode mudar (assinatura, QR Code, documents.ts, transmitters.ts) não foi tocado.
 * 3. Isolamento (Supabase real): a empresa A lê o nfeProc da própria nota; a empresa B não lê;
 *    e o cliente não consegue gravar xml_authorized. Cria duas empresas descartáveis e apaga o
 *    documento ao fim, como o smoke-fiscal-rls. SMOKE_SKIP_DB=1 pula esta parte (sem rede).
 *
 * A montagem do nfeProc (byte a byte, assinatura, cStat, chave, digVal) é testada em
 * supabase/functions/_shared/fiscal/nfeProc.test.ts (deno).
 *
 * Uso: node scripts/smoke-fiscal-nfeproc.mjs
 */
import { readFileSync } from "fs";
import { resolve } from "path";
import { createClient } from "@supabase/supabase-js";
import { baixarXmlNfce, ehNfeProc, MSG_XML_INDISPONIVEL, nomeArquivoXml, xmlDisponivel } from "../src/lib/nfceXml.js";

const falhas = [];
const ok = [];
const check = (cond, msg) => (cond ? ok.push(msg) : falhas.push(msg));
const ler = (p) => readFileSync(resolve(process.cwd(), p), "utf8").split("\r\n").join("\n");

// ---------- 1. nfceXml.js ----------
const chave = "52261052481599000126650010000000041856705862";
const nfeProc = `<?xml version="1.0" encoding="UTF-8"?><nfeProc versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe"><NFe></NFe><protNFe versao="4.00"></protNFe></nfeProc>`;
const soap = `<?xml version='1.0' encoding='UTF-8'?><env:Envelope><env:Body><retEnviNFe><protNFe versao="4.00"></protNFe></retEnviNFe></env:Body></env:Envelope>`;
const doc = { model: "65", status: "authorized", access_key: chave, xml_authorized: nfeProc };

check(ehNfeProc(nfeProc) && ehNfeProc(nfeProc.replace(/^<\?xml[^>]*\?>/, "")) && ehNfeProc(`\n ${nfeProc}`), "nfeProc reconhecido, com ou sem declaração XML");
check(!ehNfeProc(soap) && !ehNfeProc("") && !ehNfeProc(null) && !ehNfeProc("<NFe></NFe>"), "resposta SOAP, NFe solta, vazio e nulo não são nfeProc");
check(nomeArquivoXml(doc) === `${chave}.xml`, "arquivo se chama <chave-de-acesso>.xml");
check(nomeArquivoXml({ access_key: "123" }) === null && nomeArquivoXml({}) === null && nomeArquivoXml(null) === null, "sem chave de 44 dígitos não há nome de arquivo");
check(nomeArquivoXml({ access_key: ` ${chave.slice(0, 20)} ${chave.slice(20)} ` }) === `${chave}.xml`, "só os dígitos da chave entram no nome (sem espaços nem caracteres de caminho)");
check(xmlDisponivel(doc), "NFC-e autorizada com nfeProc tem XML para baixar");
check(!xmlDisponivel({ ...doc, xml_authorized: soap }), "nota antiga (só resposta SOAP) não oferece download");
check(!xmlDisponivel({ ...doc, xml_authorized: null }), "sem xml_authorized não oferece download");
check(!xmlDisponivel({ ...doc, status: "rejected" }) && !xmlDisponivel({ ...doc, status: "error" }) && !xmlDisponivel({ ...doc, status: "pending" }), "nota não autorizada não oferece download");
check(!xmlDisponivel({ ...doc, model: "55" }) && !xmlDisponivel({ ...doc, model: "nfse" }), "só modelo 65 (NF-e e NFS-e ficam fora desta etapa)");
check(!xmlDisponivel({ ...doc, access_key: null }), "sem chave de acesso não oferece download");
check(!xmlDisponivel(null) && !xmlDisponivel(undefined), "documento nulo não quebra");
check(MSG_XML_INDISPONIVEL === "XML completo indisponível para esta nota", "mensagem de XML indisponível");

// Download de verdade (Blob + <a download>) com o DOM simulado: nome do arquivo e conteúdo.
let baixado = null;
globalThis.document = { createElement: () => ({ click() { baixado = { nome: this.download, href: this.href }; } }) };
const urlOriginal = URL.createObjectURL;
let blobGerado = null;
URL.createObjectURL = (blob) => ((blobGerado = blob), "blob:teste");
baixarXmlNfce(doc);
check(baixado?.nome === `${chave}.xml` && baixado?.href === "blob:teste", "download entrega <chave>.xml");
check(blobGerado?.type.startsWith("application/xml") && (await blobGerado.text()) === nfeProc, "o arquivo baixado é exatamente o nfeProc guardado, como application/xml");
let erroSemXml = null;
try {
  baixarXmlNfce({ ...doc, xml_authorized: soap });
} catch (e) {
  erroSemXml = e.message;
}
check(erroSemXml === MSG_XML_INDISPONIVEL, "baixar nota sem nfeProc lança a mensagem de indisponível e não gera arquivo");
URL.createObjectURL = urlOriginal;
delete globalThis.document;

// ---------- 2. código ----------
const emit = ler("supabase/functions/fiscal-emit/index.ts");
const reconc = ler("supabase/functions/_shared/fiscal/reconciliarTransmitting.ts");
check(emit.includes('import { xmlAutorizadoDaTransmissao } from "../_shared/fiscal/nfeProc.ts";') && emit.includes('import { reconciliarTransmitting } from "../_shared/fiscal/reconciliarTransmitting.ts";'), "fiscal-emit importa xmlAutorizadoDaTransmissao e reconciliarTransmitting (módulo próprio, testado de verdade em reconciliarTransmitting.test.ts)");
check(emit.includes("xmlAutorizadoDaTransmissao(model, xmlAssinado, resultado.xml)") && emit.includes("xml_authorized: xmlAutorizado,"), "fiscal-emit grava o xml autorizado (nfeProc da NFC-e, ou a resposta da SEFAZ) ao autorizar no envio");
check(reconc.includes("xmlAutorizadoDaTransmissao(model, params.xmlSigned, resultado.xml)") && reconc.includes("xml_authorized: xmlAutorizado"), "a reconciliação também grava o xml autorizado (nfeProc) no documento reconciliado");
check(emit.indexOf("xmlAutorizadoDaTransmissao(model, xmlAssinado") > emit.indexOf('resultado.outcome === "authorized"') && emit.indexOf("xmlAutorizadoDaTransmissao(model, xmlAssinado") < emit.indexOf('to: "authorized"'), "o nfeProc é montado depois da resposta autorizada e antes de gravar o status");

const nfeProcTs = ler("supabase/functions/_shared/fiscal/nfeProc.ts");
check(!/\bimport\b/.test(nfeProcTs), "nfeProc.ts é puro (sem imports, rede ou banco)");
check(nfeProcTs.includes('cStat !== "100"') && nfeProcTs.includes("chNFe") && nfeProcTs.includes("digVal"), "nfeProc.ts exige cStat 100, chave e digVal");

const dialog = ler("src/components/pos/NfceDialog.jsx");
check(dialog.includes("Baixar XML") && dialog.includes("baixarXmlNfce(doc)") && dialog.includes("xmlDisponivel(doc)"), "NfceDialog tem o botão Baixar XML, que confere a disponibilidade");
const sales = ler("src/pages/Sales.jsx");
check(sales.includes("Baixar XML") && sales.includes("buscarNfceAutorizadaDaVenda(api, viewSale.id)") && sales.includes("disabled={!xmlDisponivel(nfceDaVenda)}"), "detalhe da venda (Sales) tem o botão Baixar XML, desabilitado quando não há nfeProc");

const intactos = [
  ["supabase/functions/_shared/fiscal/signature.ts", ["canonicalize", "ALGORITMOS"]],
  ["supabase/functions/_shared/fiscal/qrcode.ts", ["buildNfceQrCode", "insertInfNFeSupl"]],
  ["supabase/functions/_shared/fiscal/documents.ts", ["buildNfceXml", "buildDpsXml"]],
  ["supabase/functions/_shared/fiscal/transmitters.ts", ["transmitSefaz", "xml: texto"]],
];
for (const [arquivo, marcas] of intactos) {
  const t = ler(arquivo);
  check(marcas.every((m) => t.includes(m)) && !t.includes("nfeProc"), `${arquivo.split("/").pop()} não foi tocado por esta etapa (sem referência ao nfeProc)`);
}

// ---------- 3. isolamento entre empresas (Supabase real) ----------
if (process.env.SMOKE_SKIP_DB === "1") {
  console.log("(SMOKE_SKIP_DB=1: parte de isolamento no banco pulada)");
} else {
  const env = {};
  for (const l of readFileSync(resolve(process.cwd(), ".env.local"), "utf8").split(/\r?\n/)) {
    const m = l.match(/^([^#=]+)=(.*)$/);
    if (m) env[m[1].trim()] = m[2].trim().replace(/^['"]|['"]$/g, "");
  }
  const admin = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
  const tenant = async (tag) => {
    const stamp = Date.now() + Math.floor(Math.random() * 1000);
    const email = `guarni07+mf.nfeproc.${tag}.${stamp}@gmail.com`;
    const password = `NfeProc-${stamp}aA1!`;
    await admin.auth.admin.createUser({ email, password, email_confirm: true });
    const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    await sb.auth.signInWithPassword({ email, password });
    const { data, error } = await sb.rpc("bootstrap_company", { p_trade_name: `NfeProc ${tag} ${stamp}`, p_email: email });
    if (error) throw error;
    return { sb, company: typeof data === "string" ? data : data?.id };
  };
  const a = await tenant("a");
  const b = await tenant("b");
  try {
    const { data: docA, error: erroDoc } = await admin
      .from("fiscal_documents")
      .insert({ company_id: a.company, model: "65", environment: "homologacao", status: "draft", access_key: chave, xml_authorized: nfeProc })
      .select("id")
      .single();
    if (erroDoc) throw erroDoc;

    const { data: proprio } = await a.sb.from("fiscal_documents").select("id, model, status, access_key, xml_authorized").eq("id", docA.id).maybeSingle();
    check(proprio?.xml_authorized === nfeProc && nomeArquivoXml({ ...proprio, status: "authorized" }) === `${chave}.xml`, "empresa A lê o nfeProc da própria nota");
    const { data: alheio } = await b.sb.from("fiscal_documents").select("id, xml_authorized").eq("id", docA.id);
    check((alheio || []).length === 0, "empresa B não enxerga o XML da nota da empresa A (get por id)");
    const { data: alheioLista } = await b.sb.from("fiscal_documents").select("id").eq("company_id", a.company);
    check((alheioLista || []).length === 0, "empresa B não lista as notas da empresa A (filtro por company_id)");

    const { data: gravou, error: erroGravar } = await a.sb.from("fiscal_documents").update({ xml_authorized: "<nfeProc>falso</nfeProc>" }).eq("id", docA.id).select();
    check(!!erroGravar || (gravou || []).length === 0, "cliente não consegue gravar xml_authorized (o XML autorizado só nasce no servidor)");
    const { data: depois } = await admin.from("fiscal_documents").select("xml_authorized").eq("id", docA.id).single();
    check(depois?.xml_authorized === nfeProc, "xml_authorized continua o original depois da tentativa de adulteração");
  } finally {
    await admin.from("fiscal_documents").delete().eq("company_id", a.company);
    await admin.from("companies").delete().in("id", [a.company, b.company]);
  }
}

console.log("\nSmoke fiscal — nfeProc e download do XML da NFC-e\n");
for (const m of ok) console.log(`  PASS  ${m}`);
for (const m of falhas) console.log(`  FAIL  ${m}`);
console.log(`\n${ok.length} passaram, ${falhas.length} falharam\n`);
process.exit(falhas.length ? 1 : 0);
