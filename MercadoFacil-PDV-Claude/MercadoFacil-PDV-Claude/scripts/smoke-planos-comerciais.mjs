/**
 * Smoke dos planos comerciais: textos, preços e adicionais em src/lib/plans.js (fonte única) e o espelho do
 * servidor supabase/functions/_shared/plans.ts. TEF NÃO é incluso em plano; Delivery e Pesagem não existem
 * nos planos. Sem rede.
 *
 * Uso: node scripts/smoke-planos-comerciais.mjs
 */
import { readFileSync, readdirSync, statSync } from "fs";
import { join, resolve } from "path";

const falhas = [];
const ok = [];
const check = (cond, msg) => (cond ? ok.push(msg) : falhas.push(msg));
const raiz = process.cwd();
const ler = (p) => readFileSync(resolve(raiz, p), "utf8").split("\r\n").join("\n");

// ---- avalia src/lib/plans.js sem React: troca os imports por stubs ----
const fonte = ler("src/lib/plans.js");
const corpo = fonte
  .replace(/^import .*$/gm, "")
  .replace(/export const /g, "const ")
  .concat("\nreturn { PLANS, PAYMENT_ADDONS, EXTRA_ADDONS, ADDONS, ADDONS_TAGLINE, getMonthlyTotal, isAddonIncluded, formatAddonPrice, formatMonthlyPrice, TRIAL_DAYS };");
const brl = (n) => `R$ ${n.toFixed(2).replace(".", ",")}`;
const P = new Function("Zap", "Crown", "formatBRL", "roundMoney", corpo)(null, null, brl, (n) => Math.round(n * 100) / 100);
const mei = P.PLANS.find((p) => p.id === "mei");
const sn = P.PLANS.find((p) => p.id === "simples");

// ---------- MEI ----------
check(mei.monthlyPrice === 119.9 && sn.monthlyPrice === 169.9, "preços dos planos mantidos: MEI R$ 119,90 e Simples Nacional R$ 169,90");
check(mei.subtitle === "Para o MEI organizar as vendas do dia a dia" && mei.tagline === "Comece a vender e organize seu negócio.", "MEI: descrição e frase de destaque");
check(JSON.stringify(mei.features) === JSON.stringify(["PDV completo e rápido", "Produtos, preços e estoque", "Promoções e preços de atacado", "Clientes e crediário", "Controle de caixa", "Vendas online e offline", "Relatórios de vendas", "Cadastro de serviços", "Agenda"]), "MEI: os 9 recursos, na ordem pedida");
// ---------- Simples Nacional ----------
check(sn.subtitle === "Para negócios que precisam de gestão completa e emissão fiscal" && sn.tagline === "Tenha gestão completa e emissão fiscal.", "Simples Nacional: descrição e frase de destaque");
check(JSON.stringify(sn.features) === JSON.stringify(["Tudo do MEI", "NFC-e e NF-e", "Operação fiscal integrada ao PDV", "Fila fiscal offline", "XML para o contador", "Relatórios fiscais", "Controle financeiro completo", "Contas a pagar e receber", "Fluxo de caixa", "Gestão de fornecedores"]), "Simples Nacional: os 10 recursos, na ordem pedida");
check(sn.highlighted === true && P.PLANS.length === 2, "estrutura mantida: 2 planos, Simples Nacional recomendado");
// ---------- TEF não é incluso ----------
const todosTextos = JSON.stringify(P.PLANS) + JSON.stringify(P.ADDONS);
check(!/TEF integrado/i.test(todosTextos), "nenhum plano diz 'TEF integrado'");
check(![...mei.features, ...sn.features, ...mei.notIncluded, ...sn.notIncluded].some((t) => /tef/i.test(t)), "nenhum recurso de plano menciona TEF (nem como incluso nem como excluído)");
check(P.ADDONS.every((a) => !a.includedInPlanIds) && P.ADDONS.every((a) => !P.isAddonIncluded(a.id, "simples") && !P.isAddonIncluded(a.id, "mei")), "nenhum adicional é incluso em plano");
check(P.getMonthlyTotal("simples", ["tef_sitef"]) === 259.9 && P.getMonthlyTotal("mei", ["tef_sitef"]) === 209.9, "TEF soma R$ 90,00 também no Simples Nacional (169,90 + 90 = 259,90) e no MEI (119,90 + 90 = 209,90)");
// ---------- adicionais ----------
const ad = Object.fromEntries(P.ADDONS.map((a) => [a.id, a]));
check(ad.pdv_pos.monthlyPrice === 50 && ad.pdv_pos.description === "Integração com maquininha Smart compatível." && P.formatAddonPrice(ad.pdv_pos) === "+ R$ 50,00/mês por equipamento", "PDV POS: + R$ 50,00/mês por equipamento");
check(ad.tef_sitef.label === "TEF (SiTef)" && ad.tef_sitef.description === "Pinpad no caixa / adquirente." && P.formatAddonPrice(ad.tef_sitef) === "a partir de + R$ 90,00/mês", "TEF (SiTef): a partir de + R$ 90,00/mês");
check(ad.whatsapp.label === "WhatsApp" && ad.whatsapp.monthlyPrice === 19.9 && ad.whatsapp.description === "Comprovantes e cobrança de parcelas pelo WhatsApp." && P.formatAddonPrice(ad.whatsapp) === "+ R$ 19,90/mês", "WhatsApp: + R$ 19,90/mês");
check(ad.nfse.label === "NFS-e" && ad.nfse.monthlyPrice === 29.9 && ad.nfse.description === "Emissão de Nota Fiscal de Serviço." && P.formatAddonPrice(ad.nfse) === "+ R$ 29,90/mês", "NFS-e: + R$ 29,90/mês");
check(JSON.stringify(P.PAYMENT_ADDONS.map((a) => a.id)) === '["pdv_pos","tef_sitef"]' && JSON.stringify(P.EXTRA_ADDONS.map((a) => a.id)) === '["whatsapp","nfse","mesas"]', "grupos: 2 — Pagamentos integrados (PDV POS, TEF) e 3 — Módulos extras (WhatsApp, NFS-e, Mesas)");
check(ad.mesas.label === "Mesas" && ad.mesas.monthlyPrice === 19.9 && P.formatAddonPrice(ad.mesas) === "+ R$ 19,90/mês" && !ad.mesas.includedInPlanIds, "Mesas: adicional + R$ 19,90/mês, não incluso em plano");
check(P.ADDONS_TAGLINE === "Ative somente os recursos que sua empresa precisa.", "frase de destaque dos adicionais");
check(!/delivery|pesagem|motoboy/i.test(todosTextos), "Delivery, Pesagem automática e Motoboy não aparecem nos planos nem nos adicionais");

