/**
 * Smoke do checkout por canal de cartão (PR 2): maquininha independente, TEF/PIN pad e
 * Smart POS (ConnectTEF), com o canal escolhido na configuração da empresa.
 *
 * O projeto não tem teste de componente, então aqui ficam (1) a lógica pura que decide o
 * canal e o que ele permite, e (2) checagens do código do checkout, do painel da maquininha,
 * do hook e do PDV: cada regra do desenho precisa estar escrita no código. O comportamento no
 * DOM de verdade (cada canal, online e offline, aprovado/recusado/indisponível) foi exercitado
 * com uma página temporária que monta o CheckoutDialog real com a rede simulada.
 *
 * Uso: node scripts/smoke-card-checkout.mjs
 */
import { readFileSync } from "fs";
import { resolve } from "path";
import { resolverCanalCartao, canalDecidido, canalDoPagamento } from "../src/lib/cardChannel.js";

const falhas = [];
const ok = [];
const check = (cond, msg) => (cond ? ok.push(msg) : falhas.push(msg));
const ler = (p) => readFileSync(resolve(process.cwd(), p), "utf8").split("\r\n").join("\n");
const dlg = ler("src/components/pos/CheckoutDialog.jsx");
const panel = ler("src/components/pos/MaquininhaManualPanel.jsx");
const hook = ler("src/lib/useConnectTef.js");
const pdv = ler("src/pages/PDV.jsx");
const conta = (texto, trecho) => texto.split(trecho).length - 1;

// ---------- lógica pura: o que cada canal permite ----------
const cfg = (canal, extra = {}) => ({ card_enabled: true, card_channel: canal, tef_enabled: true, tef_agent_url: "http://localhost:8080", ...extra });
const todos = ["ativo", "inativo", "indeterminado", "verificando"];
for (const estado of todos) {
  const m = resolverCanalCartao({ config: cfg("maquininha"), estadoSmartPos: estado });
  check(m.canal === "maquininha" && m.liberado, `maquininha escolhida: liberada, mesmo com Smart POS '${estado}' (funciona manualmente, inclusive offline)`);
}
for (const estado of ["inativo", "indeterminado", "verificando"]) {
  const s = resolverCanalCartao({ config: cfg("smartpos"), estadoSmartPos: estado });
  check(s.canal === "smartpos" && !s.liberado && !!s.motivo, `smartpos escolhido com Smart POS '${estado}': bloqueado, sem trocar de canal`);
}
check(resolverCanalCartao({ config: cfg("smartpos"), estadoSmartPos: "ativo" }).liberado, "smartpos escolhido com Smart POS vinculado: liberado");
check(resolverCanalCartao({ config: cfg("tef"), estadoSmartPos: "ativo" }).canal === "tef", "tef escolhido vale sobre Smart POS vinculado");
check(!resolverCanalCartao({ config: cfg("tef", { tef_enabled: false }), estadoSmartPos: "inativo" }).liberado, "tef sem TEF ligado: bloqueado");
check(!resolverCanalCartao({ config: cfg("tef", { tef_agent_url: "" }), estadoSmartPos: "inativo" }).liberado, "tef sem agente: bloqueado");
check(!resolverCanalCartao({ config: cfg("maquininha", { card_enabled: false }), estadoSmartPos: "ativo" }).habilitado, "card_enabled falso: crédito e débito desabilitados");
check(canalDecidido(cfg("tef"), "verificando") === "tef" && canalDecidido({ ...cfg(null) }, "indeterminado") === null, "o canal só congela quando é conhecido (gravado, ou deduzido com o Smart POS conhecido)");
check(canalDoPagamento({ method: "credito", channel: "maquininha", confirmationType: "manual" }) === "maquininha", "pagamento da maquininha traz channel 'maquininha'");

