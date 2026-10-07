/**
 * Smoke dos cartões/comandas com QR (sem rede): src/lib/cartaoQr.js + integração com Mesas/Cartões/PDV.
 * O QR/número identifica o CARTÃO físico reutilizável; a mesa é opcional no atendimento.
 * Cobre: faixa de cartões, QR único por cartão e por empresa, localizar por QR ou número, DISPONÍVEL/EM USO,
 * um atendimento por cartão (inclusive em corrida), encerrar devolve o cartão, reutilização, mesa opcional,
 * impressão, QR inválido/adulterado, isolamento por empresa (RLS simulada + migration 081), restaurante sem NF
 * vendendo normalmente, emissão fiscal exigindo configuração válida, sem duplicar venda/estoque.
 * Uso: node scripts/smoke-mesas-qr.mjs
 */
import { readFileSync } from "fs";
import {
  PREFIXO_QR, MAX_CARTOES, tokenDoCartao, payloadDoCartao, pareceQrDeCartao, resolverQrCartao, interpretarEntradaCartao,
  normalizarNumeroCartao, numeroExibicao, rotuloDoCartao, localizarCartao, abrirAtendimentoDoCartao, listarCartoes,
  cartaoExiste, normalizarMesa, qrSvg, montarFolhaCartoes, LAYOUTS_CARTAO, MSG_QR_INVALIDO, MSG_NAO_ENCONTRADO, MSG_ENTRADA_INVALIDA,
} from "../src/lib/cartaoQr.js";
import { cameraQrDisponivel } from "../src/lib/qrCamera.js";
import {
  novaPessoa, atualizarPessoa, adicionarProduto, montarCarrinho, bloqueioFiscalDoAlmoco, ORIGEM_ALMOCO, aplicarPagamento,
  totaisDaMesa, abrirOuVerAtendimento, rotuloDoAtendimento,
} from "../src/lib/mesas.js";

const falhas = [];
let passaram = 0;
const check = (cond, msg) => (cond ? passaram++ : falhas.push(msg));
const ler = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

/**
 * table_orders em memória com as MESMAS regras do banco (080 + 081): RLS por empresa, um aberto por cartão e,
 * só para atendimento sem cartão, um aberto por mesa. `storeDe(empresa)` faz o papel da sessão autenticada.
 */
function bancoEmMemoria({ corrida = false } = {}) {
  const linhas = [];
  let n = 0;
  const storeDe = (empresa) => ({
    buscarAberto: async (numero) => linhas.find((o) => o.company_id === empresa && o.status === "aberta" && o.card_number === String(numero)) || null,
    criar: async (numero, { mesa = null } = {}) => {
      if (corrida && !linhas.some((o) => o.company_id === empresa && o.status === "aberta" && o.card_number === String(numero))) {
        linhas.push({ id: `outro-${numero}`, company_id: empresa, card_number: String(numero), table_number: null, status: "aberta", people: [], items: [], sale_ids: [] });
      }
      if (linhas.some((o) => o.company_id === empresa && o.status === "aberta" && o.card_number === String(numero))) {
        throw new Error('duplicate key value violates unique constraint "table_orders_open_card_uidx"');
      }
      const o = { id: `ord-${++n}`, company_id: empresa, card_number: String(numero), table_number: mesa, status: "aberta", people: [], items: [], sale_ids: [] };
      linhas.push(o);
      return o;
    },
  });
  const storeMesaDe = (empresa) => ({
    buscarAberto: async (numero) => linhas.find((o) => o.company_id === empresa && o.status === "aberta" && o.table_number === String(numero) && !o.card_number) || null,
    criar: async (numero) => {
      if (linhas.some((o) => o.company_id === empresa && o.status === "aberta" && o.table_number === String(numero) && !o.card_number)) {
        throw new Error('duplicate key value violates unique constraint "table_orders_open_uidx"');
      }
      const o = { id: `ord-${++n}`, company_id: empresa, table_number: String(numero), card_number: null, status: "aberta", people: [], items: [], sale_ids: [] };
      linhas.push(o);
      return o;
    },
  });
  return { linhas, storeDe, storeMesaDe, abertas: (empresa) => linhas.filter((o) => o.company_id === empresa && o.status === "aberta") };
}