// ---------- consistência: WhatsApp da tela Integrações e espelho do servidor ----------
const wa = ler("src/lib/whatsappAddon.js");
check(/price: 19\.9,/.test(wa) && wa.includes('priceLabel: "R$ 19,90"') && !/R\$ 50,00/.test(wa), "Integração WhatsApp cobra e exibe R$ 19,90 (igual ao adicional do plano)");
const ts = ler("supabase/functions/_shared/plans.ts");
const num = (re) => Number(re.exec(ts)?.[1]);
check(num(/mei: ([\d.]+)/) === mei.monthlyPrice && num(/simples: ([\d.]+)/) === sn.monthlyPrice, "espelho do servidor: preços dos planos iguais");
check(num(/pdv_pos: ([\d.]+)/) === ad.pdv_pos.monthlyPrice && num(/tef_sitef: ([\d.]+)/) === ad.tef_sitef.monthlyPrice && num(/nfse: ([\d.]+)/) === ad.nfse.monthlyPrice && num(/whatsapp: ([\d.]+)/) === ad.whatsapp.monthlyPrice && num(/mesas: ([\d.]+)/) === ad.mesas.monthlyPrice, "espelho do servidor: preços dos 4 adicionais iguais");
check(/ADDON_INCLUDED_IN_PLAN: Record<string, string\[\]> = \{\};/.test(ts) && !/tef_sitef: \["simples"\]/.test(ts), "espelho do servidor: TEF também não é incluso no Simples Nacional");

// ---------- nenhuma tela ainda promete TEF incluso ----------
const arquivos = [];
const varre = (d) => {
  for (const n of readdirSync(d)) {
    const p = join(d, n);
    const s = statSync(p);
    if (s.isDirectory()) varre(p);
    else if (/\.(js|jsx|ts)$/.test(n) && !/\.test\./.test(n)) arquivos.push(p);
  }
};
varre(resolve(raiz, "src"));
varre(resolve(raiz, "supabase/functions"));
const promessas = arquivos.filter((p) => /TEF integrado|TEF.{0,30}incluso|incluso.{0,30}TEF/i.test(readFileSync(p, "utf8").replace(/\/\/.*$/gm, "")));
check(promessas.length === 0, `nenhum texto de tela promete TEF incluso${promessas.length ? ": " + promessas.join(", ") : ""}`);

