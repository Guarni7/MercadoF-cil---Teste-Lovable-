/**
 * Smoke do bloqueio de CANCELAR VENDA e DEVOLVER/TROCAR com a NFC-e ainda sem resolução (sem rede).
 *
 * Desfazer uma venda devolve estoque e dinheiro. Com a NFC-e incerta, em transmissão ou em
 * andamento, a SEFAZ pode autorizar depois, e ficaria uma nota válida sem venda (o fiscal-document
 * só cancela documento `authorized`).
 *
 * 1. estadoFiscalImpedeDesfazer: authorized, rejected, error seguro e sem documento seguem;
 *    transmitting, pending/draft/validating e error incerto bloqueiam; falha de leitura lança erro.
 * 2. cancelarVendaCompleta EXECUTADA de verdade (API e fiscalConfig simulados): bloqueado → nenhum
 *    cancelamento na SEFAZ, nenhuma alteração de venda, estoque ou financeiro.
 * 3. Devolução/troca e detalhe da venda: ordem e presença das checagens no código.
 *
 * Uso: node scripts/smoke-bloqueio-fiscal-desfazer.mjs
 */
import { readFileSync } from "fs";
import { resolve } from "path";
import { register } from "node:module";
import {
  MSG_CANCELAMENTO_BLOQUEADO,
  MSG_DEVOLUCAO_BLOQUEADA,
  MSG_EM_ANDAMENTO_BLOQUEADO,
  MSG_FISCAL_NAO_VERIFICADO,
  MSG_TRANSMITINDO_BLOQUEADO,
  estadoFiscalImpedeDesfazer,
  mensagemBloqueioDesfazer,
} from "../src/lib/acoesFiscaisVenda.js";

const falhas = [];
const ok = [];
const check = (cond, msg) => (cond ? ok.push(msg) : falhas.push(msg));
const ler = (p) => readFileSync(resolve(process.cwd(), p), "utf8").split("\r\n").join("\n");

const ID = "1f970624-6784-4d77-a45f-fe2750595a9d";
const CHAVE = "52261052481599000126650010000000051928064644";
const ASSINADO = `<NFe><infNFe Id="NFe${CHAVE}"></infNFe><Signature></Signature></NFe>`;
const doc = (status, extra = {}) => ({ id: `doc-${status}`, model: "65", status, ...extra });
const apiCom = (docs) => ({ entities: { FiscalDocument: { filter: async () => docs } } });