// ---------- 1. criar cartões (faixa) ----------
const faixa = { inicial: 1, final: 5 };
let lista = listarCartoes(faixa, []);
check(lista.length === 5 && lista.map((c) => c.numero).join() === "1,2,3,4,5" && lista.every((c) => c.estado === "disponivel"), "faixa 1..5 gera 5 cartões, todos DISPONÍVEIS");
check(listarCartoes({ inicial: 10, final: 12 }, []).map((c) => c.numero).join() === "10,11,12", "número inicial/final configuráveis (10..12)");
check(listarCartoes({ inicial: 1, final: 5000 }, []).length === MAX_CARTOES, `limite de ${MAX_CARTOES} cartões`);
check(numeroExibicao("23") === "023" && rotuloDoCartao("7") === "Cartão 007" && rotuloDoCartao("100") === "Cartão 100", "cartão aparece como 001, 023, 100");
check(listarCartoes({ inicial: 1, final: 3 }, [{ card_number: "50", status: "aberta" }]).some((c) => c.numero === "50" && c.estado === "em_uso"), "cartão em uso fora da faixa (faixa reduzida depois) continua visível");

// ---------- 2. QR único por cartão ----------
const tokensA = await Promise.all(Array.from({ length: MAX_CARTOES }, (_, i) => tokenDoCartao(A, i + 1)));
const tokensB = await Promise.all(Array.from({ length: MAX_CARTOES }, (_, i) => tokenDoCartao(B, i + 1)));
check(new Set(tokensA).size === MAX_CARTOES && tokensA.every((t) => /^[0-9a-f]{20}$/.test(t)), `cada cartão tem um QR único (${MAX_CARTOES} cartões, token de 80 bits)`);
check((await tokenDoCartao(A, 23)) === (await tokenDoCartao(A, " 023 ")) && (await tokenDoCartao(A, 23)) === tokensA[22], "QR persistente: 23, '023' e ' 023 ' geram o mesmo QR");
const p23 = await payloadDoCartao(A, 23);
check(p23.startsWith(PREFIXO_QR) && p23.length === PREFIXO_QR.length + 20, "payload MFCARTAO-<token>");
check(!p23.includes(A) && !p23.includes(A.replace(/-/g, "")) && !p23.slice(PREFIXO_QR.length).includes("023"), "QR não expõe company_id nem o número do cartão em texto claro");
let semEmpresa = false;
try { await tokenDoCartao("", 1); } catch { semEmpresa = true; }
let numeroRuim = false;
try { await tokenDoCartao(A, "abc"); } catch { numeroRuim = true; }
check(semEmpresa && numeroRuim, "sem empresa ou com número inválido não gera token");

// ---------- 3. cartão da empresa A não funciona na B ----------
check(!tokensA.some((t) => tokensB.includes(t)), "duas empresas não compartilham nenhum QR (mesmo número, empresa diferente = token diferente)");
const deB = await payloadDoCartao(B, 23);
let r = await resolverQrCartao(deB, A);
check(!r.ok && r.motivo === "invalido" && r.mensagem === MSG_QR_INVALIDO, "QR do cartão da empresa B lido na empresa A é recusado");
check((await resolverQrCartao(deB, B)).numero === "23", "o mesmo QR continua valendo na empresa B");
let nenhum = true;
for (let n = 1; n <= 30; n++) if ((await resolverQrCartao(await payloadDoCartao(B, n), A)).ok) nenhum = false;
check(nenhum, "nenhum QR da empresa B resolve na empresa A");

// ---------- 6/7. localizar por QR e por número (mesmo fluxo) ----------
r = await interpretarEntradaCartao(p23, A);
check(r.ok && r.numero === "23" && r.origem === "qr", "QR resolve para o cartão 23");
for (const entrada of ["23", "023", " 023 ", "0023"]) {
  const x = await interpretarEntradaCartao(entrada, A);
  check(x.ok && x.numero === "23" && x.origem === "numero", `número digitado '${entrada}' resolve para o cartão 23`);
}
r = await interpretarEntradaCartao(`  ${p23}\n`, A);
check(r.ok && r.numero === "23", "espaços/quebra de linha do leitor USB não atrapalham");
for (const ruim of ["", "abc", "0", "1000", "-5", "12.5", "7891234567890", null, undefined]) {
  const x = await interpretarEntradaCartao(ruim, A);
  check(!x.ok && x.motivo === "entrada_invalida" && x.mensagem === MSG_ENTRADA_INVALIDA, `entrada inválida recusada: ${JSON.stringify(ruim)}`);
}
check(normalizarNumeroCartao(999) === "999" && normalizarNumeroCartao(1000) === null && normalizarNumeroCartao("00") === null, "números válidos: 1..999");
check(pareceQrDeCartao(p23) && !pareceQrDeCartao("7891234567890") && !pareceQrDeCartao(null), "leitor USB separa QR de cartão de código de barras de produto");

