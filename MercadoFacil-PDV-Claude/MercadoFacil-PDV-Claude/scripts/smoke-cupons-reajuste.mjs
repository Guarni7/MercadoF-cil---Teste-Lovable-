/**
 * Smoke de cupons/bônus e da estrutura de reajuste anual — lógica PURA (sem banco, sem rede, sem Supabase).
 * Importa direto os módulos TypeScript do servidor (Node 24 remove os tipos):
 *   supabase/functions/_shared/plans.ts     preços-base e adicionais (espelho de src/lib/plans.js)
 *   supabase/functions/_shared/cupons.ts    desconto separado do preço, por ciclos
 *   supabase/functions/_shared/reajuste.ts  simulação e registro de reajuste (nunca aplica)
 * Confere também a migration 079 (idempotente, RLS, sem dados) e que nada disso está ligado à cobrança real.
 *
 * Uso: node scripts/smoke-cupons-reajuste.mjs
 */
import { readFileSync, readdirSync, statSync } from "fs";
import { join, resolve } from "path";
import { ADDON_PRICES, PLAN_PRICES, calcPlanMonthlyTotal } from "../supabase/functions/_shared/plans.ts";
import { calcularCobranca, consumirCiclo, cupomEstruturado, novoResgate, validarCupom } from "../supabase/functions/_shared/cupons.ts";
import { INDICE_PADRAO, MESES_MINIMOS_REAJUSTE, completouPeriodoMinimo, montarRegistroReajuste, simularReajuste } from "../supabase/functions/_shared/reajuste.ts";

const falhas = [];
const ok = [];
const check = (cond, msg) => (cond ? ok.push(msg) : falhas.push(msg));
const raiz = process.cwd();
const ler = (p) => readFileSync(resolve(raiz, p), "utf8").split("\r\n").join("\n");
const AGORA = "2026-10-10T12:00:00Z";
const cupom = (extra = {}) => ({
  code: "PROMO",
  discountType: "percent",
  discountValue: 50,
  appliesTo: "total",
  cycles: 1,
  startsAt: null,
  expiresAt: null,
  maxRedemptions: null,
  redemptionsCount: 0,
  active: true,
  ...extra,
});

// ---------- preços-base e adicionais: exatamente os de hoje, no servidor e no frontend ----------
check(PLAN_PRICES.mei === 119.9 && PLAN_PRICES.simples === 169.9, "preço-base: MEI R$ 119,90 e Simples Nacional R$ 169,90");
check(ADDON_PRICES.pdv_pos === 50 && ADDON_PRICES.tef_sitef === 90 && ADDON_PRICES.whatsapp === 19.9 && ADDON_PRICES.nfse === 29.9, "adicionais: PDV POS 50, TEF 90, WhatsApp 19,90, NFS-e 29,90");
const planosJs = ler("src/lib/plans.js");
const corpo = planosJs.replace(/^import .*$/gm, "").replace(/export const /g, "const ").concat("\nreturn { PLANS, ADDONS, TEXTO_REAJUSTE_ANUAL };");
const F = new Function("Zap", "Crown", "formatBRL", "roundMoney", corpo)(null, null, String, (n) => n);
check(F.PLANS.find((p) => p.id === "mei").monthlyPrice === PLAN_PRICES.mei && F.PLANS.find((p) => p.id === "simples").monthlyPrice === PLAN_PRICES.simples, "frontend e backend sincronizados: preços dos planos");
check(F.ADDONS.every((a) => a.monthlyPrice === ADDON_PRICES[a.id]) && F.ADDONS.length === Object.keys(ADDON_PRICES).length, "frontend e backend sincronizados: os 4 adicionais");
check(calcPlanMonthlyTotal("simples", []) === 169.9 && calcPlanMonthlyTotal("simples", ["tef_sitef", "nfse"]) === 289.8, "calcPlanMonthlyTotal segue sem cupom (169,90; com TEF e NFS-e 289,80)");