// ---------- CheckoutDialog: cada canal ----------
check(dlg.includes("useCanalCartao(open)") && !dlg.includes("useConnectTefEstado"), "checkout: o canal vem da configuração da empresa (useCanalCartao), não da existência de Smart POS");
check(dlg.includes('const usaCtef = cartaoOk && canalCartao === "smartpos";') && dlg.includes('const usaTef = cartaoOk && canalCartao === "tef";') && dlg.includes('const usaMaq = cartaoOk && canalCartao === "maquininha";'), "checkout: um canal por vez, só se liberado (resolverCanalCartao)");
check(dlg.includes("const cartaoBloqueado = ehCartao && resolucao.habilitado && !resolucao.liberado;") && dlg.includes("{resolucao.motivo}"), "checkout: canal que não pode cobrar bloqueia o cartão e mostra o motivo (sem fallback)");
check(!dlg.includes("segue sem cobrar em cartão"), "checkout: o ramo antigo que aprovava sem cobrar (maquininha/TEF não configurado) foi removido");
check(conta(dlg, "setCardStatus(TefStatus.APPROVED)") === 1 && dlg.includes("const confirmarMaquininha = ({ nsu }) => {\n    if (!usaMaq) return;"), "checkout: o único lugar que aprova cartão por conta própria é a confirmação explícita da maquininha, e só no canal maquininha");
check(dlg.includes("setCardStatus(result.status);") && dlg.includes("initiateTefPayment({ amount: chargeAmount"), "checkout: TEF só aprova com o status devolvido pelo agente");
check(dlg.includes("const startCardPayment = async () => {\n    if (!usaTef) return;") && dlg.includes("if (!isTefConfigured()) {"), "checkout: TEF só roda no canal tef e sem agente configurado bloqueia");
check(dlg.includes('const cardApproved = usaCtef ? ctef.fase === "aprovado" : (usaTef || usaMaq) && cardStatus === TefStatus.APPROVED;'), "checkout: smartpos só aprova por 'aprovado' do ConnectTEF; tef e maquininha pelo status do próprio canal");
check(dlg.includes("<ConnectTefCardPanel") && dlg.includes("useCobrancaTef(open)") && dlg.includes('provider: "connecttef", connectTefPaymentId: ctef.op.id'), "checkout: o fluxo do Smart POS (painel, controlador e registro) segue igual");
check(dlg.includes("<MaquininhaManualPanel") && dlg.includes("onConfirmar={confirmarMaquininha}"), "checkout: a maquininha usa o painel de confirmação manual");

// registro do canal no pagamento
check(dlg.includes('channel: "smartpos"') && dlg.includes('channel: "tef" }') && dlg.includes('channel: "maquininha", confirmationType: "manual"'), "checkout: cada pagamento de cartão grava o seu channel (maquininha com confirmationType manual)");
check(dlg.includes("...(maqNsu ? { nsu: maqNsu } : {})"), "checkout: NSU da maquininha é opcional e só vai no pagamento se informado");

// card_enabled
check(dlg.includes('const metodosVisiveis = paymentMethods.filter((pm) => resolucao.habilitado || (pm.id !== "credito" && pm.id !== "debito"));') && dlg.includes("metodosVisiveis.map("), "checkout: card_enabled desligado esconde Crédito e Débito");
check(dlg.includes('if (!resolucao.habilitado && ehCartao) setMethod("dinheiro");'), "checkout: se o cartão for desligado com cartão selecionado, volta para dinheiro");

// dinheiro, PIX e crediário não dependem do canal
check(dlg.includes('const ehCartao = method === "credito" || method === "debito";'), "checkout: o canal só afeta crédito e débito (dinheiro, PIX e crediário intocados)");

// remoção/fechamento da maquininha avisa
check(dlg.includes('entry?.channel === "maquininha"') && dlg.includes("cancele a transação na maquininha"), "checkout: remover pagamento da maquininha avisa para cancelar na maquininha");

// ---------- painel da maquininha: confirmação explícita em dois passos ----------
check(panel.includes("O sistema não vê a maquininha") && panel.includes("A maquininha aprovou"), "painel da maquininha: avisa que o sistema não vê a maquininha e pergunta antes de confirmar");
check(conta(panel, "onConfirmar(") === 1 && !panel.slice(panel.indexOf("onConfirmar("), panel.indexOf("Sim, foi aprovado")).includes("<Button") && panel.indexOf("setConfirmando(true)") < panel.indexOf("onConfirmar("), "painel da maquininha: onConfirmar só é chamado pelo botão 'Sim, foi aprovado' (segundo passo)");
check(panel.includes("setConfirmando(true)") && panel.includes("Confirmar pagamento aprovado na maquininha"), "painel da maquininha: o primeiro clique só abre a pergunta");
check(panel.includes("Desfazer confirmação"), "painel da maquininha: dá para desfazer a confirmação antes de lançar");