// ---------- 16/17. QR inválido e adulterado ----------
for (const texto of [`${PREFIXO_QR}`, `${PREFIXO_QR}xyz`, `${PREFIXO_QR}${"0".repeat(20)}`, `${PREFIXO_QR}${tokensA[0].slice(0, 19)}`, `${PREFIXO_QR}${tokensA[0].toUpperCase()}`, `${PREFIXO_QR}${tokensA[0]}00`, `${PREFIXO_QR}${tokensA[0].slice(0, 19)}${tokensA[0].endsWith("0") ? "1" : "0"}`, "MFMESA-" + tokensA[0], `${PREFIXO_QR}${A}`]) {
  const x = await resolverQrCartao(texto, A);
  check(!x.ok, `QR inválido/adulterado recusado: ${texto.slice(0, 34)}`);
}
check((await resolverQrCartao("MFMESA-abc", A)).motivo === "nao_e_qr_de_cartao", "QR antigo de mesa não vale como cartão");

// ---------- 4/5/8/9. disponível, em uso, ler de novo, um atendimento por cartão ----------
const db = bancoEmMemoria();
const sa = db.storeDe(A);
check((await localizarCartao(sa, "23", { inicial: 1, final: 100 })).estado === "disponivel", "cartão sem atendimento aberto: DISPONÍVEL");
check((await localizarCartao(sa, "500", { inicial: 1, final: 100 })).estado === "nao_encontrado", "cartão fora da faixa e sem uso: 'Cartão não encontrado'");
check(MSG_NAO_ENCONTRADO === "Cartão não encontrado.", "mensagem 'Cartão não encontrado.'");
check(cartaoExiste("100", { inicial: 1, final: 100 }) && !cartaoExiste("101", { inicial: 1, final: 100 }) && cartaoExiste("101", { inicial: 1, final: 100 }, true), "existe = dentro da faixa ou já em uso");
const a1 = await abrirAtendimentoDoCartao(sa, "23");
check(a1.acao === "abrir" && a1.order.card_number === "23" && a1.order.company_id === A, "cartão DISPONÍVEL: abre atendimento novo (com a empresa da sessão)");
const lido = await localizarCartao(sa, "23", { inicial: 1, final: 100 });
check(lido.estado === "em_uso" && lido.order.id === a1.order.id, "cartão EM USO: localiza o atendimento existente");
const a2 = await abrirAtendimentoDoCartao(sa, "23");
check(a2.acao === "ver" && a2.order.id === a1.order.id, "ler de novo um cartão em uso abre o atendimento existente");
for (let i = 0; i < 5; i++) await abrirAtendimentoDoCartao(sa, "23");
check(db.abertas(A).length === 1, "nunca existem dois atendimentos abertos no mesmo cartão");
let duplicou = false;
try { await sa.criar("23"); } catch (e) { duplicou = /open_card_uidx/.test(e.message); }
check(duplicou, "o banco recusa o segundo atendimento aberto do cartão (índice único da 081)");
const dbCorrida = bancoEmMemoria({ corrida: true });
const cc = await abrirAtendimentoDoCartao(dbCorrida.storeDe(A), "9");
check(cc.acao === "ver" && cc.order.id === "outro-9" && dbCorrida.abertas(A).length === 1, "corrida entre dois caixas: o índice recusa e o cartão mostra o atendimento que já existe");
let erroReal = false;
try { await abrirAtendimentoDoCartao({ buscarAberto: async () => null, criar: async () => { throw new Error("rede caiu"); } }, "9"); } catch (e) { erroReal = e.message === "rede caiu"; }
check(erroReal, "erro que não é de cartão em uso é propagado");