// ---------- o cupom NÃO altera o preço-base ----------
const antes = JSON.stringify({ PLAN_PRICES, ADDON_PRICES });
const c50 = cupom();
const c50Antes = JSON.stringify(c50);
const r1 = calcularCobranca({ planId: "simples", cupom: c50, resgate: null, agora: AGORA });
check(JSON.stringify({ PLAN_PRICES, ADDON_PRICES }) === antes && JSON.stringify(c50) === c50Antes, "aplicar cupom não modifica PLAN_PRICES, ADDON_PRICES nem o objeto do cupom");
check(r1.baseTotal === 169.9 && r1.planoBase === 169.9, "o preço-base continua R$ 169,90 durante o desconto");

// ---------- exemplo do pedido: 50% no primeiro mês ----------
check(r1.desconto === 84.95 && r1.total === 84.95 && r1.cupomAplicado && r1.cicloDoBeneficio === 1 && r1.ciclosRestantesAposPagar === 0, "50% no 1º mês: primeiro ciclo = R$ 84,95");
const apos1 = consumirCiclo(novoResgate(c50));
const r2 = calcularCobranca({ planId: "simples", cupom: c50, resgate: apos1, agora: AGORA });
check(apos1.cyclesUsed === 1 && r2.total === 169.9 && r2.desconto === 0 && !r2.cupomAplicado && r2.motivo === "cycles_finished", "2º ciclo: volta automaticamente a R$ 169,90 (benefício encerrado)");

// ---------- 1º mês grátis ----------
const gratis = cupom({ code: "GRATIS", discountValue: 100 });
check(calcularCobranca({ planId: "mei", cupom: gratis, agora: AGORA }).total === 0, "1º mês grátis: percentual 100 → R$ 0,00 no ciclo");
check(calcularCobranca({ planId: "mei", cupom: gratis, resgate: consumirCiclo(novoResgate(gratis)), agora: AGORA }).total === 119.9, "depois do mês grátis: R$ 119,90");

// ---------- desconto fixo por N ciclos (R$ 30 por 3 meses) ----------
const fixo = cupom({ code: "TRINTA", discountType: "fixed", discountValue: 30, cycles: 3 });
let est = novoResgate(fixo);
const totais = [];
for (let i = 0; i < 5; i++) {
  totais.push(calcularCobranca({ planId: "simples", cupom: fixo, resgate: est, agora: AGORA }).total);
  est = consumirCiclo(est);
}
check(JSON.stringify(totais) === JSON.stringify([139.9, 139.9, 139.9, 169.9, 169.9]), "R$ 30 por 3 ciclos: 139,90 × 3 e depois 169,90");
check(est.cyclesUsed === 3 && est.cyclesTotal === 3, "consumirCiclo nunca passa do total de ciclos");

// ---------- percentual por vários ciclos ----------
const p20 = cupom({ discountValue: 20, cycles: 2 });
const seq = [];
let e2 = novoResgate(p20);
for (let i = 0; i < 3; i++) { seq.push(calcularCobranca({ planId: "mei", cupom: p20, resgate: e2, agora: AGORA }).total); e2 = consumirCiclo(e2); }
check(JSON.stringify(seq) === JSON.stringify([95.92, 95.92, 119.9]), "20% por 2 ciclos: 95,92 × 2 e depois 119,90");
check(calcularCobranca({ planId: "mei", cupom: p20, resgate: novoResgate(p20), agora: AGORA }).ciclosRestantesAposPagar === 1, "informa quantos ciclos de benefício sobram");

