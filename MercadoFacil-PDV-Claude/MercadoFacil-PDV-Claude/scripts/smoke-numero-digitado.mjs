/**
 * Smoke do campo numérico digitado (Estoque e Est. Mínimo do cadastro/edição de produto).
 *
 * Bug: o campo começa em "0" e, ao digitar 1, ficava "01". Agora o zero à esquerda some
 * (semZerosAEsquerda), o texto é selecionado ao focar (digitar substitui o 0) e campo vazio
 * volta a "0" ao sair. Sem rede, sem banco.
 *
 * Modela o <input type="number"> controlado: texto, seleção, digitar, apagar e sair do campo,
 * com a MESMA função e as mesmas regras de onChange/onFocus/onBlur do ProductDialog.jsx
 * (conferidas no código). Roda cadastro (campo novo em "0") e edição (valor do produto).
 *
 * Uso: node scripts/smoke-numero-digitado.mjs
 */
import { readFileSync } from "fs";
import { resolve } from "path";
import { semZerosAEsquerda } from "../src/lib/numberInput.js";

const falhas = [];
const ok = [];
const check = (cond, msg) => (cond ? ok.push(msg) : falhas.push(msg));

// ---------- função pura ----------
for (const [entrada, esperado] of [
  ["", ""], ["0", "0"], ["01", "1"], ["001", "1"], ["10", "10"], ["25", "25"], ["007", "7"], ["00", "0"],
  ["0.5", "0.5"], ["0,5", "0,5"], ["00.5", "0.5"], ["1.05", "1.05"], ["100", "100"], ["-01", "-1"], ["-0", "-0"],
]) {
  check(semZerosAEsquerda(entrada) === esperado, `semZerosAEsquerda("${entrada}") = "${esperado}"`);
}
check(semZerosAEsquerda(null) === "" && semZerosAEsquerda(undefined) === "", "nulo e indefinido viram texto vazio");

// ---------- modelo do campo (mesmas regras do ProductDialog) ----------
function campo(inicial) {
  const c = { valor: String(inicial), ini: 0, fim: 0 };
  c.foco = () => { c.ini = 0; c.fim = c.valor.length; return c; }; // onFocus: select()
  c.cursorNoFim = () => { c.ini = c.fim = c.valor.length; return c; }; // clicou depois do texto
  const aplicar = (texto) => { c.valor = semZerosAEsquerda(texto); c.ini = c.fim = c.valor.length; }; // onChange
  c.digita = (t) => { for (const ch of t) aplicar(c.valor.slice(0, c.ini) + ch + c.valor.slice(c.fim)); return c; };
  c.apaga = (n = 1) => {
    for (let i = 0; i < n; i++) {
      if (c.ini !== c.fim) aplicar(c.valor.slice(0, c.ini) + c.valor.slice(c.fim));
      else if (c.ini > 0) aplicar(c.valor.slice(0, c.ini - 1) + c.valor.slice(c.fim));
    }
    return c;
  };
  c.sai = () => { if (!c.valor) c.valor = "0"; return c; }; // onBlur: vazio volta a "0"
  return c;
}
const semZeroEsquerda = (v) => !/^-?0\d/.test(v);

