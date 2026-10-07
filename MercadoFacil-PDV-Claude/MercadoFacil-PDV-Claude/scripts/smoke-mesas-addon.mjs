/**
 * Smoke do adicional pago "Mesas" (sem rede): catálogo (frontend e servidor), reajuste, quem pode usar, diálogo
 * "Ativar Mesas" e presença nos planos/landing. A cobrança real é do servidor (generate-pix-payment + _shared/plans.ts).
 * Uso: node scripts/smoke-mesas-addon.mjs
 */
import { readFileSync } from "fs";
import { resolve } from "path";
import { ID_ADICIONAL_MESAS, mesasLiberadas, modoDeAtivacao, reajusteDoPlano, addonsComMesas } from "../src/lib/mesasAcesso.js";
import { ADDON_PRICES, PLAN_PRICES, calcPlanMonthlyTotal, PlanInputError } from "../supabase/functions/_shared/plans.ts";

const falhas = [];
let passaram = 0;
const check = (cond, msg) => (cond ? passaram++ : falhas.push(msg));
const raiz = resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const ler = (p) => readFileSync(resolve(raiz, p), "utf8").split("\r\n").join("\n");

// ---- catálogo do frontend (src/lib/plans.js) sem React ----
const corpo = ler("src/lib/plans.js")
  .replace(/^import .*$/gm, "")
  .replace(/export const /g, "const ")
  .concat("\nreturn { PLANS, ADDONS, EXTRA_ADDONS, getMonthlyTotal, formatAddonPrice, formatMonthlyPrice };");
const r2 = (n) => Math.round(n * 100) / 100;
const brl = (n) => `R$ ${n.toFixed(2).replace(".", ",")}`;
const P = new Function("Zap", "Crown", "formatBRL", "roundMoney", corpo)(null, null, brl, (n) => Math.round(n * 100) / 100);
const mesas = P.ADDONS.find((a) => a.id === "mesas");

// ---------- catálogo e preço ----------
check(ID_ADICIONAL_MESAS === "mesas" && !!mesas, "adicional 'mesas' existe no catálogo de planos");
check(mesas.monthlyPrice === 19.9 && P.formatAddonPrice(mesas) === "+ R$ 19,90/mês" && !mesas.includedInPlanIds, "Mesas: + R$ 19,90/mês, não incluso em plano");
check(P.EXTRA_ADDONS.some((a) => a.id === "mesas") && P.ADDONS.filter((a) => a.id === "mesas").length === 1, "Mesas está nos módulos extras (uma vez só)");
check(ADDON_PRICES.mesas === 19.9 && ADDON_PRICES.mesas === mesas.monthlyPrice, "servidor cobra o mesmo valor do frontend (R$ 19,90)");
check(PLAN_PRICES.mei === 119.9 && PLAN_PRICES.simples === 169.9 && ADDON_PRICES.pdv_pos === 50 && ADDON_PRICES.tef_sitef === 90 && ADDON_PRICES.nfse === 29.9 && ADDON_PRICES.whatsapp === 19.9, "preços dos planos e dos outros adicionais intactos");
check(calcPlanMonthlyTotal("mei", ["mesas"]) === 139.8 && calcPlanMonthlyTotal("simples", ["mesas"]) === 189.8, "servidor: MEI + Mesas = 139,80 e Simples + Mesas = 189,80");
check(calcPlanMonthlyTotal("simples", ["whatsapp", "mesas", "nfse"]) === r2(169.9 + 19.9 + 19.9 + 29.9), "servidor soma Mesas com os outros adicionais");
check(P.getMonthlyTotal("mei", ["mesas"]) === calcPlanMonthlyTotal("mei", ["mesas"]) && P.getMonthlyTotal("simples", ["whatsapp", "mesas"]) === calcPlanMonthlyTotal("simples", ["whatsapp", "mesas"]), "frontend e servidor calculam o mesmo total com Mesas");
let recusou = false;
try { calcPlanMonthlyTotal("mei", ["mesas_gratis"]); } catch (e) { recusou = e instanceof PlanInputError; }
check(recusou, "servidor continua recusando adicional desconhecido (quem manda no valor é o servidor, não o navegador)");

