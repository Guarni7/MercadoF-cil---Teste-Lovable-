/**
 * Smoke do "Tentar novamente" da finalização (NfceDialog) com estado fiscal incerto (sem rede).
 *
 * O fiscal-emit só reconcilia um documento em `transmitting`; um novo pedido sobre um `error` cria
 * OUTRA nota com OUTRO número. Se o `error` veio de falha depois do envio, a SEFAZ pode ter
 * autorizado, e emitir de novo duplica a NFC-e. O NfceDialog (finalização e Gerenciador) agora
 * confere o estado fiscal real da venda, com a mesma regra do Gerenciador, antes de qualquer
 * pedido de emissão e depois de qualquer erro.
 *
 * 1. podeTentarEmitirDeNovo: incerto bloqueia (com a chave); seguro, transmitting e sem documento
 *    permitem; falha de leitura bloqueia só aquela tentativa (sem esconder o botão).
 * 2. Código: a checagem vem antes do emitirDocumento, o botão some no incerto, e não há regra paralela.
 *
 * Uso: node scripts/smoke-finalizacao-nfce-incerto.mjs
 */
import { readFileSync } from "fs";
import { resolve } from "path";
import { MSG_ESTADO_INCERTO, MSG_ESTADO_NAO_VERIFICADO, podeTentarEmitirDeNovo } from "../src/lib/acoesFiscaisVenda.js";

const falhas = [];
const ok = [];
const check = (cond, msg) => (cond ? ok.push(msg) : falhas.push(msg));
const ler = (p) => readFileSync(resolve(process.cwd(), p), "utf8").split("\r\n").join("\n");

const ID = "1f970624-6784-4d77-a45f-fe2750595a9d";
const CHAVE = "52261052481599000126650010000000051928064644";
const ASSINADO = `<NFe><infNFe Id="NFe${CHAVE}"></infNFe><Signature></Signature></NFe>`;
const doc = (status, extra = {}) => ({ id: `doc-${status}`, model: "65", status, ...extra });
const apiCom = (docs) => ({ entities: { FiscalDocument: { filter: async () => docs } } });
const apiQueFalha = { entities: { FiscalDocument: { filter: async () => Promise.reject(new Error("rede")) } } };

// silencia o console.error esperado da falha de leitura
const errOriginal = console.error;
console.error = () => {};