// Cadastro (campo novo começa em "0") e edição (começa com o estoque do produto)
for (const [contexto, inicial] of [["cadastro", "0"], ["edição", "0"]]) {
  // 0 → 1, 0 → 10, 0 → 25 clicando no campo (texto selecionado)
  for (const [digitado, esperado] of [["1", "1"], ["10", "10"], ["25", "25"]]) {
    const c = campo(inicial).foco().digita(digitado).sai();
    check(c.valor === esperado && parseFloat(c.valor) === Number(esperado) && semZeroEsquerda(c.valor), `${contexto}: 0 → digitar ${digitado} = ${esperado}`);
  }
  // o bug original: cursor depois do 0 (sem selecionar) e digitar 1, 10, 25
  for (const [digitado, esperado] of [["1", "1"], ["10", "10"], ["25", "25"]]) {
    const c = campo(inicial).cursorNoFim().digita(digitado).sai();
    check(c.valor === esperado && semZeroEsquerda(c.valor), `${contexto}: 0 com cursor no fim → digitar ${digitado} = ${esperado} (nunca "0${digitado}")`);
  }
}
{ // edição: 10 → 25 e 25 → 0
  const dezParaVinteCinco = campo("10").foco().digita("25").sai();
  check(dezParaVinteCinco.valor === "25", "edição: 10 → 25");
  const dezApagando = campo("10").cursorNoFim().apaga(2).digita("25").sai();
  check(dezApagando.valor === "25", "edição: 10 → apagar tudo e digitar 25 = 25");
  const vinteCincoParaZero = campo("25").foco().digita("0").sai();
  check(vinteCincoParaZero.valor === "0" && parseFloat(vinteCincoParaZero.valor) === 0, "edição: 25 → digitar 0 = 0");
  const apagando = campo("25").cursorNoFim().apaga(2).digita("0").sai();
  check(apagando.valor === "0", "edição: 25 → apagar tudo e digitar 0 = 0");
  const vazio = campo("25").cursorNoFim().apaga(2).sai();
  check(vazio.valor === "0" && parseFloat(vazio.valor) === 0, "campo apagado e abandonado volta a 0");
}
{ // 0 que deve ficar, decimais e sequências longas
  check(campo("0").sai().valor === "0", "0 sem digitar nada continua 0");
  check(campo("0").cursorNoFim().digita("0").valor === "0", "0 + digitar 0 continua 0 (não vira 00)");
  const dec = campo("0").cursorNoFim().digita("0.5");
  check(dec.valor === "0.5" && parseFloat(dec.valor) === 0.5, "0 + digitar 0.5 mantém 0.5 (estoque fracionado)");
  const longo = campo("0").foco().digita("100");
  check(longo.valor === "100" && semZeroEsquerda(longo.valor), "digitar 100 fica 100 (zeros do meio e do fim preservados)");
  const passo = campo("0").cursorNoFim();
  const vistos = [];
  for (const ch of "1203") { passo.digita(ch); vistos.push(passo.valor); }
  check(vistos.join() === "1,12,120,1203" && vistos.every(semZeroEsquerda), `digitando 1,2,0,3 o campo passa por ${vistos.join(" → ")}`);
}

// ---------- ligação no formulário (conferida no código) ----------
const dlg = readFileSync(resolve(process.cwd(), "src/components/products/ProductDialog.jsx"), "utf8").split("\r\n").join("\n");
for (const campoNome of ["stock", "min_stock"]) {
  check(dlg.includes(`value={form.${campoNome} ?? ""}`) && dlg.includes(`handleChange("${campoNome}", semZerosAEsquerda(e.target.value))`) && dlg.includes("onFocus={(e) => e.target.select()}") && dlg.includes(`onBlur={() => !form.${campoNome} && handleChange("${campoNome}", "0")}`),
    `ProductDialog: campo ${campoNome} usa semZerosAEsquerda, seleciona ao focar e volta a "0" ao sair vazio`);
}
check(!/value=\{form\.stock \|\| "0"\}/.test(dlg), 'ProductDialog: o fallback value={form.stock || "0"} (que impedia apagar o 0) foi removido');
check(dlg.includes("stock: product ? undefined : parseFloat(form.stock) || 0") && dlg.includes("const novoValor = parseFloat(form.stock) || 0;"), "regras de estoque do salvamento intactas (novo produto grava o estoque; edição passa por movimentação)");

console.log("\nSmoke — campo numérico digitado (Estoque / Est. Mínimo)\n");
for (const m of ok) console.log(`  PASS  ${m}`);
for (const m of falhas) console.log(`  FAIL  ${m}`);
console.log(`\n${ok.length} passaram, ${falhas.length} falharam\n`);
process.exit(falhas.length ? 1 : 0);