// ---------- add-ons ----------
const soAddons = cupom({ appliesTo: "addons", discountValue: 50 });
const ra = calcularCobranca({ planId: "simples", addonIds: ["tef_sitef"], cupom: soAddons, agora: AGORA });
check(ra.adicionaisBase === 90 && ra.desconto === 45 && ra.total === 214.9 && ra.planoBase === 169.9, "cupom só nos adicionais: 50% de R$ 90 (TEF) = 45; plano intacto (total 214,90)");
const soPlano = cupom({ appliesTo: "plan", discountType: "fixed", discountValue: 200 });
const rp = calcularCobranca({ planId: "mei", addonIds: ["nfse"], cupom: soPlano, agora: AGORA });
check(rp.desconto === 119.9 && rp.total === 29.9, "cupom fixo só no plano nunca desconta mais que o plano (adicionais continuam cobrados)");
const rt = calcularCobranca({ planId: "mei", cupom: cupom({ discountType: "fixed", discountValue: 500 }), agora: AGORA });
check(rt.total === 0 && rt.desconto === 119.9, "desconto maior que o total nunca deixa o valor negativo");
const rtotal = calcularCobranca({ planId: "simples", addonIds: ["whatsapp"], cupom: cupom({ discountValue: 10 }), agora: AGORA });
check(rtotal.baseTotal === 189.8 && rtotal.desconto === 18.98 && rtotal.total === 170.82, "cupom no total (plano + adicionais): 10% de 189,80 = 18,98");