// ---------- 13/14. mesa opcional ----------
check(a1.order.table_number === null && rotuloDoAtendimento(a1.order) === "Cartão 023", "14. cartão sem mesa");
const c5 = await abrirAtendimentoDoCartao(sa, "5", { mesa: "5" });
check(c5.order.card_number === "5" && c5.order.table_number === "5" && rotuloDoAtendimento(c5.order) === "Cartão 005", "13. cartão associado a uma mesa (Cartão 005 na Mesa 5)");
const c6 = await abrirAtendimentoDoCartao(sa, "6", { mesa: " 5 " });
check(c6.order.table_number === "5" && db.abertas(A).filter((o) => o.table_number === "5").length === 2, "duas comandas podem estar na mesma mesa");
check(normalizarMesa("") === null && normalizarMesa("   ") === null && normalizarMesa(null) === null && normalizarMesa(" 12 ") === "12" && normalizarMesa("x".repeat(40)).length === 20, "mesa opcional normalizada (vazia = sem mesa)");
const mesaMode = await abrirOuVerAtendimento(db.storeMesaDe(A), "5");
check(mesaMode.acao === "abrir" && !mesaMode.order.card_number, "o atendimento de MESA (módulo Mesas) continua independente dos cartões na mesma mesa");
check((await abrirOuVerAtendimento(db.storeMesaDe(A), "5")).acao === "ver", "Mesas: mesa ocupada abre o atendimento existente (regra da 080 mantida)");

// ---------- 10/11/12. finalizar venda, cartão volta DISPONÍVEL, reutilização ----------
const refri = { id: "p-refri", name: "Refrigerante", price: 6, stock: 10 };
const pessoas = [0.45, 0.62, 0.38].map((peso) => atualizarPessoa(novaPessoa({ precoKg: 80 }), { peso }));
let comanda = { ...a1.order, people: pessoas, items: adicionarProduto([], refri, 1) };
const tot = totaisDaMesa(comanda);
check(tot.pessoas === 116 && tot.total === 122, "comanda com 3 pessoas (36,00 + 49,60 + 30,40) e refrigerante: 122,00");
const cart = montarCarrinho(comanda, { produtosPorId: { [refri.id]: refri } });
check(cart.cart.length === 4 && cart.total === 122, "carrinho do PDV da comanda: 122,00");
const paga = aplicarPagamento(comanda, { pessoaIds: cart.pessoaIds, itemIds: cart.itemIds, saleId: "venda-1" });
check(paga.status === "fechada" && !!paga.closed_at && paga.sale_ids.join() === "venda-1", "venda paga: atendimento encerrado, venda registrada no histórico");
db.linhas.splice(db.linhas.findIndex((o) => o.id === a1.order.id), 1, { ...a1.order, ...paga }); // o PDV grava o encerramento
check((await localizarCartao(sa, "23", { inicial: 1, final: 100 })).estado === "disponivel", "cartão volta a DISPONÍVEL depois do encerramento");
check(db.linhas.some((o) => o.id === a1.order.id && o.status === "fechada" && o.people.length === 3), "cartão não é apagado e o histórico (pessoas, itens, venda) permanece");
const reuso = await abrirAtendimentoDoCartao(sa, "23", { mesa: "2" });
check(reuso.acao === "abrir" && reuso.order.id !== a1.order.id && reuso.order.table_number === "2", "12. cartão 023 reutilizado depois, agora na Mesa 2");
check(db.linhas.filter((o) => o.card_number === "23").length === 2 && db.abertas(A).filter((o) => o.card_number === "23").length === 1, "histórico do cartão: 1 fechado + 1 aberto");
const cancelado = { ...reuso.order, status: "cancelada" };
db.linhas.splice(db.linhas.findIndex((o) => o.id === reuso.order.id), 1, cancelado);
check((await localizarCartao(sa, "23", { inicial: 1, final: 100 })).estado === "disponivel", "cancelar o atendimento também libera o cartão");

// ---------- 20/21. não duplicar venda/estoque/receita ----------
const repetida = aplicarPagamento(paga, { pessoaIds: cart.pessoaIds, itemIds: cart.itemIds, saleId: "venda-1" });
check(repetida.sale_ids.length === 1, "20. mesmo saleId não duplica a venda no atendimento (idempotente)");
check(montarCarrinho(paga, { produtosPorId: { [refri.id]: refri } }).cart.length === 0, "atendimento já pago não gera nova cobrança (sem receita duplicada)");
const baixas = cart.cart.filter((l) => !l.product.semEstoque).map((l) => l.product.id);
check(baixas.join() === "p-refri" && cart.cart.filter((l) => l.product.semEstoque).length === 3, "21. baixa de estoque só do produto real; as 3 pessoas não baixam estoque");
check(cart.cart.reduce((s, l) => s + (l.customPrice || l.product.price) * l.quantity, 0).toFixed(2) === "122.00", "receita = total da comanda (122,00), sem duplicar");

