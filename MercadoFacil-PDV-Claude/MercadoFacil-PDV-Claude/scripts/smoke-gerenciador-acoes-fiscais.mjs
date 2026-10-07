/**
 * Smoke das ações fiscais no detalhe da venda do Gerenciador (sem rede).
 *
 * 1. Qual botão aparece conforme os documentos fiscais reais da venda: sem documento → Emitir NFC-e;
 *    transmitting → Reconciliar; rejected → Reenviar; authorized → Baixar XML (+ DANFE e Cancelar);
 *    em andamento/cancelada → nenhum botão de envio (o servidor recusaria).
 *    error só vira Reenviar quando é seguro: nada foi enviado ou a SEFAZ confirmou que não autorizou;
 *    senão é estado incerto (a SEFAZ pode ter autorizado) e não há botão de envio.
 * 2. Qual documento vale quando a venda tem mais de um (autorizado primeiro, senão o mais recente).
 * 3. O XML baixado é o nfeProc autorizado guardado no documento, nunca o SOAP bruto.
 * 4. Código: o detalhe da venda só usa as funções fiscais que já existiam (NfceDialog/emitirDocumento,
 *    baixarXmlNfce, abrirNfceDanfePdf); não chama a SEFAZ nem cria emissão paralela.
 *
 * Uso: node scripts/smoke-gerenciador-acoes-fiscais.mjs
 */
import { readFileSync } from "fs";
import { resolve } from "path";
import {
  ACAO_FISCAL,
  analisarNfceDaVenda,
  buscarDocumentosNfceDaVenda,
  escolherDocumentoNfce,
  podeReenviar,
  rotuloAcaoFiscal,
} from "../src/lib/acoesFiscaisVenda.js";
import { baixarXmlNfce, MSG_XML_INDISPONIVEL, xmlDisponivel } from "../src/lib/nfceXml.js";

const falhas = [];
const ok = [];
const check = (cond, msg) => (cond ? ok.push(msg) : falhas.push(msg));
const ler = (p) => readFileSync(resolve(process.cwd(), p), "utf8").split("\r\n").join("\n");

const venda = { id: "1f970624-6784-4d77-a45f-fe2750595a9d", status: "concluida" };
const CHAVE = "52261052481599000126650010000000051928064644";
const doc = (status, extra = {}) => ({ id: `doc-${status}`, model: "65", status, ...extra });
const analisa = (docs, v = venda, opcoes) => analisarNfceDaVenda(docs, v, opcoes);
const acao = (docs, v, opcoes) => analisa(docs, v, opcoes).acao;

// ---------- 1. botão por status ----------
const ASSINADO = `<NFe><infNFe Id="NFe${CHAVE}"></infNFe><Signature></Signature></NFe>`;
const SEM_ASSINATURA = `<NFe><infNFe Id="NFe${CHAVE}"></infNFe></NFe>`;

check(acao([]) === ACAO_FISCAL.EMITIR && rotuloAcaoFiscal(acao([])) === "Emitir NFC-e", "sem documento fiscal → botão 'Emitir NFC-e'");
check(
  acao([doc("transmitting", { xml_signed: ASSINADO })]) === ACAO_FISCAL.RECONCILIAR && rotuloAcaoFiscal(ACAO_FISCAL.RECONCILIAR) === "Reconciliar",
  "transmitting → botão 'Reconciliar' (nunca Emitir/Reenviar)",
);
check(
  acao([doc("rejected", { rejection_code: "391" })]) === ACAO_FISCAL.REENVIAR && rotuloAcaoFiscal(ACAO_FISCAL.REENVIAR) === "Reenviar",
  "rejeitado com cStat de rejeição → botão 'Reenviar'",
);
check(acao([doc("authorized")]) === ACAO_FISCAL.AUTORIZADA && rotuloAcaoFiscal(ACAO_FISCAL.AUTORIZADA) === null, "autorizado → Baixar XML / DANFE / Cancelar (nenhum botão de envio)");
for (const s of ["pending", "draft", "validating"]) {
  check(
    acao([doc(s)]) === ACAO_FISCAL.EM_ANDAMENTO && rotuloAcaoFiscal(ACAO_FISCAL.EM_ANDAMENTO) === null,
    `${s} → só informa 'em andamento', sem botão de envio (o servidor devolve 409 e evita duplicidade)`,
  );
}
check(acao([doc("cancelled")]) === ACAO_FISCAL.NENHUMA && acao([doc("status-novo")]) === ACAO_FISCAL.NENHUMA, "cancelado ou status desconhecido → nenhum botão de envio");
check(acao([], { ...venda, status: "cancelada" }) === ACAO_FISCAL.NENHUMA, "venda cancelada sem nota → não oferece emitir");
check(acao([doc("authorized")], { ...venda, status: "cancelada" }) === ACAO_FISCAL.AUTORIZADA, "venda cancelada com nota autorizada ainda permite baixar o XML");
check(acao([], venda, { nfceHabilitada: false }) === ACAO_FISCAL.NENHUMA, "empresa sem NFC-e habilitada não vê 'Emitir NFC-e' em toda venda");
check(
  acao([doc("transmitting", { xml_signed: ASSINADO })], venda, { nfceHabilitada: false }) === ACAO_FISCAL.RECONCILIAR,
  "documento que já existe continua reconciliável mesmo com a NFC-e desligada depois",
);
check(acao(undefined) === ACAO_FISCAL.EMITIR && acao(null) === ACAO_FISCAL.EMITIR, "lista indefinida = sem documento");