// ---------- reajuste (como na foto: 389,60 + 19,90 = 409,50) ----------
const r = reajusteDoPlano({ planoAtualMensal: 389.6, adicionalMensal: 19.9 });
check(r.planoAtual === 389.6 && r.adicional === 19.9 && r.novoTotal === 409.5, "reajuste: plano atual 389,60 + Mesas 19,90 = 409,50/mês");
check(reajusteDoPlano({ planoAtualMensal: 0.1, adicionalMensal: 0.2 }).novoTotal === 0.3, "reajuste sem erro de ponto flutuante");
check(reajusteDoPlano({ planoAtualMensal: P.getMonthlyTotal("simples", ["tef_sitef"]), adicionalMensal: mesas.monthlyPrice }).novoTotal === r2(169.9 + 90 + 19.9), "reajuste usa o plano atual com os adicionais que a empresa já tem");

// ---------- quem pode usar ----------
check(mesasLiberadas({ status: "trial" }) === true, "teste vigente: Mesas liberado (nada cobrado no teste)");
check(mesasLiberadas({ status: "trial", expirado: true }) === false, "teste vencido: Mesas bloqueado");
check(mesasLiberadas({ status: "active", addons: [] }) === false && mesasLiberadas({ status: "active", addons: ["whatsapp", "nfse"] }) === false, "plano ativo SEM o adicional: Mesas bloqueado");
check(mesasLiberadas({ status: "active", addons: ["whatsapp", "mesas"] }) === true, "plano ativo COM o adicional: Mesas liberado");
check(mesasLiberadas({ status: "active", expirado: true, addons: ["mesas"] }) === false, "plano vencido (além da tolerância): bloqueado mesmo com o adicional");
check(mesasLiberadas({ plataforma: true }) === true && mesasLiberadas({ plataforma: true, status: "none", expirado: true }) === true, "conta da plataforma sempre liberada");
check(mesasLiberadas({}) === false && mesasLiberadas({ status: "none" }) === false && mesasLiberadas({ status: "canceled" }) === false && mesasLiberadas() === false, "sem plano/cancelado: bloqueado");
check(mesasLiberadas({ status: "active", addons: undefined }) === false && mesasLiberadas({ status: "active", addons: null }) === false, "addons ausente não quebra");
check(modoDeAtivacao({ status: "trial" }) === "teste" && modoDeAtivacao({ status: "trial", expirado: true }) === "contratar" && modoDeAtivacao({ status: "active" }) === "contratar" && modoDeAtivacao({}) === "contratar", "modo: teste ativa na hora; plano ativo/vencido contrata pelo fluxo de planos");
check(addonsComMesas(["whatsapp"]).join() === "whatsapp,mesas" && addonsComMesas(["mesas"]).join() === "mesas" && addonsComMesas().join() === "mesas", "contratação inclui Mesas sem duplicar");