// ---------- 1. a regra ----------
const estado = (docs) => estadoFiscalImpedeDesfazer(apiCom(docs), ID);
let r = await estado([doc("transmitting", { xml_signed: ASSINADO })]);
check(r.bloqueado && r.mensagem === MSG_TRANSMITINDO_BLOQUEADO && r.mensagem.includes("Reconcilie a NFC-e primeiro") && r.chave === CHAVE, "transmitting → BLOQUEIA, manda reconciliar primeiro e mostra a chave");
for (const s of ["pending", "draft", "validating"]) {
  r = await estado([doc(s)]);
  check(r.bloqueado && r.mensagem === MSG_EM_ANDAMENTO_BLOQUEADO && /Aguarde a resposta da SEFAZ/.test(r.mensagem), `${s} → BLOQUEIA e manda aguardar o autorizador`);
}
r = await estado([doc("error", { xml_signed: ASSINADO, authorizer_response: null })]);
check(r.bloqueado && r.mensagem === MSG_CANCELAMENTO_BLOQUEADO && r.chave === CHAVE, "error incerto → BLOQUEIA com a mensagem já existente e a chave");
r = await estado([doc("authorized")]);
check(!r.bloqueado && r.mensagem === null, "authorized → segue o fluxo atual (a nota é cancelada primeiro)");
check(!(await estado([doc("rejected", { rejection_code: "391" })])).bloqueado, "rejected → permite");
check(!(await estado([doc("error", { xml_signed: null })])).bloqueado, "error seguro (nada enviado) → permite");
check(!(await estado([doc("error", { xml_signed: ASSINADO, authorizer_response: { cStat: "217" } })])).bloqueado, "error com a SEFAZ confirmando que não autorizou → permite");
check(!(await estado([])).bloqueado, "sem documento fiscal → permite");
check(!(await estado([doc("cancelled")])).bloqueado, "nota já cancelada → permite");
check(!(await estado([doc("error", { xml_signed: ASSINADO }), doc("authorized", { id: "ok" })])).bloqueado, "autorizada existente → segue o fluxo atual");
check((await estado([doc("error", { id: "velho", xml_signed: ASSINADO, created_at: "2026-10-04T14:00:00Z" }), doc("rejected", { id: "novo", rejection_code: "391", created_at: "2026-10-04T15:00:00Z" })])).bloqueado, "tentativa antiga incerta + nova rejeitada → continua bloqueado");
check((await estado([doc("transmitting"), doc("error", { id: "o", xml_signed: ASSINADO })])).mensagem === MSG_TRANSMITINDO_BLOQUEADO, "transmitting e incerto juntos → manda reconciliar (a reconciliação resolve os dois)");
let falhou = null;
try {
  await estadoFiscalImpedeDesfazer({ entities: { FiscalDocument: { filter: async () => Promise.reject(new Error("rede")) } } }, ID);
} catch (e) {
  falhou = e;
}
check(falhou?.message === "rede", "falha de leitura → lança erro (quem chama bloqueia)");
check(
  mensagemBloqueioDesfazer("autorizada") === null && mensagemBloqueioDesfazer("reenviar") === null && mensagemBloqueioDesfazer("emitir") === null && mensagemBloqueioDesfazer("nenhuma") === null,
  "mensagemBloqueioDesfazer só bloqueia consultar, reconciliar e em_andamento",
);