// ---------- 1b. error: só Reenviar quando é seguro (a nota pode ter sido autorizada na SEFAZ) ----------
// Enviada e assinada, sem resposta registrada: timeout, HTTP 5xx, resposta sem protocolo.
const incerto = doc("error", { xml_signed: ASSINADO, authorizer_response: null });
check(
  acao([incerto]) === ACAO_FISCAL.CONSULTAR && rotuloAcaoFiscal(ACAO_FISCAL.CONSULTAR) === null,
  "error depois do envio (XML assinado, sem resposta da SEFAZ) → NÃO oferece Reenviar: estado incerto, sem botão de envio",
);
check(analisa([incerto]).chave === CHAVE, "no estado incerto a tela mostra a chave de acesso para consulta (tirada do XML assinado)");
check(
  acao([doc("error", { xml_signed: null })]) === ACAO_FISCAL.REENVIAR && acao([doc("error")]) === ACAO_FISCAL.REENVIAR,
  "error de validação/numeração/certificado (nada foi enviado: sem XML) → Reenviar",
);
check(
  acao([doc("error", { xml_signed: SEM_ASSINATURA })]) === ACAO_FISCAL.REENVIAR,
  "error com XML sem assinatura (sem certificado: o envio exige assinatura) → nunca saiu para a SEFAZ → Reenviar",
);
check(
  acao([doc("error", { xml_signed: ASSINADO, authorizer_response: { cStat: "217", xMotivo: "NF-e não consta na base" } })]) === ACAO_FISCAL.REENVIAR,
  "error com a SEFAZ confirmando que NÃO autorizou (reconciliação gravou cStat 217) → Reenviar",
);
check(
  acao([doc("error", { xml_signed: ASSINADO, authorizer_response: { cStat: "100", xMotivo: "Autorizado" } })]) === ACAO_FISCAL.CONSULTAR &&
    acao([doc("error", { xml_signed: ASSINADO, authorizer_response: { cStat: "150" } })]) === ACAO_FISCAL.CONSULTAR,
  "error cuja resposta registrada é cStat 100/150 (autorizada) → jamais Reenviar",
);
check(
  acao([doc("error", { xml_signed: ASSINADO, authorizer_response: "texto solto" })]) === ACAO_FISCAL.CONSULTAR,
  "error com resposta que não dá para ler → incerto, não reenvia",
);
check(
  acao([doc("rejected")]) === ACAO_FISCAL.CONSULTAR && acao([doc("rejected", { rejection_code: "100" })]) === ACAO_FISCAL.CONSULTAR,
  "rejected sem código de rejeição (ou com código de autorização) não é rejeição provada → não reenvia",
);
const antigoIncerto = { ...incerto, id: "velho", created_at: "2026-10-04T14:00:00Z" };
const novoRejeitado = doc("rejected", { id: "novo", rejection_code: "391", created_at: "2026-10-04T15:00:00Z" });
check(
  acao([antigoIncerto, novoRejeitado]) === ACAO_FISCAL.CONSULTAR,
  "tentativa antiga incerta + tentativa nova rejeitada → continua sem Reenviar (a antiga pode estar autorizada)",
);
check(
  acao([antigoIncerto, doc("authorized", { id: "ok", created_at: "2026-10-04T16:00:00Z" })]) === ACAO_FISCAL.AUTORIZADA,
  "tentativa antiga incerta + tentativa nova autorizada → vale a autorizada",
);
check(
  acao([antigoIncerto, doc("transmitting", { id: "t", xml_signed: ASSINADO, created_at: "2026-10-04T17:00:00Z" })]) === ACAO_FISCAL.RECONCILIAR,
  "transmitting tem prioridade: reconcilia antes de qualquer nova tentativa",
);
for (const [nome, docs] of [
  ["incerto", [incerto]],
  ["transmitting", [doc("transmitting")]],
  ["em andamento", [doc("pending")]],
]) {
  check(![ACAO_FISCAL.EMITIR, ACAO_FISCAL.REENVIAR].includes(acao(docs)), `estado ${nome}: nunca resulta em Emitir/Reenviar`);
}
check(
  podeReenviar(doc("authorized")) === false && podeReenviar(doc("transmitting")) === false && podeReenviar(null) === false,
  "podeReenviar é falso para autorizado, transmitting e nulo",
);