// ---------- 22. RLS / company_id ----------
const sb = db.storeDe(B);
check((await sb.buscarAberto("5")) === null && (await localizarCartao(sb, "5", { inicial: 1, final: 100 })).estado === "disponivel", "empresa B não enxerga o cartão em uso da empresa A");
const b5 = await abrirAtendimentoDoCartao(sb, "5");
check(b5.acao === "abrir" && b5.order.company_id === B && db.abertas(A).filter((o) => o.card_number === "5").length === 1, "empresa B usa o próprio cartão 5 sem afetar a A");
check((await sa.buscarAberto("5")).company_id === A, "a empresa A continua vendo só o seu cartão 5");
const mig081 = ler("supabase/migrations/081_table_orders_cards.sql");
const mig080 = ler("supabase/migrations/080_table_orders.sql");
check(/add column if not exists card_number text/.test(mig081) && /alter column table_number drop not null/.test(mig081), "migration 081: card_number e mesa opcional");
check(/table_orders_open_card_uidx\s+on public\.table_orders \(company_id, card_number\) where status = 'aberta' and card_number is not null/.test(mig081), "migration 081: um atendimento aberto por cartão por empresa");
check(/table_orders_open_uidx[\s\S]*\(company_id, table_number\) where status = 'aberta' and card_number is null/.test(mig081), "migration 081: um aberto por mesa vale só para atendimento de mesa");
check(/check \(table_number is not null or card_number is not null\)/.test(mig081), "migration 081: todo atendimento tem mesa ou cartão");
check(!/policy|grant|disable row level/i.test(mig081.replace(/--.*$/gm, "")), "migration 081 não mexe em RLS nem grants (política por company_id da 080 vale para as novas colunas)");
check(/company_id = public\.current_company_id\(\)/.test(mig080) && /enable row level security/.test(mig080), "RLS por empresa da 080 inalterada");
check(!/token|qr/i.test(mig081.replace(/--.*$/gm, "")), "nada de token/QR no banco (calculado no app)");
const api = ler("src/lib/mesasApi.js");
check(/storeDeCartoes/.test(api) && !/company_id/.test(api.slice(api.indexOf("storeDeCartoes"), api.indexOf("definirMesaDoCartao"))), "storeDeCartoes não manda company_id (vem da sessão, preenchido e checado pelo RLS)");
check(/getUserCompanyId\(await api\.auth\.me\(\)\)/.test(api), "empresa vem da sessão (auth), nunca de QR/URL/entrada");
const todasTelas = ler("src/pages/Cartoes.jsx") + ler("src/components/mesas/CartaoDialogs.jsx") + ler("src/lib/cartaoQr.js");
check(!/location\.search|URLSearchParams|searchParams/.test(todasTelas), "nenhum parâmetro de URL decide empresa/cartão");
check(/runtime|company_id/.test(todasTelas) === false || !/company_id\s*[:=]/.test(todasTelas.replace(/\/\/.*$/gm, "").replace(/\*[^\n]*/g, "")), "telas/lib de cartão não montam company_id");