// ---------- 2. cancelarVendaCompleta executada de verdade ----------
const mocks = {
  "@/api/dataClient": "export const api = { entities: new Proxy({}, { get: (_, k) => globalThis.__mock.api.entities[k] }) };",
  "@/lib/fiscalConfig":
    "export const bloqueioFiscalDaVenda = (...a) => globalThis.__mock.bloqueio(...a);" +
    "export const cancelarDocumento = (...a) => globalThis.__mock.cancelarDocumento(...a);" +
    "export const carregarConfigFiscal = async () => ({ uf: 'GO' });",
};
const raiz = new URL("../src/", import.meta.url).href;
register(
  "data:text/javascript," +
    encodeURIComponent(`const mocks = ${JSON.stringify(mocks)};
export async function resolve(s, c, n) {
  if (mocks[s]) return { url: "data:text/javascript," + encodeURIComponent(mocks[s]), shortCircuit: true };
  if (s.startsWith("@/")) return { url: ${JSON.stringify(raiz)} + s.slice(2) + ".js", shortCircuit: true };
  return n(s, c);
}`),
);
const chamadas = [];
const montarMock = ({ docs, bloqueio = null, falhaNaConsulta = false }) => {
  chamadas.length = 0;
  const anota = (nome, retorno) => async () => (chamadas.push(nome), retorno);
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
montarMock({ docs: [] });
const { cancelarVendaCompleta, ErroCancelamento } = await import("../src/lib/saleCancellation.js");
const venda = { id: ID, status: "concluida", items: [{ product_id: "p1", quantity: 2 }], payment_method: "dinheiro", total: 1 };
const tenta = async (cfg, opcoes = {}) => {
  montarMock(cfg);
  try {
    await cancelarVendaCompleta(venda, opcoes);
    return { ok: true };
  } catch (e) {
    return { ok: false, erro: e };
  }
};
const nadaAlterado = () => chamadas.length === 0 || chamadas.every((c) => !["cancelarDocumento", "Product.bulkUpdate", "Sale.update", "Customer.update", "Customer.get", "Product.get"].includes(c));
const JUSTIFICATIVA = "Teste de cancelamento em homologação";

for (const [nome, docs, mensagem] of [
  ["transmitting", [doc("transmitting", { xml_signed: ASSINADO })], MSG_TRANSMITINDO_BLOQUEADO],
  ["pending", [doc("pending")], MSG_EM_ANDAMENTO_BLOQUEADO],
  ["draft", [doc("draft")], MSG_EM_ANDAMENTO_BLOQUEADO],
  ["validating", [doc("validating")], MSG_EM_ANDAMENTO_BLOQUEADO],
  ["error incerto", [doc("error", { xml_signed: ASSINADO, authorizer_response: null })], MSG_CANCELAMENTO_BLOQUEADO],
]) {
  const x = await tenta({ docs }, { justificativa: JUSTIFICATIVA });
  check(
    !x.ok && x.erro instanceof ErroCancelamento && x.erro.message === mensagem && x.erro.etapa === "nota" && nadaAlterado(),
    `cancelar venda com a NFC-e ${nome}: recusa com a orientação e NADA muda (sem SEFAZ, venda, estoque ou crediário)`,
  );
}
let x = await tenta({ docs: [doc("transmitting", { xml_signed: ASSINADO })], bloqueio: null }, {});
check(!x.ok && chamadas.length === 0, "bloqueado: nem o estoque é lido (a checagem vem antes de qualquer ação)");
x = await tenta({ docs: [], falhaNaConsulta: true }, {});
check(!x.ok && x.erro.message === MSG_FISCAL_NAO_VERIFICADO && nadaAlterado(), "falha na consulta fiscal: bloqueia por segurança e nada é cancelado");

x = await tenta({ docs: [] });
check(x.ok && chamadas.includes("Sale.update") && chamadas.includes("Product.bulkUpdate"), "sem documento fiscal: cancelamento normal");
x = await tenta({ docs: [doc("rejected", { rejection_code: "391" })] });
check(x.ok && chamadas.includes("Sale.update"), "NFC-e rejeitada: cancelamento normal");
x = await tenta({ docs: [doc("error", { xml_signed: null })] });
check(x.ok && chamadas.includes("Sale.update"), "error seguro (nada enviado): cancelamento normal");
x = await tenta({ docs: [doc("error", { xml_signed: ASSINADO, authorizer_response: { cStat: "217" } })] });
check(x.ok && chamadas.includes("Sale.update"), "error com a SEFAZ confirmando que não autorizou: cancelamento normal");
const autorizada = doc("authorized", { id: "aut", authorized_at: new Date().toISOString(), number: 5 });
x = await tenta({ docs: [autorizada], bloqueio: { document: autorizada } }, { justificativa: JUSTIFICATIVA });
check(
  x.ok && chamadas.indexOf("cancelarDocumento") !== -1 && chamadas.indexOf("cancelarDocumento") < chamadas.indexOf("Sale.update"),
  "NFC-e autorizada: fluxo atual (cancela a nota na SEFAZ primeiro, depois a venda)",
);
delete globalThis.__mock;

// ---------- 3. código ----------
const cancelamento = ler("src/lib/saleCancellation.js");
const iGuarda = cancelamento.indexOf("estadoFiscalImpedeDesfazer(api, sale.id)");
check(iGuarda !== -1 && iGuarda < cancelamento.indexOf("await bloqueioFiscalDaVenda(sale.id)") && iGuarda < cancelamento.indexOf("Product.get("), "cancelarVendaCompleta confere o estado fiscal antes de qualquer ação");

const devolucao = ler("src/components/sales/ReturnExchangeDialog.jsx");
check(devolucao.includes('import { ACAO_FISCAL, MSG_DEVOLUCAO_BLOQUEADA, MSG_FISCAL_NAO_VERIFICADO, estadoFiscalImpedeDesfazer } from "@/lib/acoesFiscaisVenda";'), "a devolução usa o helper compartilhado (sem regra fiscal própria)");
check(!/podeReenviar|analisarNfceDaVenda|authorizer_response|xml_signed/.test(devolucao), "a tela de devolução não repete a regra de estado fiscal");
const iSelecionar = devolucao.indexOf("const selectSale = async");
const iConferirNaSelecao = devolucao.indexOf("await conferirEstadoFiscal(sale.id)");
check(iConferirNaSelecao > iSelecionar && iConferirNaSelecao < devolucao.indexOf("api.entities.SaleReturn.filter("), "ao selecionar a venda o estado fiscal é conferido");
const iSubmit = devolucao.indexOf("const handleSubmit = async");
const iConferirNoSubmit = devolucao.indexOf("await conferirEstadoFiscal(selectedSale.id)");
const iRegistrar = devolucao.indexOf("await registrarDevolucao()");
check(iConferirNoSubmit > iSubmit && iRegistrar > iConferirNoSubmit, "handleSubmit confere de novo antes de registrar a devolução");
const iCorpo = devolucao.indexOf("const registrarDevolucao = async");
check(
  iCorpo > iRegistrar &&
    ["await cancelarDocumento(", "api.entities.SaleReturn.create(", "api.stock.applyMovement(", "setSubmitting(true)"].every((t) => devolucao.indexOf(t) > iCorpo),
  "criar devolução, mexer no estoque/financeiro e cancelar a nota só existem depois da checagem (dentro de registrarDevolucao)",
);
check(/if \(bloqueio\) \{\s*toast\.error\(bloqueio\.mensagem\);\s*return;\s*\}/.test(devolucao), "bloqueado: mostra o aviso e interrompe sem registrar nada");
check(devolucao.includes("!!estadoFiscal}") && devolucao.includes("Devolução bloqueada: status fiscal sem resolução"), "com bloqueio, o botão de confirmar fica desabilitado e a tela explica");
check(
  devolucao.includes("MSG_DEVOLUCAO_BLOQUEADA") && devolucao.includes("r.acao === ACAO_FISCAL.CONSULTAR ? MSG_DEVOLUCAO_BLOQUEADA : r.mensagem"),
  "na devolução/troca o error incerto usa a mensagem de devolver/trocar, não a de cancelar a venda",
);
check(
  MSG_DEVOLUCAO_BLOQUEADA.includes("devolver ou trocar") && !MSG_DEVOLUCAO_BLOQUEADA.includes("cancelar esta venda") && MSG_CANCELAMENTO_BLOQUEADO.includes("cancelar esta venda"),
  "a mensagem da devolução fala em devolver ou trocar; a do cancelamento continua falando em cancelar a venda",
);
check(
  estadoFiscalImpedeDesfazer.length === 2 && (await estado([doc("error", { xml_signed: ASSINADO, authorizer_response: null })])).mensagem === MSG_CANCELAMENTO_BLOQUEADO,
  "o helper compartilhado continua devolvendo a mensagem de cancelamento (o cancelamento da venda não mudou)",
);
check(devolucao.includes("const submetendo = useRef(false);") && devolucao.includes("if (submetendo.current) return;"), "clique duplo não dispara duas devoluções");
check(devolucao.includes("MSG_FISCAL_NAO_VERIFICADO") && devolucao.includes("mensagem: MSG_FISCAL_NAO_VERIFICADO"), "falha na consulta fiscal bloqueia a devolução por segurança");

const detalhe = ler("src/components/sales/SaleDetailDialog.jsx");
check(
  detalhe.includes("mensagemBloqueioDesfazer(acaoFiscal)") && detalhe.includes("disabled={!!prazoNota?.expirado || !!bloqueioFiscal}") && detalhe.includes("{bloqueioFiscal}"),
  "no detalhe da venda o botão Cancelar fica desabilitado, com o aviso, quando a NFC-e está incerta, em transmissão ou em andamento",
);

console.log("\nSmoke — bloqueio de cancelar/devolver com a NFC-e sem resolução\n");
for (const m of ok) console.log(`  PASS  ${m}`);
for (const m of falhas) console.log(`  FAIL  ${m}`);
console.log(`\n${ok.length} passaram, ${falhas.length} falharam\n`);
process.exit(falhas.length ? 1 : 0);