// ---------- 2. qual documento vale ----------
const antigo = doc("rejected", { id: "a", created_at: "2026-10-04T14:00:00Z" });
const recente = doc("error", { id: "b", created_at: "2026-10-04T15:00:00Z" });
const autorizado = doc("authorized", { id: "c", created_at: "2026-10-04T13:00:00Z" });
check(escolherDocumentoNfce([antigo, recente])?.id === "b", "sem autorizado, vale a tentativa mais recente");
check(escolherDocumentoNfce([antigo, autorizado, recente])?.id === "c", "com autorizado, ele vale mesmo havendo tentativas mais novas");
check(
  escolherDocumentoNfce([{ ...antigo, model: "55" }, { ...recente, model: "nfse" }]) === null && escolherDocumentoNfce([]) === null && escolherDocumentoNfce(null) === null,
  "NF-e/NFS-e e lista vazia não contam como NFC-e",
);
check(acao([{ ...incerto, model: "55" }]) === ACAO_FISCAL.EMITIR, "documento de NF-e não influencia a NFC-e da venda");

let filtro = null;
const apiFalsa = { entities: { FiscalDocument: { filter: async (f) => ((filtro = f), [recente]) } } };
check(
  (await buscarDocumentosNfceDaVenda(apiFalsa, venda.id)).length === 1 && filtro.sale_id === venda.id && filtro.model === "65" && !("status" in filtro),
  "a busca traz os documentos da venda em qualquer status (não só autorizado)",
);
filtro = null;
check((await buscarDocumentosNfceDaVenda(apiFalsa, "id-offline-123")).length === 0 && filtro === null, "venda offline sem UUID não consulta nem tem nota");

// ---------- 3. XML baixado = nfeProc guardado ----------
const nfeProc = `<?xml version="1.0" encoding="UTF-8"?><nfeProc versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe"><NFe></NFe><protNFe versao="4.00"></protNFe></nfeProc>`;
const soap = `<?xml version='1.0' encoding='UTF-8'?><env:Envelope><env:Body><retEnviNFe><protNFe versao="4.00"></protNFe></retEnviNFe></env:Body></env:Envelope>`;
const autorizada = { model: "65", status: "authorized", access_key: CHAVE, xml_authorized: nfeProc };

let baixado = null;
let blobGerado = null;
globalThis.document = { createElement: () => ({ click() { baixado = { nome: this.download }; } }) };
const urlOriginal = URL.createObjectURL;
URL.createObjectURL = (blob) => ((blobGerado = blob), "blob:teste");
check(xmlDisponivel(autorizada), "NFC-e autorizada com nfeProc → 'Baixar XML' habilitado");
baixarXmlNfce(autorizada);
check(baixado?.nome === `${CHAVE}.xml` && (await blobGerado.text()) === nfeProc, "o arquivo baixado é exatamente o nfeProc autorizado guardado, como <chave>.xml");
baixado = null;
let erro = null;
try {
  baixarXmlNfce({ ...autorizada, xml_authorized: soap });
} catch (e) {
  erro = e.message;
}
check(
  erro === MSG_XML_INDISPONIVEL && baixado === null && !xmlDisponivel({ ...autorizada, xml_authorized: soap }),
  "nota com só a resposta SOAP: botão desabilitado e nada é baixado (nunca entrega o SOAP bruto)",
);
URL.createObjectURL = urlOriginal;
delete globalThis.document;