// ---------- validade: expirado, inativo, início, limite ----------
const expirado = cupom({ expiresAt: "2026-10-01T00:00:00Z" });
const re = calcularCobranca({ planId: "simples", cupom: expirado, agora: AGORA });
check(re.desconto === 0 && re.total === 169.9 && re.motivo === "expired", "cupom expirado não aplica desconto");
check(calcularCobranca({ planId: "simples", cupom: cupom({ active: false }), agora: AGORA }).motivo === "inactive" && calcularCobranca({ planId: "simples", cupom: cupom({ active: false }), agora: AGORA }).total === 169.9, "cupom inativo não aplica desconto");
// active = false impede NOVOS resgates, mas NÃO cancela quem já resgatou
const resgatado = novoResgate(cupom());
const inativoComResgate = calcularCobranca({ planId: "simples", cupom: cupom({ active: false }), resgate: resgatado, agora: AGORA });
check(inativoComResgate.total === 84.95 && inativoComResgate.cupomAplicado && inativoComResgate.motivo === "ok", "cupom desativado depois do resgate: quem já resgatou segue com o benefício (50% = R$ 84,95)");
check(calcularCobranca({ planId: "simples", cupom: cupom({ active: false }), resgate: null, agora: AGORA }).motivo === "inactive", "cupom desativado: NOVO resgate não recebe desconto");
check(calcularCobranca({ planId: "simples", cupom: cupom({ startsAt: "2026-11-01T00:00:00Z" }), agora: AGORA }).motivo === "not_started", "cupom que ainda não começou não aplica desconto");
check(validarCupom(cupom({ expiresAt: AGORA }), { agora: AGORA }).motivo === "expired", "a data de expiração é exclusiva (no instante exato já expirou)");
const lotado = cupom({ maxRedemptions: 10, redemptionsCount: 10 });
check(calcularCobranca({ planId: "simples", cupom: lotado, agora: AGORA }).motivo === "exhausted" && calcularCobranca({ planId: "simples", cupom: lotado, agora: AGORA }).total === 169.9, "limite de utilizações atingido: novo resgate não recebe desconto");
check(validarCupom(cupom({ maxRedemptions: 10, redemptionsCount: 9 }), { agora: AGORA }).valido === true, "ainda há vaga no limite (9 de 10): válido");
const emAndamento = { ...novoResgate(cupom({ cycles: 3 })), cyclesUsed: 1 };
check(validarCupom(lotado, { agora: AGORA, resgate: emAndamento }).valido === true, "quem já resgatou continua com o benefício mesmo com o limite esgotado depois");
check(validarCupom(expirado, { agora: AGORA, resgate: emAndamento }).valido === true, "expires_at impede NOVOS resgates, mas quem já resgatou segue até acabar os ciclos");
check(validarCupom(cupom({ active: false, expiresAt: "2026-10-01T00:00:00Z" }), { agora: AGORA, resgate: emAndamento }).valido === true, "desativado E expirado: o benefício já concedido continua");
check(validarCupom(null, { agora: AGORA, resgate: emAndamento }).valido === true, "o benefício concedido não depende de o cupom ainda existir/ser lido");
check(!cupomEstruturado(cupom({ discountValue: 150 })) && !cupomEstruturado(cupom({ cycles: 0 })) && !cupomEstruturado(cupom({ discountValue: -5 })) && !cupomEstruturado(cupom({ appliesTo: "x" })), "cupom malformado (150%, 0 ciclos, valor negativo, alvo inválido) é recusado");
check(calcularCobranca({ planId: "simples", cupom: cupom({ discountValue: 150 }), agora: AGORA }).total === 169.9, "cupom malformado nunca desconta");
check(calcularCobranca({ planId: "simples", agora: AGORA }).total === 169.9 && calcularCobranca({ planId: "simples", agora: AGORA }).motivo === "sem_cupom", "sem cupom: cobra o preço-base");
check(novoResgate(cupom({ cycles: 3 })).cyclesTotal === 3, "o resgate copia os ciclos do cupom");
{
  // benefício concedido é independente de alterações posteriores no cupom
  const original = cupom({ code: "ORIGINAL", discountType: "percent", discountValue: 50, appliesTo: "total", cycles: 3 });
  const concedido = novoResgate(original);
  check(concedido.discountType === "percent" && concedido.discountValue === 50 && concedido.appliesTo === "total" && concedido.cyclesTotal === 3, "o resgate guarda os termos do benefício (tipo, valor, alvo e ciclos)");
  const editado = { ...original, discountType: "fixed", discountValue: 5, appliesTo: "addons", cycles: 1, active: false, expiresAt: "2020-01-01T00:00:00Z", maxRedemptions: 1, redemptionsCount: 1 };
  const sequencia = [];
  let rs = concedido;
  for (let i = 0; i < 4; i++) { sequencia.push(calcularCobranca({ planId: "simples", cupom: editado, resgate: rs, agora: AGORA }).total); rs = consumirCiclo(rs); }
  check(JSON.stringify(sequencia) === JSON.stringify([84.95, 84.95, 84.95, 169.9]), "cupom editado, desativado e expirado depois do resgate: o benefício concedido (50% por 3 ciclos) segue igual e depois volta ao normal");
  check(calcularCobranca({ planId: "simples", cupom: null, resgate: concedido, agora: AGORA }).total === 84.95, "com o resgate, o desconto vale mesmo sem o cupom");
  check(consumirCiclo(concedido).discountValue === 50 && consumirCiclo(concedido).appliesTo === "total", "consumir um ciclo preserva os termos concedidos");
}
let lancou = false;
try { calcularCobranca({ planId: "inexistente" }); } catch { lancou = true; }
check(lancou, "plano inválido continua sendo erro (nunca cobra um preço inventado)");

