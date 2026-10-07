/**
 * Smoke do "Reimprimir" e da remoção do botão "PDF" no detalhe da venda (Gerenciador).
 *
 * 1. "Reimprimir" usa o printSaleReceipt do PDV (não há outra implementação de impressão) e nunca
 *    diz que imprimiu quando a impressão falhou: executa o printSaleReceipt real com impressora
 *    Electron ok / com erro, sem dispositivo, popup do navegador e venda ausente.
 * 2. O botão genérico "PDF" saiu; o "Reimprimir DANFE" continua só para NFC-e autorizada.
 * 3. Nada fiscal foi tocado por este PR.
 *
 * Uso: node scripts/smoke-reimprimir-venda.mjs
 */
import { readFileSync } from "fs";
import { resolve } from "path";
import { register } from "node:module";
import { avisoDaReimpressao, MSG_FALHA_IMPRESSAO } from "../src/lib/reimpressaoVenda.js";

const falhas = [];
const ok = [];
const check = (cond, msg) => (cond ? ok.push(msg) : falhas.push(msg));
const ler = (p) => readFileSync(resolve(process.cwd(), p), "utf8").split("\r\n").join("\n");

// O printSaleReceipt importa "@/..."; o hook só resolve o alias para src/ (código real, sem simulação).
const raiz = new URL("../src/", import.meta.url).href;
register(
  "data:text/javascript," +
    encodeURIComponent(`export async function resolve(s, c, n) {
  if (s.startsWith("@/")) return { url: ${JSON.stringify(raiz)} + s.slice(2) + ".js", shortCircuit: true };
  return n(s, c);
}`),
);
const { printSaleReceipt } = await import("../src/lib/saleReceipt.js");

const venda = {
  number: 6,
  items: [{ name: "Produto Teste R$ 1,00", price: 1, total: 1, quantity: 1 }],
  subtotal: "1",
  discount: "0",
  total: "1",
  payment_method: "credito",
  change: "0",
};
const aviso = async (ambiente) => {
  globalThis.window = ambiente;
  globalThis.localStorage = { getItem: () => null };
  try {
    return avisoDaReimpressao(await printSaleReceipt({ sale: venda }));
  } catch (e) {
    return { tipo: "excecao", mensagem: e.message };
  } finally {
    delete globalThis.window;
    delete globalThis.localStorage;
  }
};

// ---------- 1. comportamento real da reimpressão ----------
let enviado = null;
let r = await aviso({ electronAPI: { printHtml: async (p) => ((enviado = p), { ok: true }) } });
check(r.tipo === "sucesso" && r.mensagem === "Cupom enviado à impressora." && enviado?.silent === true && /produto teste/i.test(enviado.html), "Electron imprimiu: sucesso, e o HTML enviado é o cupom da venda");
r = await aviso({ electronAPI: { printHtml: async () => ({ ok: false, error: "Impressora não encontrada" }) } });
check(r.tipo === "erro" && r.mensagem === "Impressora não encontrada", "Electron recusou a impressão: ERRO com o motivo, nunca sucesso");
r = await aviso({ electronAPI: { printHtml: async () => ({ ok: false }) } });
check(r.tipo === "erro" && r.mensagem === MSG_FALHA_IMPRESSAO, "Electron falhou sem motivo: erro com a mensagem padrão (verifique a impressora)");
r = await aviso({ electronAPI: { printHtml: async () => { throw new Error("spooler parado"); } } });
check(r.tipo === "erro" && r.mensagem === "spooler parado", "Electron lançou exceção: erro com a mensagem");
r = await aviso({}); // sem dispositivo e sem window.open: a janela de impressão não pode abrir
check(r.tipo === "erro", "sem impressora Electron e sem como abrir a janela de impressão: ERRO, não sucesso");
const escrito = [];
r = await aviso({ open: () => ({ document: { open() {}, write: (h) => escrito.push(h), close() {} } }) });
check(r.tipo === "info" && !/imprimiu|enviado à impressora/i.test(r.mensagem) && escrito.length === 1, "navegador: só 'janela de impressão aberta' (aviso neutro), sem afirmar que imprimiu");
check((await aviso(undefined)).tipo === "erro", "sem ambiente de navegador nenhum: erro");
globalThis.window = {};
const semVenda = await printSaleReceipt({});
delete globalThis.window;
check(semVenda.ok === false && avisoDaReimpressao(semVenda).tipo === "erro", "sem venda: ok=false e erro (nada é impresso)");
check(avisoDaReimpressao(null).tipo === "erro" && avisoDaReimpressao(undefined).tipo === "erro" && avisoDaReimpressao({}).tipo === "erro", "resultado ausente ou vazio nunca vira sucesso");
check(avisoDaReimpressao({ ok: "true" }).tipo === "erro", "só ok === true conta como impresso");