// ---------- 4. código ----------
const dialogo = ler("src/components/sales/SaleDetailDialog.jsx");
check(dialogo.includes('import NfceDialog from "@/components/pos/NfceDialog";') && dialogo.includes("<NfceDialog"), "o detalhe da venda reutiliza o NfceDialog existente (Emitir/Reenviar/Reconciliar)");
check(dialogo.includes("baixarXmlNfce(fiscalDoc)") && dialogo.includes("xmlDisponivel(fiscalDoc)") && dialogo.includes("Baixar XML"), "Baixar XML usa o helper existente sobre o documento guardado");
check(dialogo.includes("abrirNfceDanfePdf") && dialogo.includes("Reimprimir DANFE") && dialogo.includes('"Cancelar NFC-e"'), "autorizada mantém DANFE e Cancelar NFC-e");
check(
  dialogo.includes("analisarNfceDaVenda(fiscalDocs, sale, { nfceHabilitada: nfceHab })") && dialogo.includes("config?.nfce_enabled"),
  "o botão sai dos documentos reais da venda e da habilitação da NFC-e",
);
check(
  dialogo.includes("ACAO_FISCAL.CONSULTAR") && dialogo.includes("Não reenvie") && dialogo.includes("analise.chave"),
  "estado incerto: a tela orienta a consultar a chave e não oferece botão de envio",
);
check(!/functions\.invoke|supabase\.functions|fiscalEmit|emitirDocumento\(/.test(dialogo), "o detalhe da venda não chama a emissão por conta própria (só pelo NfceDialog)");
const dlgNfce = ler("src/components/pos/NfceDialog.jsx");
check(dlgNfce.split("emitirDocumento({").length === 2 && dlgNfce.includes('acao = "emitir"'), "NfceDialog continua com uma única chamada de emissão; 'acao' só troca os textos");
check(
  dlgNfce.includes("const enviando = useRef(false);") && dlgNfce.includes("if (enviando.current) return;") && dlgNfce.includes("enviando.current = false;"),
  "NfceDialog tem trava síncrona contra clique duplo (um único envio ao fiscal-emit)",
);
const helper = ler("src/lib/acoesFiscaisVenda.js");
// Sem chamada de rede nem de função: as mensagens ao usuário podem citar a SEFAZ, o que não pode é falar com ela.
check(!/fetch\(|\.functions|invoke\(|https?:\/\//i.test(helper.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")), "a lógica dos botões é pura: sem rede nem chamada à SEFAZ");

// ---------- 5. cancelamento: estado fiscal incerto bloqueia (executando cancelarVendaCompleta de verdade) ----------
// O módulo importa "@/..." e o dataClient; um hook de resolução troca só o dataClient e o fiscalConfig
// por simulações (sem rede nem SEFAZ). O resto é o código real.
const MENSAGEM = "Não é possível cancelar esta venda enquanto o status fiscal estiver incerto. Consulte a NFC-e pela chave de acesso antes de prosseguir.";
const mocks = {
  // lê o mock a cada acesso: cada caso monta o seu
  "@/api/dataClient": "export const api = { entities: new Proxy({}, { get: (_, k) => globalThis.__mock.api.entities[k] }) };",
  "@/lib/fiscalConfig":
    "export const bloqueioFiscalDaVenda = (...a) => globalThis.__mock.bloqueio(...a);" +
    "export const cancelarDocumento = (...a) => globalThis.__mock.cancelarDocumento(...a);" +
    "export const carregarConfigFiscal = async () => ({ uf: 'GO' });",
};
const raiz = new URL("../src/", import.meta.url).href;
const hooks = `
const mocks = ${JSON.stringify(mocks)};
export async function resolve(s, c, n) {
  if (mocks[s]) return { url: "data:text/javascript," + encodeURIComponent(mocks[s]), shortCircuit: true };
  if (s.startsWith("@/")) return { url: ${JSON.stringify(raiz)} + s.slice(2) + ".js", shortCircuit: true };
  return n(s, c);
}`;
const { register } = await import("node:module");
register("data:text/javascript," + encodeURIComponent(hooks));

const chamadas = [];
const montarMock = ({ docs, bloqueio = null, falhaNaConsulta = false }) => {
  chamadas.length = 0;
  const anota = (nome, retorno) => async (...args) => (chamadas.push(nome), typeof retorno === "function" ? retorno(...args) : retorno);
  globalThis.__mock = {
    api: {
      entities: {
        FiscalDocument: { filter: async () => (falhaNaConsulta ? Promise.reject(new Error("rede")) : docs) },
        Product: { get: anota("Product.get", { stock: 5 }), bulkUpdate: anota("Product.bulkUpdate", null) },
        Sale: { update: anota("Sale.update", null) },
        Customer: { get: anota("Customer.get", { credit_balance: 0 }), update: anota("Customer.update", null) },
      },
    },
    bloqueio: async () => bloqueio,
    cancelarDocumento: anota("cancelarDocumento", { status: "cancelled", protocol: "152260027755555" }),
  };
};
montarMock({ docs: [] }); // os módulos simulados leem globalThis.__mock já na importação
const { cancelarVendaCompleta, ErroCancelamento } = await import("../src/lib/saleCancellation.js");
const vendaCancel = { id: venda.id, status: "concluida", items: [{ product_id: "p1", quantity: 2 }], payment_method: "dinheiro", total: 1 };
const tenta = async (cfg, opcoes) => {
  montarMock(cfg);
  try {
    await cancelarVendaCompleta(vendaCancel, opcoes);
    return { ok: true };
  } catch (e) {
    return { ok: false, erro: e };
  }
};
const nadaCancelado = () => !chamadas.some((c) => ["cancelarDocumento", "Product.bulkUpdate", "Sale.update", "Customer.update"].includes(c));

let r = await tenta({ docs: [incerto] }, { justificativa: "Teste de cancelamento em homologação" });
check(
  !r.ok && r.erro instanceof ErroCancelamento && r.erro.message === MENSAGEM && r.erro.etapa === "nota" && nadaCancelado(),
  "estado fiscal incerto: o cancelamento é recusado com o aviso exato e NADA é cancelado (nem nota, nem estoque, nem venda)",
);
r = await tenta({ docs: [antigoIncerto, novoRejeitado] }, { justificativa: "Teste de cancelamento em homologação" });
check(!r.ok && r.erro.message === MENSAGEM && nadaCancelado(), "tentativa antiga incerta + nova rejeitada: continua bloqueado");
r = await tenta({ docs: [incerto], falhaNaConsulta: true }, {});
check(!r.ok && r.erro instanceof ErroCancelamento && r.erro.message.includes("Não foi possível verificar") && nadaCancelado(), "se o status fiscal não puder ser verificado, não cancela (nunca cancela sem saber)");
r = await tenta({ docs: [] }, {});
check(r.ok && chamadas.includes("Sale.update") && chamadas.includes("Product.bulkUpdate"), "venda sem nota fiscal: cancelamento normal (estoque volta e a venda é cancelada)");
r = await tenta({ docs: [doc("error", { xml_signed: null })] }, {});
check(r.ok && chamadas.includes("Sale.update"), "error seguro (nada foi enviado): cancelamento normal");
r = await tenta({ docs: [doc("error", { xml_signed: ASSINADO, authorizer_response: { cStat: "217" } })] }, {});
check(r.ok && chamadas.includes("Sale.update"), "error com a SEFAZ confirmando que não autorizou: cancelamento normal");
r = await tenta({ docs: [doc("rejected", { rejection_code: "391" })] }, {});
check(r.ok && chamadas.includes("Sale.update"), "rejeitada pela SEFAZ: cancelamento normal");
const notaAutorizada = doc("authorized", { id: "aut", model: "65", authorized_at: new Date().toISOString(), number: 5 });
r = await tenta({ docs: [antigoIncerto, notaAutorizada], bloqueio: { document: notaAutorizada } }, { justificativa: "Teste de cancelamento em homologação" });
check(
  r.ok && chamadas.indexOf("cancelarDocumento") !== -1 && chamadas.indexOf("cancelarDocumento") < chamadas.indexOf("Sale.update"),
  "nota autorizada (mesmo com tentativa antiga incerta): segue o fluxo normal, cancela a nota na SEFAZ primeiro e depois a venda",
);
delete globalThis.__mock;

const cancelamento = ler("src/lib/saleCancellation.js");
check(
  cancelamento.includes("estadoFiscalImpedeDesfazer(api, sale.id)") &&
    cancelamento.indexOf("estadoFiscalImpedeDesfazer(api, sale.id)") < cancelamento.indexOf("await bloqueioFiscalDaVenda(sale.id)") &&
    cancelamento.indexOf("estadoFiscalImpedeDesfazer(api, sale.id)") < cancelamento.indexOf("cancelarDocumento({"),
  "a checagem do estado fiscal vem antes de qualquer cancelamento (nota ou venda)",
);
check(
  dialogo.includes("disabled={!!prazoNota?.expirado || !!bloqueioFiscal}") && dialogo.includes("mensagemBloqueioDesfazer(acaoFiscal)") && dialogo.includes("title={bloqueioFiscal ||"),
  "no detalhe da venda o botão Cancelar fica desabilitado com NFC-e sem resolução, com o aviso na tela e na dica",
);

console.log("\nSmoke — ações fiscais no detalhe da venda (Gerenciador)\n");
for (const m of ok) console.log(`  PASS  ${m}`);
for (const m of falhas) console.log(`  FAIL  ${m}`);
console.log(`\n${ok.length} passaram, ${falhas.length} falharam\n`);
process.exit(falhas.length ? 1 : 0);