// ---------- reajuste: estrutura, sem aplicar ----------
check(MESES_MINIMOS_REAJUSTE === 12 && INDICE_PADRAO === "IPCA", "reajuste: período mínimo de 12 meses e índice previsto IPCA");
const sim = simularReajuste(169.9, 4.5);
check(sim.precoAnterior === 169.9 && sim.percentual === 4.5 && sim.novoPreco === 177.55, "simular reajuste de 4,5% sobre 169,90 → 177,55");
check(JSON.stringify({ PLAN_PRICES, ADDON_PRICES }) === antes, "simular reajuste NÃO altera nenhum preço (169,90 e 119,90 continuam)");
const reg = montarRegistroReajuste({ itemType: "plan", itemId: "simples", percentual: 4.5, dataBase: "2026-10-10", aplicadoEm: "2027-10-10T00:00:00Z", precoAnterior: 169.9, novoPreco: 177.55, observacao: "IPCA 12 meses" });
check(reg.previous_price === 169.9 && reg.new_price === 177.55 && reg.index_name === "IPCA" && reg.percent_applied === 4.5 && reg.base_date === "2026-10-10" && reg.applied_at === "2027-10-10T00:00:00.000Z" && reg.note === "IPCA 12 meses" && reg.item_type === "plan" && reg.item_id === "simples", "histórico registra índice, percentual, data-base, data de aplicação, preço anterior, novo preço e observação");
check(montarRegistroReajuste({ itemType: "addon", itemId: "nfse", percentual: 3, dataBase: "2026-10-10", aplicadoEm: "2027-10-10", precoAnterior: 29.9, novoPreco: 30.8 }).note === null, "observação é opcional");
for (const [rotulo, args] of [
  ["novo preço que não bate com o percentual", { itemType: "plan", itemId: "mei", percentual: 4.5, dataBase: "2026-10-10", aplicadoEm: "2027-10-10", precoAnterior: 119.9, novoPreco: 130 }],
  ["data-base fora do formato", { itemType: "plan", itemId: "mei", percentual: 4.5, dataBase: "10/10/2026", aplicadoEm: "2027-10-10", precoAnterior: 119.9, novoPreco: 125.3 }],
  ["tipo de item inválido", { itemType: "outro", itemId: "mei", percentual: 4.5, dataBase: "2026-10-10", aplicadoEm: "2027-10-10", precoAnterior: 119.9, novoPreco: 125.3 }],
]) {
  let erro = false;
  try { montarRegistroReajuste(args); } catch { erro = true; }
  check(erro, `registro recusa ${rotulo}`);
}
check(completouPeriodoMinimo("2026-10-10T00:00:00Z", "2027-10-09T23:59:59Z") === false && completouPeriodoMinimo("2026-10-10T00:00:00Z", "2027-10-10T00:00:00Z") === true && completouPeriodoMinimo(null, AGORA) === false, "elegibilidade: só depois de 12 meses completos da primeira ativação (e nunca sem ativação)");
check(JSON.stringify({ PLAN_PRICES, ADDON_PRICES }) === antes, "nenhuma operação deste smoke alterou os preços");

// ---------- texto contratual ----------
check(F.TEXTO_REAJUSTE_ANUAL === "Os valores das assinaturas poderão ser reajustados anualmente, após o período mínimo de 12 meses, com base na variação do IPCA acumulado no período, ou outro índice que venha a substituí-lo, mediante comunicação prévia ao cliente.", "texto contratual do reajuste anual preparado em src/lib/plans.js (exatamente como definido)");