// ---------- 2. código do detalhe da venda ----------
const dialogo = ler("src/components/sales/SaleDetailDialog.jsx");
check(dialogo.includes('import { printSaleReceipt } from "@/lib/saleReceipt";') && dialogo.includes("await printSaleReceipt({ sale,"), '"Reimprimir" chama o printSaleReceipt do PDV');
check(dialogo.includes("avisoDaReimpressao(resultado)") && !dialogo.includes("Reimpressão solicitada"), "o aviso vem do resultado real; o toast falso 'Reimpressão solicitada' saiu");
check(dialogo.includes("catch (e)") && dialogo.includes("toast.error(mensagemDeErro(e, \"imprimir o cupom\", { fallback: MSG_FALHA_IMPRESSAO }))"), "exceção na impressão vira erro na tela");
check(dialogo.includes("disabled={imprimindo}") && dialogo.includes("if (imprimindoRef.current) return;") && dialogo.includes("imprimindoRef.current = false;"), "clique duplo não imprime duas vezes (trava síncrona por ref)");
check(dialogo.includes("({ sucesso: toast.success, info: toast.info, erro: toast.error })[aviso.tipo]") && !dialogo.includes("toast[aviso.tipo"), "cada tipo de aviso (sucesso/info/erro) mapeia para um toast que existe");
check(!/>\s*PDF\s*</.test(dialogo) && !dialogo.includes("handlePDF") && !dialogo.includes("Exportação para PDF"), 'o botão genérico "PDF" saiu do detalhe da venda');
check(!dialogo.includes("FileText"), "sem sobra do ícone do botão removido");
check(
  dialogo.includes("acaoFiscal === ACAO_FISCAL.AUTORIZADA") && dialogo.includes("Reimprimir DANFE") && dialogo.includes("abrirNfceDanfePdf") && dialogo.includes("onClick={handleDanfe}"),
  '"Reimprimir DANFE" continua, só para NFC-e autorizada, com o gerador existente',
);
check(dialogo.split("abrirNfceDanfePdf(").length === 2 && dialogo.split("/> Reimprimir DANFE").length === 2, "continua uma única ação de PDF/DANFE (nenhum gerador de PDF novo)");
check(dialogo.includes("Baixar XML") && dialogo.includes("baixarXmlNfce(fiscalDoc)"), "Baixar XML segue como estava");
check(dialogo.includes("SendWhatsAppDialog") && dialogo.includes("SendEmailDialog") && dialogo.includes("handleWhatsApp") && dialogo.includes("handleEmail"), "WhatsApp e E-mail não foram tocados");

// ---------- 3. nada fiscal foi tocado ----------
const helper = ler("src/lib/reimpressaoVenda.js");
check(!/fetch\(|functions|sefaz|fiscal/i.test(helper.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")), "o helper da reimpressão é puro: sem rede, SEFAZ ou fiscal");
check(!/window|document|localStorage|print\(/.test(helper.replace(/\/\/.*$/gm, "")), "o helper não implementa impressão (só interpreta o resultado do printSaleReceipt)");

console.log("\nSmoke — Reimprimir e remoção do botão PDF (detalhe da venda)\n");
for (const m of ok) console.log(`  PASS  ${m}`);
for (const m of falhas) console.log(`  FAIL  ${m}`);
console.log(`\n${ok.length} passaram, ${falhas.length} falharam\n`);
process.exit(falhas.length ? 1 : 0);