// ---------- 1. regra ----------
let r = await podeTentarEmitirDeNovo(apiCom([doc("error", { xml_signed: ASSINADO, authorizer_response: null })]), ID);
check(
  !r.permitido && r.motivo === "incerto" && r.chave === CHAVE && r.mensagem === MSG_ESTADO_INCERTO && r.mensagem.includes("Não reenvie"),
  "error depois do envio (XML assinado, sem resposta da SEFAZ) → NÃO permite nova emissão; devolve a chave e o aviso",
);
r = await podeTentarEmitirDeNovo(apiCom([doc("error", { xml_signed: null })]), ID);
check(r.permitido && r.motivo === null, "error de validação/certificado (nada foi enviado) → permite tentar de novo");
r = await podeTentarEmitirDeNovo(apiCom([doc("error", { xml_signed: ASSINADO, authorizer_response: { cStat: "217" } })]), ID);
check(r.permitido, "error com a SEFAZ confirmando que NÃO autorizou (cStat 217) → permite");
r = await podeTentarEmitirDeNovo(apiCom([doc("error", { xml_signed: ASSINADO, authorizer_response: { cStat: "100" } })]), ID);
check(!r.permitido && r.motivo === "incerto", "error cuja resposta registrada é cStat 100 → nunca permite");
r = await podeTentarEmitirDeNovo(apiCom([doc("transmitting", { xml_signed: ASSINADO })]), ID);
check(r.permitido, "transmitting → permite (o fiscal-emit reconcilia em vez de emitir outra nota)");
r = await podeTentarEmitirDeNovo(apiCom([]), ID);
check(r.permitido, "sem documento nenhum (primeira emissão) → permite");
r = await podeTentarEmitirDeNovo(apiCom([doc("rejected", { rejection_code: "391" })]), ID);
check(r.permitido, "rejeitada pela SEFAZ → permite (já era reenviável)");
r = await podeTentarEmitirDeNovo(
  apiCom([doc("error", { id: "velho", xml_signed: ASSINADO, created_at: "2026-10-04T14:00:00Z" }), doc("rejected", { id: "novo", rejection_code: "391", created_at: "2026-10-04T15:00:00Z" })]),
  ID,
);
check(!r.permitido && r.motivo === "incerto", "tentativa antiga incerta + nova rejeitada → continua bloqueado (a antiga pode estar autorizada)");
r = await podeTentarEmitirDeNovo(apiCom([doc("error", { xml_signed: ASSINADO }), doc("authorized", { id: "ok" })]), ID);
check(r.permitido, "autorizada existente → não bloqueia (o servidor responde already_authorized)");
r = await podeTentarEmitirDeNovo(apiQueFalha, ID);
check(
  !r.permitido && r.motivo === "verificacao" && r.mensagem === MSG_ESTADO_NAO_VERIFICADO && r.doc === null,
  "falha ao ler o estado fiscal → não envia esta tentativa e avisa; motivo 'verificacao' (não esconde o botão)",
);
r = await podeTentarEmitirDeNovo(apiCom([doc("error", { xml_signed: ASSINADO })]), "id-offline");
check(r.permitido, "venda offline sem UUID não tem documento (o diálogo já recusa antes por falta de id)");
console.error = errOriginal;

// ---------- 2. código ----------
const dialogo = ler("src/components/pos/NfceDialog.jsx");
const iCheca = dialogo.indexOf("await podeTentarEmitirDeNovo(api, sale.id)");
const iEmite = dialogo.indexOf("await emitirDocumento({");
check(iCheca !== -1 && iEmite !== -1 && iCheca < iEmite, "emitir() confere o estado fiscal ANTES de pedir a emissão ao fiscal-emit");
check(dialogo.includes("if (!seguranca.permitido) {") && /if \(!seguranca\.permitido\) \{[^}]*return;/.test(dialogo), "estado incerto (ou não verificado) interrompe emitir(): o fiscal-emit não é chamado");
check(dialogo.split("emitirDocumento({").length === 2, "continua uma única chamada de emissão no diálogo");
check(
  dialogo.includes('seguranca.motivo === "incerto") setBloqueio(seguranca)') && dialogo.includes('bloqueio?.motivo !== "incerto" && ('),
  "depois de um erro o estado é conferido de novo e, se incerto, o botão 'Tentar novamente' some",
);
check(dialogo.includes("bloqueio.mensagem") && dialogo.includes("bloqueio.chave"), "a tela mostra o aviso e a chave de acesso para consulta");
check(dialogo.includes("const enviando = useRef(false);") && dialogo.includes("if (enviando.current) return;"), "a trava contra clique duplo continua");
check(!/podeReenviar|analisarNfceDaVenda|authorizer_response|xml_signed/.test(dialogo), "o diálogo não tem regra de estado fiscal própria (só usa o helper compartilhado)");
const helper = ler("src/lib/acoesFiscaisVenda.js");
check(helper.includes("statusFiscalIncerto(api, saleId)") && helper.split("export async function statusFiscalIncerto").length === 2, "podeTentarEmitirDeNovo reaproveita o statusFiscalIncerto do cancelamento (mesma regra)");

console.log("\nSmoke — Tentar novamente da finalização com estado fiscal incerto\n");
for (const m of ok) console.log(`  PASS  ${m}`);
for (const m of falhas) console.log(`  FAIL  ${m}`);
console.log(`\n${ok.length} passaram, ${falhas.length} falharam\n`);
process.exit(falhas.length ? 1 : 0);