// botão de confirmar: verde, clicável, sem finalizar a venda
check(panel.includes('const BOTAO_VERDE =') && panel.includes("bg-emerald-600") && panel.includes("hover:bg-emerald-700") && panel.includes("disabled:bg-muted"), "painel da maquininha: botões de confirmar em verde (cinza só quando desabilitado)");
check(panel.split("Confirmar pagamento aprovado na maquininha")[0].includes("BOTAO_VERDE") && !panel.includes('variant="outline" className="w-full gap-2" disabled={!(valor > 0)}'), "painel da maquininha: 'Confirmar pagamento aprovado na maquininha' não é mais o botão outline cinza");
check(panel.includes("const travado = useRef(false);") && panel.includes("if (travado.current) return;") && panel.includes("travado.current = true;") && panel.includes("if (!aprovado) travado.current = false;"), "painel da maquininha: proteção contra duplo clique em 'Sim, foi aprovado'");
check(panel.includes("Pagamento aprovado na maquininha") && panel.includes("Aprovado na maquininha (confirmado manualmente)") && panel.includes("Agora clique em FINALIZAR - F10"), "painel da maquininha: estado 'aprovado na maquininha' visível e orienta a clicar em Finalizar");
check(dlg.includes("if (cardStatus === TefStatus.APPROVED) return; // duplo clique: já está aprovado"), "checkout: confirmar a maquininha de novo com o pagamento já aprovado é ignorado");
{
  const corpo = dlg.slice(dlg.indexOf("const confirmarMaquininha"), dlg.indexOf("const desfazerMaquininha"));
  check(!["handleConfirm", "onConfirm(", "resolvePaymentsForFinalize", "addPayment"].some((t) => corpo.includes(t)), "checkout: confirmar a maquininha só marca como aprovado, NÃO finaliza a venda nem lança o pagamento sozinho");
}
check(dlg.includes("disabled={!canFinalize || processing}") && dlg.includes("FINALIZAR - F10"), "checkout: FINALIZAR - F10 libera por canFinalize (cartão aprovado conta como pago) e segue protegido por processing");

// ---------- hook: canal congelado ao abrir ----------
check(hook.includes("export function useCanalCartao(open)") && hook.includes("const congelado = useRef(null);") && hook.includes("congelado.current = null;"), "hook: o canal é congelado ao abrir e solto ao fechar/reabrir");
check(hook.includes("if (decidido && !congelado.current) congelado.current = { config, canal: decidido };") && hook.includes("{ ...base.config, card_channel: base.canal }"), "hook: depois de congelado, mudar a configuração com o checkout aberto não troca o canal");
check(hook.includes("syncPaymentConfig()") && hook.includes("getCachedPaymentConfig()"), "hook: lê a configuração do servidor quando online e do espelho local offline");
check(!hook.includes("cartaoLivreDoConnectTef") && hook.includes("export function useConnectTefEstado(open)"), "hook: o estado do Smart POS (ConnectTEF) segue como era; só o helper antigo do PDV saiu");

// ---------- PDV: offline por canal ----------
check(pdv.includes('p.provider === "connecttef" || p.channel === "smartpos"') && pdv.includes("if (temTef && !isOnline()) {"), "PDV: venda offline com pagamento do Smart POS é bloqueada");
check(!pdv.includes("cartaoSemTef") && !pdv.includes("cartaoLivreDoConnectTef"), "PDV: maquininha e TEF não são mais bloqueados offline (a regra antiga por 'sem Smart POS' saiu)");
check(pdv.includes("validarPagamentosParaVenda(paymentData.payments, buscarPagamentoTef)") && pdv.includes("vincularPagamentosDaVenda("), "PDV: a conferência e o vínculo do pagamento ConnectTEF seguem como antes");

console.log("\nSmoke — checkout por canal de cartão (PR 2)\n");
for (const m of ok) console.log(`  PASS  ${m}`);
for (const m of falhas) console.log(`  FAIL  ${m}`);
console.log(`\n${ok.length} passaram, ${falhas.length} falharam\n`);
process.exit(falhas.length ? 1 : 0);