// ---------- 15. imprimir cartões ----------
const cartoes = await Promise.all([1, 2, 3, 23, 100].map(async (n) => ({ numero: String(n), svg: await qrSvg(await payloadDoCartao(A, n)) })));
check(cartoes.every((c) => c.svg.startsWith("<svg") && c.svg.includes("<path")) && new Set(cartoes.map((c) => c.svg)).size === 5, "QR gerado localmente (SVG) e diferente para cada cartão");
let folha = montarFolhaCartoes(cartoes, { empresa: "Restaurante Sabor <&> \"Bom\"" });
check((folha.match(/class="cartao"/g) || []).length === 5 && (folha.match(/<svg/g) || []).length === 5, "folha: um cartão com QR por número");
check(folha.includes(">CARTÃO<") && ["001", "002", "003", "023", "100"].every((n) => folha.includes(`<div class="numero">${n}</div>`)), "cada cartão traz 'CARTÃO' e o número (001, 002, 003, 023, 100)");
check(folha.includes("RESTAURANTE SABOR &lt;&amp;&gt; &quot;BOM&quot;") && !folha.includes("<&>"), "nome da empresa no cartão (escapado)");
check(montarFolhaCartoes(cartoes, {}).includes(">MERCADOFÁCIL<"), "sem nome da empresa, o cartão traz MERCADOFÁCIL");
check(!folha.includes(A) && !folha.includes(A.replace(/-/g, "")), "folha impressa não expõe company_id");
check(/@page \{ size: A4 portrait/.test(folha) && folha.includes("page-break-after") && folha.includes("1px dashed"), "A4 com borda tracejada para recortar/plastificar");
check(!/https?:\/\//.test(folha.replace(/xmlns="http:\/\/www\.w3\.org\/2000\/svg"/g, "")), "folha sem links externos (nada de serviço de QR)");
for (const [chave, porFolha] of [["grande", 8], ["medio", 15], ["pequeno", 24]]) {
  const muitos = Array.from({ length: porFolha + 1 }, (_, i) => ({ numero: String(i + 1), svg: "<svg></svg>" }));
  const h = montarFolhaCartoes(muitos, { layout: chave });
  check(LAYOUTS_CARTAO[chave].colunas * LAYOUTS_CARTAO[chave].linhas === porFolha && (h.match(/class="pagina"/g) || []).length === 2 && h.includes(`repeat(${LAYOUTS_CARTAO[chave].colunas}, 1fr)`), `layout ${chave}: ${porFolha} cartões por folha (${porFolha + 1} cartões = 2 folhas)`);
}
check((montarFolhaCartoes(cartoes, { layout: "inexistente" }).match(/repeat\(3, 1fr\)/g) || []).length >= 1, "layout desconhecido cai no médio");
check(montarFolhaCartoes([], {}).includes("<body></body>"), "sem cartões, folha vazia (não quebra)");
check(!/mesa/i.test(folha.replace(/<style>[\s\S]*<\/style>/, "")), "o cartão impresso não identifica mesa");

// ---------- câmera (avaliação técnica) ----------
const mediaOk = { navigator: { mediaDevices: { getUserMedia: () => {} } } };
function Detector() {}
Detector.getSupportedFormats = async () => ["qr_code", "ean_13"];
function SemQr() {}
SemQr.getSupportedFormats = async () => ["ean_13"];
check((await cameraQrDisponivel({})) === false && (await cameraQrDisponivel({ ...mediaOk })) === false, "sem BarcodeDetector (ex.: Windows): câmera indisponível, usa leitor USB/número");
check((await cameraQrDisponivel({ ...mediaOk, BarcodeDetector: Detector })) === true && (await cameraQrDisponivel({ ...mediaOk, BarcodeDetector: SemQr })) === false, "câmera só quando o navegador lê qr_code");

// ---------- 18/19. restaurante sem NF vende; emissão fiscal continua exigindo configuração ----------
const semFiscal = montarCarrinho(comanda, { produtosPorId: { [refri.id]: refri } });
const itensSemFiscal = semFiscal.cart.map((l) => ({ product_id: l.product.semEstoque ? l.product.produtoFiscalId || null : l.product.id, origem: l.product.origem }));
check(semFiscal.cart.length === 4 && itensSemFiscal.filter((i) => i.origem === ORIGEM_ALMOCO).every((i) => i.product_id === null), "18. sem nenhuma configuração fiscal: abre cartão, lança pessoas/produtos e monta a venda normalmente");
check(aplicarPagamento(comanda, { pessoaIds: semFiscal.pessoaIds, itemIds: semFiscal.itemIds, saleId: "s2" }).status === "fechada", "recebe e encerra o atendimento sem produto fiscal");
const pdv = ler("src/pages/PDV.jsx");
check(!/bloqueioFiscalDoAlmoco|faltandoNoProdutoFiscal/.test(pdv), "PDV não valida fiscal para vender");
const cob = ler("src/components/mesas/useCobrarAtendimento.js");
check(/usaFiscal && m\.cart\.some/.test(cob) && /nfceHabilitada\(\)/.test(cob), "aviso fiscal ao cobrar só para quem emite NFC-e");
check(/usaFiscal && \(!config\.produtoFiscalId/.test(ler("src/pages/Mesas.jsx")), "alerta fiscal da tela Mesas só para quem emite NFC-e");
check(!/disabled=\{[^}]*produtoFiscal/.test(ler("src/components/mesas/MesaDialog.jsx")) && !/produtoFiscal/.test(ler("src/pages/Cartoes.jsx").replace(/useCobrarAtendimento/g, "")), "nenhum botão de cartão/mesa depende de produto fiscal");
const bloqueio = bloqueioFiscalDoAlmoco(itensSemFiscal, {});
check(!!bloqueio && /NFC-e não pode ser emitida/.test(bloqueio.message), "19. ao TENTAR emitir NFC-e sem produto fiscal, a emissão é bloqueada com orientação");
const fc = ler("src/lib/fiscalConfig.js");
check(/throw new Error\(bloqueio\.message\)/.test(fc) && fc.indexOf("bloqueioFiscalDoAlmoco(venda.items") < fc.indexOf('api.functions.invoke("fiscalEmit"'), "emissão fiscal continua exigindo produto fiscal válido (proteção mantida)");

// ---------- integração: Cartões / Mesas / PDV ----------
const cart2 = ler("src/pages/Cartoes.jsx");
check(/useBarcodeScanner\(async \(codigo\) => \{\s*if \(!config\.ativo \|\| !pareceQrDeCartao\(codigo\)\)/.test(cart2), "Cartões reaproveita o leitor USB existente (useBarcodeScanner)");
check(/localizarCartao\(store, numero/.test(cart2) && /abrirAtendimentoDoCartao\(storeDeCartoes/.test(cart2) && /MSG_NAO_ENCONTRADO/.test(cart2), "QR e número chegam ao mesmo fluxo: localizar → DISPONÍVEL (oferece abrir) / EM USO (abre existente) / não encontrado");
check(/interpretarEntradaCartao\(codigo, companyId/.test(cart2) && /interpretarEntradaCartao\(busca, companyId\)/.test(cart2), "leitura por QR e busca por número usam a mesma interpretação");
const dlg = ler("src/components/mesas/CartaoDialogs.jsx");
check(/AbrirCartaoDialog/.test(dlg) && /Deseja abrir um novo atendimento/.test(dlg) && /Mesa \(opcional\)/.test(dlg), "cartão DISPONÍVEL oferece abrir novo atendimento (mesa opcional)");
check(/QrCartaoDialog/.test(dlg) && /ImprimirCartoesDialog/.test(dlg) && /LerCartaoDialog/.test(dlg) && /Imprimir cartões\/comandas/.test(dlg + cart2), "telas: ver QR, imprimir cartões/comandas, ler cartão");
check(/Informar número/.test(cart2) && /Localizar cartão pelo número/.test(cart2) && /Cartão inicial/.test(cart2) && /Cartão final/.test(cart2) && /EM USO/.test(cart2) && /DISPONÍVEL/.test(cart2), "área de gerenciamento: faixa inicial/final, status, localizar por número");
check(/case "cartao":/.test(pdv) && /case "cartao_numero":/.test(pdv) && /LerCartaoDialog/.test(pdv) && /navigate\("\/cartoes"/.test(pdv), "PDV: ações 'Ler cartão' e 'Informar nº do cartão' levam ao mesmo fluxo");
check(/if \(mesasAtivas && pareceQrDeCartao\(code\)\)/.test(pdv) && /Finalize ou limpe a venda atual antes de abrir um cartão/.test(pdv), "PDV: QR do cartão no leitor USB; venda em andamento não se perde");
check(/products\.find\(\(p\) => p\.barcode === code \|\| p\.code === code\)/.test(pdv), "leitura de código de barras de produto do PDV preservada");
const painel = ler("src/components/pos/PosLeftPanel.jsx");
check(/\{mesasAtivas && \(/.test(painel) && /acoesCartao\.map/.test(painel) && /Ler cartão/.test(painel) && /Informar nº do cartão/.test(painel) && !/\.\.\.acoesCartao/.test(painel), "ações de cartão só aparecem com Mesas/Cartões ativado, em bloco próprio (venda rápida intacta)");
check(/Cartão \/ comanda/.test(painel) && /Cliente trouxe o cartão\?/.test(painel) && /Leia o QR/.test(painel) && /digite o número/.test(painel), "UX do PDV: bloco destacado 'Cartão / comanda' — cliente trouxe o cartão → leia o QR ou digite o número");
check(/onQuickAction\(action\.id\)/.test(painel) && /id: "cartao"/.test(painel) && /id: "cartao_numero"/.test(painel), "UX do PDV: as duas ações continuam com os mesmos ids (mesmo fluxo validado)");
check(/Como funciona o cartão/.test(cart2) && /Imprima os cartões/.test(cart2) && /Entregue ao cliente/.test(cart2) && /No caixa/.test(cart2) && /O cliente não precisa de celular/.test(cart2), "UX de Cartões: faixa explicando cartão → cliente entrega → caixa lê o QR ou digita o número");
check(/Ver QR/.test(cart2) && /Imprimir cartões\/comandas/.test(cart2) && /QR do cartão não é um link/.test(cart2) && /QR de mesa é outro recurso/.test(cart2), "UX de Cartões: 'Ver QR' e 'Imprimir cartões/comandas' claros; QR do cartão não é link e não se confunde com QR de mesa");
check(/QR do \{numero \? rotuloDoCartao/.test(dlg) && /Este QR fica no <strong>cartão físico<\/strong>/.test(dlg) && /não é um link/.test(dlg) && /Imprimir este cartão/.test(dlg) && />CARTÃO</.test(dlg), "UX do QR: mostra o CARTÃO (empresa / CARTÃO / 023 / QR) e explica que fica no cartão físico, sem link público");
check(!/\/m\/|app\.[a-z]+\.com|Copiar link|Invalidar cartão|Acessar Mesa|QR — Mesa/.test(cart2 + dlg), "telas de cartão sem link público e sem 'QR — Mesa' (o QR da mesa é outro recurso, em Mesas)");
const mesasPg = ler("src/pages/Mesas.jsx");
check(!/QrMesaDialog|LerMesaDialog|mesaQr|MFMESA/.test(cart2 + dlg), "código dos cartões não mistura o QR da mesa (recursos separados)");
check(/filter\(\(o\) => !o\.card_number\)/.test(mesasPg) && /abrirOuVerAtendimento/.test(mesasPg), "módulo Mesas continua funcionando (atendimentos de mesa, sem cartão)");
check(/filter\(\(o\) => o\.card_number\)/.test(cart2), "Cartões lista só atendimentos com cartão");
const md = ler("src/components/mesas/MesaDialog.jsx");
check(/MesaDoCartao/.test(md) && /definirMesaDoCartao/.test(md) && /normalizarMesa/.test(md), "atendimento do cartão permite informar/trocar a mesa (opcional)");
check(/\{ path: "\/cartoes", label: "Cartões"[^}]*opcional: "cartoes"/.test(ler("src/components/Layout.jsx")) && /CARTOES_VISIVEIS/.test(ler("src/components/Layout.jsx")) && /export const CARTOES_VISIVEIS = false/.test(api) && /path="\/cartoes"/.test(ler("src/App.jsx")), "Cartões escondido do menu e do PDV por flag (código e rota mantidos para reativar)");
check(/rotulo/.test(pdv) && !/tableNumber/.test(pdv + cob), "PDV mostra 'Cartão 023' ou 'Mesa N' (rótulo do atendimento)");
// o que não pode mudar
check(!/mesa|cart[aã]o\b|MFCARTAO/i.test(ler("src/components/pos/CheckoutDialog.jsx").replace(/cart[aã]o de cr[eé]dito|cartão|Cart[aã]o|cartao/gi, "")), "CheckoutDialog intacto (dinheiro/troco/PIX/cartão)");
check(!/cartaoQr|MFCARTAO|cartoes/i.test(ler("src/lib/plans.js") + ler("supabase/functions/_shared/plans.ts")), "planos e adicionais intactos");
check(!/balan/i.test(todasTelas), "Balança de Etiqueta intacta");
check(/table_orders_open_uidx[\s\S]*create table|create table if not exists public\.table_orders/.test(mig080) && !/card_number/.test(mig080), "migration 080 inalterada (a separação cartão/mesa está na 081)");

console.log(JSON.stringify({ passaram, falhas: falhas.length }));
if (falhas.length) {
  falhas.forEach((f) => console.log("FALHA:", f));
  process.exit(1);
}
console.log(`${passaram} passaram, 0 falharam`);