// ---------- telas usam a fonte única ----------
const landing = ler("src/components/landing/LandingPlans.jsx");
check(landing.includes("formatAddonPrice(a)") && landing.includes("{p.tagline}") && landing.includes("{ADDONS_TAGLINE}") && landing.includes("whatsapp: MessageCircle"), "Landing: preço dos adicionais, frases de destaque e ícone do WhatsApp vindos de plans.js");
check(ler("src/pages/PlanSelection.jsx").includes("formatAddonPrice(addon)") && ler("src/pages/Plano.jsx").includes("formatAddonPrice(addon)"), "Planos (escolha e troca de plano) usam o mesmo formato de preço dos adicionais");

// ---------- adicionais como cartões selecionáveis (2 colunas), em Planos ----------
const cartao = ler("src/components/plans/AddonCard.jsx");
check(cartao.includes('type="checkbox"') && cartao.includes("rounded-full border-2") && cartao.includes("rounded-xl border-2"), "AddonCard: cartão com seletor redondo, mantendo um checkbox real (acessível por teclado)");
for (const arq of ["src/pages/PlanSelection.jsx", "src/pages/Plano.jsx"]) {
  const t = ler(arq);
  check((t.match(/<AddonCard\b/g) || []).length === 2 && (t.match(/grid sm:grid-cols-2 gap-3/g) || []).length >= 2 && t.includes("onToggle={() => toggleAddon(addon.id)}") && !/space-y-2[^"]*">\s*\n\s*\{(PAYMENT|EXTRA)_ADDONS/.test(t), `${arq}: pagamentos integrados e módulos extras em cartões de 2 colunas (mesma regra de seleção)`);
}

// ---------- chave mensal/anual: fogos de artifício e preços em "roleta" ----------
const planoTela = ler("src/pages/Plano.jsx");
check(planoTela.includes("dispararConfete(chaveCicloRef.current)") && /proximo === "anual"/.test(planoTela) && planoTela.includes("ref={chaveCicloRef}") && planoTela.includes("onClick={alternarCiclo}"), "Plano: ao ligar o anual a chave dispara o confete");
check((planoTela.match(/<PrecoAnimado /g) || []).length === 3, "Plano: os 3 preços (plano atual, mensalidade e valor cobrado por ano) usam a animação de roleta");
const conf = ler("src/lib/confetePlanos.js");
check(conf.includes("disableForReducedMotion: true") && conf.includes("--primary") && !/#[0-9a-f]{6}['"]/i.test(conf.replace(/\/\/.*$/gm, "").replace(/`[^`]*`/g, "")), "confete: cores derivadas do tema (--primary), sem cores novas, e respeita prefers-reduced-motion");
// A CSP do site (vercel.json) não tem worker-src blob: -> o confete padrão (Web Worker via Blob) é bloqueado em produção
const cspVercel = ler("vercel.json");
check(/Content-Security-Policy/.test(cspVercel) && !/worker-src/.test(cspVercel), "CSP do site continua sem worker-src (não foi afrouxada para o confete funcionar)");
check(/confetti\.create\(canvas, \{ resize: true, useWorker: false \}\)/.test(conf) && !/(^|[^.\w])confetti\(\{/.test(conf), "confete roda em canvas próprio com useWorker: false (funciona sob a CSP; a chamada padrão com Worker/Blob some em produção)");
check(ler("src/types/canvas-confetti.d.ts").includes("create:"), "tipos do confetti.create declarados (typecheck)");
check(ler("src/components/plans/PrecoAnimado.jsx").includes('currency: "BRL"') && ler("package.json").includes('"@number-flow/react"') && ler("package.json").includes('"canvas-confetti"'), "PrecoAnimado formata em R$ e as duas dependências estão no package.json");

console.log("\nSmoke — planos comerciais\n");
for (const m of ok) console.log(`  PASS  ${m}`);
for (const m of falhas) console.log(`  FAIL  ${m}`);
console.log(`\n${ok.length} passaram, ${falhas.length} falharam\n`);
process.exit(falhas.length ? 1 : 0);