// ---------- diálogo "Ativar Mesas" ----------
const dlg = ler("src/components/mesas/AtivarMesasDialog.jsx");
check(/<DialogTitle>Ativar Mesas<\/DialogTitle>/.test(dlg) && /ADICIONAL\.label/.test(dlg) && /formatAddonPrice\(ADICIONAL\)/.test(dlg) && /ADICIONAL\.description/.test(dlg), "diálogo 'Ativar Mesas' com o adicional, preço e descrição do catálogo");
check(/Reajuste do plano/.test(dlg) && /Plano atual/.test(dlg) && /Seu plano fica/.test(dlg) && /reajuste\.planoAtual/.test(dlg) && /reajuste\.adicional/.test(dlg) && /reajuste\.novoTotal/.test(dlg), "bloco 'Reajuste do plano': plano atual, Mesas e 'Seu plano fica'");
check(/Durante o teste nada é cobrado\. O adicional entra na fatura quando você ativar o plano \(por mês\)\./.test(dlg), "aviso: durante o teste nada é cobrado; entra na fatura ao ativar o plano");
check(/Concordo com o reajuste e autorizo a cobrança de/.test(dlg) && /disabled=\{!aceito\}/.test(dlg) && /Aceito e ativar/.test(dlg) && />Cancelar</.test(dlg), "aceite obrigatório ('Concordo com o reajuste…'), botão 'Aceito e ativar' só habilita marcado, e Cancelar");
check(/salvarConfigMesas\(\{ ativo: true, aceiteMesas:/.test(dlg) && /Durante o teste nada é cobrado\./.test(dlg), "no teste: aceitar ativa Mesas neste caixa e registra o aceite");
check(/navigate\(`\/selecionar-plano\?plan=\$\{acesso\.plano\}&addons=\$\{addonsComMesas\(acesso\.addons\)\.join\(","\)\}`\)/.test(dlg) && /Aceito e contratar/.test(dlg), "plano ativo/vencido: aceitar abre a contratação com o adicional (fluxo de planos/PIX existente)");
check(!/generatePixPayment|api\.functions|amount|monthlyPrice \*/.test(dlg), "o diálogo não calcula nem envia valor de cobrança (o servidor é a autoridade)");

// ---------- integração ----------
const mesasPg = ler("src/pages/Mesas.jsx");
check(/useMesasAcesso\(config\)/.test(mesasPg) && /if \(!acesso\.liberadas\) \{/.test(mesasPg) && /Mesas é um adicional/.test(mesasPg) && /Ativar Mesas/.test(mesasPg), "Mesas: sem direito de uso a tela pede 'Ativar Mesas' (adicional)");
check(/const ativar = \(\) => \(acesso\.precisaAceite \? setAtivarAberto\(true\) : salvarConfigMesas\(\{ ativo: true \}\)\)/.test(mesasPg) && /\{dialogoAtivar\}/.test(mesasPg), "Mesas: ativar abre o diálogo quando falta aceite/contratação");
const vendas = ler("src/components/config/VendasTab.jsx");
check(/v && acesso\.precisaAceite \? setAtivarAberto\(true\) : salvarConfigMesas\(\{ ativo: v \}\)/.test(vendas) && /<AtivarMesasDialog/.test(vendas), "Configurações → Vendas: ligar Mesas abre o 'Ativar Mesas'; desligar é direto");
check(/estadoDeAcessoMesas\(user\)\.liberadas/.test(ler("src/components/Layout.jsx")) && /acessoMesas\.liberadas/.test(ler("src/pages/PDV.jsx")), "menu e PDV só mostram Mesas para quem tem direito de uso");
const hook = ler("src/components/mesas/useMesasAcesso.js");
check(/isTrialExpired\(user\)/.test(hook) && /plan_addons/.test(hook) && /plan_status/.test(hook) && /getMonthlyTotal\(plano, estado\.addons\)/.test(hook), "acesso parte de plan_status/plan_addons/validade vindos do servidor (nunca de localStorage)");
check(/precisaAceite: a\.liberadas \? a\.modo === "teste" && !config\?\.aceiteMesas : true/.test(hook), "no teste o aceite é pedido uma vez; sem direito de uso sempre abre o diálogo");

// ---------- planos e landing ----------
const landing = ler("src/components/landing/LandingPlans.jsx");
check(/mesas: UtensilsCrossed/.test(landing) && /ADDONS\.map/.test(landing) && /formatAddonPrice\(a\)/.test(landing), "Landing: Mesas aparece nos adicionais com ícone e preço do catálogo");
const planoPg = ler("src/pages/Plano.jsx");
check(/EXTRA_ADDONS\.map/.test(planoPg) && /PAYMENT_ADDONS\.map/.test(planoPg), "página Plano lista os adicionais do catálogo (inclui Mesas)");
const sel = ler("src/pages/PlanSelection.jsx");
check(/ADDONS\.some\(\(a\) => a\.id === id\)/.test(sel) && /addons/.test(sel), "seleção de plano valida o adicional pelo catálogo (aceita addons=mesas)");
const rn = ler("src/lib/releaseNotes.js");
check(/priceLabel: formatAddonPrice\(ADDONS\.find\(\(a\) => a\.id === "mesas"\)\)/.test(rn), "módulo Mesas na lista comercial mostra o preço do catálogo");
check(!/mesa/i.test(ler("src/components/pos/CheckoutDialog.jsx")), "CheckoutDialog intacto");
check(/mei: 119\.9/.test(ler("supabase/functions/_shared/plans.ts")) && /ADDON_INCLUDED_IN_PLAN: Record<string, string\[\]> = \{\};/.test(ler("supabase/functions/_shared/plans.ts")), "regra 'nenhum adicional é incluso em plano' mantida");

console.log(JSON.stringify({ passaram, falhas: falhas.length }));
if (falhas.length) {
  falhas.forEach((f) => console.log("FALHA:", f));
  process.exit(1);
}
console.log(`${passaram} passaram, 0 falharam`);