// ---------- migration 079 ----------
const sql = ler("supabase/migrations/079_coupons_and_price_adjustments.sql");
const semComentarios = sql.replace(/--.*$/gm, "");
check(/create table if not exists public\.coupons\b/.test(semComentarios) && /create table if not exists public\.coupon_redemptions\b/.test(semComentarios) && /create table if not exists public\.price_adjustments\b/.test(semComentarios), "migration 079 cria coupons, coupon_redemptions e price_adjustments");
check(!/create table (?!if not exists)/i.test(semComentarios) && !/create (unique )?index (?!if not exists)/i.test(semComentarios) && !/create function/i.test(semComentarios) && /add column if not exists coupon_id/.test(semComentarios), "migration idempotente: if not exists / create or replace / add column if not exists em tudo");
for (const t of ["coupons", "coupon_redemptions", "price_adjustments"]) {
  check(new RegExp(`alter table public\\.${t} enable row level security`).test(semComentarios) && new RegExp(`revoke all on public\\.${t} from public, anon, authenticated`).test(semComentarios), `${t}: RLS ligada, sem policies e sem grant para anon/authenticated (padrão da plataforma)`);
}
check(!/create policy/i.test(semComentarios), "nenhuma policy aberta ao lojista");
check(/grant execute on function public\.redeem_coupon\(text, uuid\)\s+to service_role/.test(semComentarios) && /grant execute on function public\.consume_coupon_cycle\(uuid, uuid\)\s+to service_role/.test(semComentarios), "funções redeem_coupon e consume_coupon_cycle só para o service role");
check(!/\binsert\s+into\s+public\.(coupons|price_adjustments)\b/i.test(semComentarios) && !/\bupdate\s+public\.(companies|pix_charges)\b/i.test(semComentarios) && !/\bdelete\s+from\b/i.test(semComentarios), "migration não cria cupom/reajuste de exemplo e não altera dados existentes");
check(/create table if not exists public\.coupon_redemptions[\s\S]*?discount_type text not null[\s\S]*?discount_value numeric\(10,2\) not null[\s\S]*?applies_to text not null[\s\S]*?cycles_total integer not null/.test(semComentarios) && /insert into public\.coupon_redemptions \(coupon_id, company_id, discount_type, discount_value, applies_to, cycles_total\)/.test(semComentarios), "migration: o resgate copia tipo, valor, alvo e ciclos do cupom (benefício independente de edições posteriores)");
check(/if not v_coupon\.active then/.test(semComentarios) && semComentarios.indexOf("already_redeemed") < semComentarios.indexOf("if not v_coupon.active then"), "migration: redeem_coupon devolve already_redeemed ANTES de checar active/expiração (desativar só bloqueia NOVOS resgates)");
check(/discount_type in \('percent', 'fixed'\)/.test(semComentarios) && /cycles integer not null default 1 check \(cycles >= 1\)/.test(semComentarios) && /starts_at timestamptz/.test(semComentarios) && /expires_at timestamptz/.test(semComentarios) && /max_redemptions/.test(semComentarios) && /redemptions_count/.test(semComentarios) && /active boolean not null default true/.test(semComentarios) && /code text not null/.test(semComentarios), "cupom: código, tipo, valor, ciclos, início, expiração, limite, usos e ativo/inativo");
check(/index_name text not null default 'IPCA'/.test(semComentarios) && /percent_applied/.test(semComentarios) && /base_date date not null/.test(semComentarios) && /applied_at timestamptz/.test(semComentarios) && /previous_price numeric/.test(semComentarios) && /new_price numeric/.test(semComentarios) && /\bnote text\b/.test(semComentarios), "reajuste: índice, percentual, data-base, data de aplicação, preço anterior, novo preço e observação");

// ---------- nada disso está ligado à cobrança real ----------
const usos = [];
const varre = (d) => {
  for (const n of readdirSync(d)) {
    const p = join(d, n);
    const s = statSync(p);
    if (s.isDirectory()) varre(p);
    else if (/\.(ts|js|jsx)$/.test(n) && !/\.test\./.test(n) && !/_shared[\\/](cupons|reajuste)\.ts$/.test(p) && /(from\s+["'][^"']*_shared\/(cupons|reajuste)(\.ts)?["']|rpc\(\s*["'](redeem_coupon|consume_coupon_cycle)|from\(\s*["'](coupons|coupon_redemptions|price_adjustments)["'])/.test(readFileSync(p, "utf8"))) usos.push(p.replace(raiz, ""));
  }
};
varre(resolve(raiz, "supabase/functions"));
varre(resolve(raiz, "src"));
check(usos.length === 0, `cupons e reajuste ainda não estão ligados a nenhuma Edge Function nem tela (checkout/cobrança inalterados)${usos.length ? ": " + usos.join(", ") : ""}`);
check(!/calcularCobranca|cupom/i.test(ler("supabase/functions/generate-pix-payment/index.ts")), "generate-pix-payment segue calculando só pelo preço-base (calcPlanMonthlyTotal)");

console.log("\nSmoke — cupons/bônus e estrutura de reajuste\n");
for (const m of ok) console.log(`  PASS  ${m}`);
for (const m of falhas) console.log(`  FAIL  ${m}`);
console.log(`\n${ok.length} passaram, ${falhas.length} falharam\n`);
process.exit(falhas.length ? 1 : 0);
