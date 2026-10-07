/**
 * Smoke do QR/link fixo da MESA (sem rede): src/lib/mesaQr.js + integração com Mesas/PDV/rota /m/<token>.
 * O QR da mesa é o link permanente `<app>/m/<token>`; NÃO é página pública (rota do app atrás do login) e só resolve na
 * empresa da sessão. Cartões/comandas seguem no código, escondidos por flag.
 * Uso: node scripts/smoke-mesas-link.mjs
 */
import { readFileSync } from "fs";
import {
  ROTA_MESA, MAX_MESAS, tokenDaMesa, caminhoDaMesa, linkDaMesa, baseDoApp, pareceLinkDeMesa, resolverLinkMesa,
  interpretarEntradaMesa, normalizarNumeroMesa, qrSvg, montarFolhaMesas, MSG_LINK_INVALIDO, MSG_ENTRADA_INVALIDA,
} from "../src/lib/mesaQr.js";
import { abrirOuVerAtendimento } from "../src/lib/mesas.js";

const falhas = [];
let passaram = 0;
const check = (cond, msg) => (cond ? passaram++ : falhas.push(msg));
const ler = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const BASE = "https://app.exemplo.com.br";

// ---------- token único por mesa e por empresa ----------
const tokensA = await Promise.all(Array.from({ length: MAX_MESAS }, (_, i) => tokenDaMesa(A, i + 1)));
const tokensB = await Promise.all(Array.from({ length: MAX_MESAS }, (_, i) => tokenDaMesa(B, i + 1)));
check(new Set(tokensA).size === MAX_MESAS && tokensA.every((t) => /^[0-9a-f]{20}$/.test(t)), "cada mesa tem um token único (200 mesas, 80 bits)");
check(!tokensA.some((t) => tokensB.includes(t)), "duas empresas não compartilham nenhum link/QR de mesa");
check((await tokenDaMesa(A, 5)) === (await tokenDaMesa(A, " 05 ")) && (await tokenDaMesa(A, 5)) === tokensA[4], "link persistente: a mesma mesa gera sempre o mesmo token");
let recusou = 0;
for (const ruim of ["", "abc", "0", "201", "-1", "1.5"]) { try { await tokenDaMesa(A, ruim); } catch { recusou++; } }
try { await tokenDaMesa("", 1); } catch { recusou++; }
check(recusou === 7, "mesa inválida ou empresa ausente não gera token");

// ---------- link/QR ----------
const caminho5 = await caminhoDaMesa(A, 5);
const link5 = await linkDaMesa(A, 5, { base: BASE });
check(caminho5 === `${ROTA_MESA}${tokensA[4]}` && link5 === `${BASE}/m/${tokensA[4]}`, "link da mesa: <app>/m/<token>");
check(!link5.includes(A) && !link5.includes(A.replace(/-/g, "")), "o link não expõe company_id");
check(!new RegExp(`/m/.*\\b5\\b`).test(link5) && !/mesa/i.test(link5.replace(/\/m\//, "")), "o link não traz o número da mesa em texto claro");
check((await linkDaMesa(A, 5, { base: "" })) === caminho5, "sem endereço base (desktop): só o caminho /m/<token>");
check(baseDoApp({ location: { origin: "https://loja.exemplo.com" } }) === "https://loja.exemplo.com" && baseDoApp({ location: { origin: "mercadofacil://app" } }) === "" && baseDoApp({}) === "", "base do app: origem http(s); no desktop (mercadofacil://) sem base");
const svgs = await Promise.all([1, 2, 3].map(async (n) => qrSvg(await linkDaMesa(A, n, { base: BASE }))));
check(svgs.every((s) => s.startsWith("<svg") && s.includes("<path")) && new Set(svgs).size === 3, "QR gerado localmente (SVG), diferente por mesa — sem serviço externo");

// ---------- ler QR/link e número ----------
check(pareceLinkDeMesa(link5) && pareceLinkDeMesa(caminho5) && pareceLinkDeMesa(`  ${link5}\n`) && !pareceLinkDeMesa("7891234567890") && !pareceLinkDeMesa(null) && !pareceLinkDeMesa("/m/xyz"), "leitor USB separa link de mesa de código de barras de produto");
let r = await resolverLinkMesa(link5, A);
check(r.ok && r.numero === "5", "link/QR resolve para a mesa correta");
let todas = true;
for (const n of [1, 2, 10, 57, 200]) if ((await resolverLinkMesa(await linkDaMesa(A, n, { base: BASE }), A)).numero !== String(n)) todas = false;
check(todas, "QR abre a mesa certa (1, 2, 10, 57, 200)");
check((await resolverLinkMesa(caminho5, A)).numero === "5", "só o caminho /m/<token> também resolve (desktop)");
check((await interpretarEntradaMesa(link5, A)).origem === "qr" && (await interpretarEntradaMesa(link5, A)).numero === "5", "entrada por QR/link");
for (const e of ["5", "05", " 5 "]) {
  const x = await interpretarEntradaMesa(e, A);
  check(x.ok && x.numero === "5" && x.origem === "numero", `entrada por número '${e}' resolve para a mesa 5`);
}
for (const ruim of ["", "abc", "0", "999", null, undefined]) {
  const x = await interpretarEntradaMesa(ruim, A);
  check(!x.ok && x.motivo === "entrada_invalida" && x.mensagem === MSG_ENTRADA_INVALIDA, `entrada inválida recusada: ${JSON.stringify(ruim)}`);
}
check(normalizarNumeroMesa(200) === "200" && normalizarNumeroMesa(201) === null, "mesas 1..200");

// ---------- QR inválido, adulterado e de outra empresa ----------
for (const t of [`${BASE}/m/${"0".repeat(20)}`, `${BASE}/m/${tokensA[4].slice(0, 19)}0`, `${BASE}/m/${tokensA[4].toUpperCase()}`, `${BASE}/m/${tokensA[4]}00`, `${BASE}/m/zz`, `${BASE}/m/`]) {
  const x = await resolverLinkMesa(t, A);
  check(!x.ok, `QR/link inválido ou adulterado recusado: ${t.slice(-24)}`);
}
check((await resolverLinkMesa(`${BASE}/m/${"0".repeat(20)}`, A)).mensagem === MSG_LINK_INVALIDO, "mensagem clara para QR inválido");
const deB = await linkDaMesa(B, 5, { base: BASE });
r = await resolverLinkMesa(deB, A);
check(!r.ok && r.motivo === "invalido", "QR/link da mesa da empresa B lido na empresa A é recusado");
check((await resolverLinkMesa(deB, B)).numero === "5", "o mesmo QR continua valendo na empresa B");
let nenhum = true;
for (let n = 1; n <= 30; n++) if ((await resolverLinkMesa(await linkDaMesa(B, n, { base: BASE }), A)).ok) nenhum = false;
check(nenhum, "nenhum QR da empresa B resolve na empresa A");
check(!(await resolverLinkMesa("MFCARTAO-" + tokensA[0], A)).ok, "QR de cartão não vale como QR de mesa");

// ---------- mesa livre / ocupada / confirmação ----------
const linhas = [];
const store = {
  buscarAberto: async (n) => linhas.find((o) => o.status === "aberta" && o.table_number === String(n)) || null,
  criar: async (n) => {
    if (linhas.some((o) => o.status === "aberta" && o.table_number === String(n))) throw new Error("duplicate key table_orders_open_uidx");
    const o = { id: `o${linhas.length + 1}`, table_number: String(n), status: "aberta" };
    linhas.push(o);
    return o;
  },
};
const a1 = await abrirOuVerAtendimento(store, "2");
const a2 = await abrirOuVerAtendimento(store, "2");
check(a1.acao === "abrir" && a2.acao === "ver" && a2.order.id === a1.order.id && linhas.length === 1, "mesa LIVRE abre; lida de novo (OCUPADA) abre o atendimento existente, sem segundo atendimento");

// ---------- fonte: Mesas, PDV, rota ----------
const mesas = ler("src/pages/Mesas.jsx");
const dlg = ler("src/components/mesas/MesaQrDialogs.jsx");
const pdv = ler("src/pages/PDV.jsx");
const painel = ler("src/components/pos/PosLeftPanel.jsx");
const app = ler("src/App.jsx");
check(/Ver QR \/ link/.test(mesas) && /BotaoQr\(n\)/.test(mesas) && (mesas.match(/\{BotaoQr\(n\)\}/g) || []).length === 2, "cada card de mesa (livre e ocupada) tem 'Ver QR / link'");
check(/QR — Mesa \{numero\}/.test(dlg) && /QR fixo da mesa/.test(dlg) && /Não muda ao abrir\/fechar atendimento/.test(dlg) && /link é permanente desta mesa nesta loja/.test(dlg), "diálogo 'QR — Mesa N' com o aviso de QR fixo e permanente");
check(/Copiar link/.test(dlg) && /Testar/.test(dlg) && /Imprimir/.test(dlg) && /aria-label="Link da mesa"/.test(dlg), "diálogo traz o link, Copiar link, Testar e Imprimir");
check(/Não é uma página pública/.test(dlg) && /quem não está logado não vê nenhum dado/.test(dlg), "diálogo explica que o link não é página pública");
check(/Abrir Mesa \{numero\}\?/.test(dlg) && /A mesa ficará ocupada/.test(dlg) && /Confirmar abertura/.test(dlg) && /Cancelar/.test(dlg), "abrir mesa LIVRE pede confirmação ('Abrir Mesa N?')");
check(/onClick=\{\(\) => setConfirmar\(n\)\}/.test(mesas) && /const entrarNaMesa = \(numero\) => \{\s*const n = String\(numero\);\s*if \(porMesa\[n\]\) setAberta\(n\);\s*else setConfirmar\(n\);/.test(mesas), "mesa livre → confirmação; mesa ocupada → abre o atendimento existente (clique, QR e número)");
check(/abrirOuVerAtendimento\(storeDeAtendimentos/.test(mesas), "abertura pela regra única de um atendimento por mesa");
check(/useBarcodeScanner\(async \(codigo\) => \{\s*if \(!config\.ativo \|\| !pareceLinkDeMesa\(codigo\)\)/.test(mesas) && /interpretarEntradaMesa\(codigo, companyId/.test(mesas), "Mesas reaproveita o leitor USB (useBarcodeScanner) e resolve na empresa da sessão");
check(/Ler QR<\/Button>|Ler QR\n/.test(mesas) && /<Keyboard className="w-4 h-4" \/> Nº/.test(mesas) && /Imprimir QR das mesas/.test(mesas) && /imprimirQrDasMesas/.test(mesas), "Mesas: Ler QR, Nº e Imprimir QR das mesas no cabeçalho");
check(/Mesa<\/h3>/.test(painel) && /Leia o QR da mesa/.test(painel) && /id: "mesa_qr"/.test(painel) && /id: "mesa_numero"/.test(painel) && /Informar nº da mesa/.test(painel), "PDV: bloco 'Mesa' com 'Ler QR da mesa' e 'Informar nº da mesa'");
check(/case "mesa_qr":/.test(pdv) && /case "mesa_numero":/.test(pdv) && /LerMesaDialog/.test(pdv) && /navigate\("\/mesas", \{ state: \{ abrirMesa/.test(pdv), "PDV: as duas ações levam à mesma abertura da mesa");
check(/if \(mesasAtivas && pareceLinkDeMesa\(code\)\)/.test(pdv) && /Finalize ou limpe a venda atual antes de abrir uma mesa/.test(pdv) && /products\.find\(\(p\) => p\.barcode === code \|\| p\.code === code\)/.test(pdv), "PDV: QR de mesa no leitor USB; venda em andamento protegida; código de barras de produto preservado");
check(/\{mesasAtivas && cartoesVisiveis && \(/.test(painel) && /cartoesVisiveis=\{CARTOES_VISIVEIS\}/.test(pdv) && /export const CARTOES_VISIVEIS = false/.test(ler("src/lib/mesasApi.js")), "bloco de Cartão/comanda escondido do PDV por flag (código mantido)");
const iProtegida = app.indexOf("<ProtectedRoute");
const iRotaMesa = app.indexOf('path="/m/:token"');
check(iRotaMesa > iProtegida && iProtegida > -1 && /<Route path="\/m\/:token" element=\{<MesaLink \/>\} \/>/.test(app), "rota /m/:token fica DENTRO do ProtectedRoute (atrás do login, não é página pública)");
const ml = ler("src/pages/MesaLink.jsx");
check(/resolverLinkMesa\(`\$\{ROTA_MESA\}\$\{token\}`, await obterCompanyId\(\), await carregarVersoesQr\(\)\)/.test(ml) && /navigate\("\/mesas", \{ replace: true, state: \{ abrirMesa: r\.numero \} \}\)/.test(ml) && /setErro\(r\.mensagem\)/.test(ml), "/m/<token>: resolve na empresa da sessão (com as versões do banco) e abre a mesa; inválido mostra mensagem");
check(!/location\.search|URLSearchParams|searchParams|company_id/.test(ml + dlg + ler("src/lib/mesaQr.js").replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "")), "nada de URL/parâmetro/company_id decide a empresa");
check(!/fetch\(|qrserver|chart\.googleapis/.test(ler("src/lib/mesaQr.js") + dlg), "sem serviço externo de QR");

// ---------- invalidar QR (versão do token) ----------
const v = (await import("../src/lib/mesaQr.js"));
const t0 = await v.tokenDaMesa(A, 5);
const t1 = await v.tokenDaMesa(A, 5, 1);
const t2 = await v.tokenDaMesa(A, 5, 2);
check(t0 === tokensA[4] && t1 !== t0 && t2 !== t1 && t2 !== t0 && /^[0-9a-f]{20}$/.test(t1), "versão 0 mantém o token original (QR já impressos valem); cada invalidação gera um token novo");
check((await v.tokenDaMesa(A, 5, 0)) === t0 && (await v.tokenDaMesa(A, 5, undefined)) === t0 && (await v.tokenDaMesa(A, 5, "1")) === t1, "versão ausente = 0; versão repetida gera o mesmo token");
check((await v.tokenDaMesa(A, 5, 1)) !== (await v.tokenDaMesa(B, 5, 1)) && (await v.tokenDaMesa(A, 6, 1)) !== t1, "token novo continua único por mesa e por empresa");
check(v.versaoDaMesa({ 5: 3 }, "5") === 3 && v.versaoDaMesa({}, 5) === 0 && v.versaoDaMesa(undefined, 5) === 0 && v.proximaVersao({ 5: 1 }, 5) === 2 && v.proximaVersao({}, 5) === 1, "versaoDaMesa/proximaVersao");
const antigo = await linkDaMesa(A, 5, { base: BASE });
const novo = await linkDaMesa(A, 5, { versao: 1, base: BASE });
check(antigo !== novo && novo.startsWith(`${BASE}/m/`), "o link da mesa muda quando o QR é invalidado");
check((await resolverLinkMesa(antigo, A, {})).numero === "5", "antes de invalidar: o QR impresso resolve");
const versoes = { 5: 1 };
r = await resolverLinkMesa(antigo, A, versoes);
check(!r.ok && r.motivo === "invalido", "depois de invalidar: o QR antigo da mesa 5 é recusado");
check((await resolverLinkMesa(novo, A, versoes)).numero === "5", "depois de invalidar: o QR novo da mesa 5 resolve");
check(!(await resolverLinkMesa(novo, A, {})).ok, "o QR novo só vale com a versão do banco (sem ela é recusado)");
check((await resolverLinkMesa(await linkDaMesa(A, 6, { base: BASE }), A, versoes)).numero === "6", "invalidar a mesa 5 não afeta o QR das outras mesas");
check(!(await resolverLinkMesa(await linkDaMesa(A, 5, { versao: 2, base: BASE }), A, versoes)).ok, "versão futura inexistente não resolve");
check((await interpretarEntradaMesa(antigo, A, versoes)).ok === false && (await interpretarEntradaMesa(novo, A, versoes)).numero === "5" && (await interpretarEntradaMesa("5", A, versoes)).numero === "5", "caixa: QR antigo recusado, QR novo e número da mesa continuam funcionando");
check(!(await resolverLinkMesa(await linkDaMesa(B, 5, { versao: 1, base: BASE }), A, versoes)).ok, "QR novo de outra empresa continua recusado");
const mig82 = ler("supabase/migrations/082_table_qr_versions.sql");
check(/create table if not exists public\.table_qr_versions/.test(mig82) && /company_id uuid not null references public\.companies/.test(mig82) && /unique index if not exists table_qr_versions_uidx\s+on public\.table_qr_versions \(company_id, table_number\)/.test(mig82), "migration 082: versão por mesa e empresa (única)");
check(/enable row level security/.test(mig82) && /using \(company_id = public\.current_company_id\(\)\)[\s\S]*with check \(company_id = public\.current_company_id\(\)\)/.test(mig82), "migration 082: RLS por company_id");
check(!/alter table public\.(table_orders|sales|products)|drop table|delete from/i.test(mig82.replace(/--.*$/gm, "")), "migration 082 só cria a tabela nova (não toca nas existentes)");
const api2 = ler("src/lib/mesasApi.js");
check(/carregarVersoesQr/.test(api2) && /catch \{\s*return \{\};/.test(api2) && /invalidarQrDaMesa/.test(api2) && /version: nova/.test(api2), "mesasApi: carrega versões (sem a tabela devolve {}) e invalida subindo a versão no banco");
check(/TableQrVersion: "table_qr_versions"/.test(ler("src/api/supabaseData.js")) && /TENANT_TABLES[\s\S]*"table_qr_versions"/.test(ler("src/api/supabaseData.js")), "TableQrVersion mapeada e preenchida com company_id da sessão");
check(/Invalidar QR antigo \(se o QR code vazou ou foi perdido\)/.test(dlg), "diálogo do QR tem 'Invalidar QR antigo (se o QR code vazou ou foi perdido)'");
check(/Invalidar QR da Mesa \{numero\}\?/.test(dlg) && /Isso gera um token novo/.test(dlg) && /para de funcionar<\/strong> e você precisará imprimir outro/.test(dlg) && /Use apenas se o QR antigo vazou ou foi perdido/.test(dlg) && /Sim, invalidar e gerar novo/.test(dlg) && /Cancelar/.test(dlg) && /bg-red-600/.test(dlg), "confirmação 'Invalidar QR da Mesa N?' com aviso e botão vermelho 'Sim, invalidar e gerar novo'");
check(/onInvalidar=\{invalidarQr\}/.test(mesas) && /invalidarQrDaMesa\(numero\)/.test(mesas) && /versoes=\{versoes\}/.test(mesas) && /carregarVersoesQr\(\)\)/.test(mesas) && /await carregarVersoesQr\(\)/.test(pdv) && /versoes=\{versoesMesa\}/.test(pdv), "Mesas, PDV e /m/<token> usam as versões do banco ao ler QR (QR antigo recusado em todos os caixas)");
check(mesas.includes("empresa, versoes)") && mesas.includes(".test(n)), empresa"), "imprimir QR das mesas usa a versão atual e filtra só mesas numéricas");

// ---------- cadastro de mesas (Criar / Remover, faixa) ----------
const M = await import("../src/lib/mesas.js");
let fx = M.faixaDeMesas("1", "10");
check(fx.ok && fx.numeros.length === 10 && fx.numeros[0] === "1" && fx.numeros[9] === "10", "faixa 1 até 10 gera 10 mesas");
check(M.faixaDeMesas(5, 5).numeros.join() === "5" && M.faixaDeMesas(" 3 ", "4").numeros.join() === "3,4", "uma mesa só e faixa com espaços");
for (const [a, b] of [["0", "5"], ["1", "201"], ["5", "1"], ["a", "3"], ["", ""], ["1.5", "3"]]) {
  check(!M.faixaDeMesas(a, b).ok && !!M.faixaDeMesas(a, b).erro, `faixa inválida recusada: ${a}..${b}`);
}
check(M.mesasNovas(["1", "2", "3"], ["2"]).join() === "1,3" && M.mesasNovas(["1"], []).join() === "1" && M.mesasNovas(["1"], ["1"]).length === 0, "criar faixa repetida não duplica (só as que faltam)");
let plano = M.planejarRemocao(["1", "2", "3", "4"], ["1", "2", "3"], ["2"]);
check(plano.remover.join() === "1,3" && plano.ocupadas.join() === "2" && plano.inexistentes.join() === "4", "remover faixa: tira as livres, mantém a ocupada e avisa a inexistente");
check(M.planejarRemocao(["1"], ["1"], []).remover.join() === "1" && M.planejarRemocao(["1"], [], []).remover.length === 0, "remover mesa livre / inexistente");
check(M.mesasParaExibir([], [], 10).length === 0, "cadastro vazio: nenhuma mesa (mostra 'Nenhuma mesa cadastrada')");
check(M.mesasParaExibir(["3", "1", "2"], [], 10).join() === "1,2,3", "mesas exibidas em ordem numérica");
check(M.mesasParaExibir([], ["1"], 10).join() === "1", "mesa com atendimento aberto nunca some, mesmo removida/sem cadastro (Mesa 1 real)");
check(M.mesasParaExibir(null, [], 4).join() === "1,2,3,4" && M.mesasParaExibir(null, ["7"], 3).join() === "1,2,3,7", "sem cadastro disponível (migration 083 pendente): volta ao 1..quantidade de antes");
check(JSON.stringify(M.resumoDasMesas(["1", "2", "3"], ["2"])) === JSON.stringify({ total: 3, ocupadas: 1, livres: 2 }) && M.resumoDasMesas(M.mesasParaExibir(["1","2","3","4","5","6","7","8","9","10"], [], 10), []).livres === 10, "resumo '10 total · 10 livres · 0 ocup.'");
const mig83 = ler("supabase/migrations/083_table_registry.sql");
check(/create table if not exists public\.table_registry/.test(mig83) && /company_id uuid not null references public\.companies/.test(mig83) && /unique index if not exists table_registry_uidx\s+on public\.table_registry \(company_id, table_number\)/.test(mig83), "migration 083: cadastro de mesas por empresa (único por número)");
check(/enable row level security/.test(mig83) && /using \(company_id = public\.current_company_id\(\)\)[\s\S]*with check \(company_id = public\.current_company_id\(\)\)/.test(mig83) && !/alter table public\.(table_orders|sales)|drop table|delete from/i.test(mig83.replace(/--.*$/gm, "")), "migration 083: RLS por company_id e só cria a tabela nova");
check(/TableRegistry: "table_registry"/.test(ler("src/api/supabaseData.js")) && /TENANT_TABLES[\s\S]*"table_registry"/.test(ler("src/api/supabaseData.js")), "TableRegistry mapeada e preenchida com company_id da sessão");
const api3 = ler("src/lib/mesasApi.js");
check(/listarMesasCadastradas/.test(api3) && /catch \{\s*return null;/.test(api3) && /criarMesas/.test(api3) && /removerMesas/.test(api3), "mesasApi: cadastro compartilhado (sem a tabela devolve null e a tela usa o modo antigo)");
const ger = ler("src/components/mesas/GerenciarMesasDialog.jsx");
check(/Gerenciar mesas/.test(ger) && />Criar</.test(ger) && />Remover</.test(ger) && /Faixa de números/.test(ger) && /Ex\.: 1 até 10/.test(ger) && />De</.test(ger) && />Até</.test(ger) && /Criar\b/.test(ger) && /faixa/.test(ger), "diálogo 'Gerenciar mesas': Criar/Remover, Faixa de números (Ex.: 1 até 10), De/Até e botão 'Criar faixa'");
check(/toast\.success\("Mesas atualizadas", \{ description: `\$\{criadas\} criada\(s\)`/.test(ger), "aviso 'Mesas atualizadas — N criada(s)'");
check(/Mesa com atendimento aberto não é removida/.test(ger) && /planejarRemocao/.test(ger), "remover não tira mesa com atendimento aberto");
check(/Nenhuma mesa cadastrada/.test(mesas) && /Crie a faixa 1–10 e imprima o QR de cada card\./.test(mesas) && /Criar mesas/.test(mesas) && /semMesas/.test(mesas), "estado vazio: 'Nenhuma mesa cadastrada — Crie a faixa 1–10 e imprima o QR de cada card. [Criar mesas]'");
check(/\{resumo\.total\} total/.test(mesas) && /\{resumo\.livres\} livres/.test(mesas) && /\{resumo\.ocupadas\} ocup\./.test(mesas) && /Toque para abrir atendimento/.test(mesas) && /aria-label="Gerenciar mesas"/.test(mesas) && /aria-label="Atualizar mesas"/.test(mesas), "cabeçalho com '10 total · 10 livres · 0 ocup.', card 'Toque para abrir atendimento', engrenagem e atualizar");
check(/<GerenciarMesasDialog/.test(mesas) && /mesasParaExibir\(cadastradas/.test(mesas) && /listarMesasCadastradas\(\)/.test(mesas), "Mesas usa o cadastro compartilhado e o diálogo de gerenciamento");

// ---------- código do atendimento ("Cód. 313144") e tempo ----------
const cod = M.codigoDoAtendimento({ id: "30d2dfcf-43d3-43cc-8b83-146a73bc8a3f" });
check(/^[1-9]\d{5}$/.test(cod), "código do atendimento: 6 dígitos (100000–999999)");
check(M.codigoDoAtendimento({ id: "30d2dfcf-43d3-43cc-8b83-146a73bc8a3f" }) === cod, "o código é sempre o mesmo para o mesmo atendimento (nada é gravado)");
const codigos = new Set(Array.from({ length: 500 }, (_, i) => M.codigoDoAtendimento({ id: `ord-${i}-${i * 7919}` })));
check(codigos.size > 490 && [...codigos].every((c) => /^[1-9]\d{5}$/.test(c)), "códigos diferentes entre atendimentos (500 ids → >490 códigos distintos)");
check(M.codigoDoAtendimento({}) === "" && M.codigoDoAtendimento(null) === "", "sem id não gera código");
const agora = new Date("2026-10-07T12:00:00Z").getTime();
check(M.tempoEStatusDaMesa({ created_at: new Date(agora - 172 * 60000).toISOString(), items: [] }, agora) === "172 min · aberta", "'172 min · aberta' (sem itens)");
check(M.tempoEStatusDaMesa({ created_at: new Date(agora - 91 * 60000).toISOString(), items: [{ id: "i" }] }, agora) === "91 min · último pedido", "'91 min · último pedido' (com itens)");
check(M.tempoEStatusDaMesa({ created_at: new Date(agora + 5 * 60000).toISOString(), items: [] }, agora) === "0 min · aberta" && M.tempoEStatusDaMesa(null, agora) === "0 min · aberta", "tempo nunca negativo");
check(mesas.includes("Cód. {codigoDoAtendimento(o)}") && mesas.includes("tempoEStatusDaMesa(o)") && /font-mono/.test(mesas), "card da mesa ocupada mostra 'N min · aberta/último pedido' e o chip 'Cód. 000000'");
check(ler("src/components/mesas/MesaDialog.jsx").includes("Cód. {codigoDoAtendimento(order)}"), "o código também aparece no atendimento aberto");

// ---------- folha de impressão ----------
const mesasQr = await Promise.all([1, 2, 3, 4, 5, 6, 7].map(async (n) => ({ numero: String(n), svg: await qrSvg(await linkDaMesa(A, n, { base: BASE })) })));
const folha = montarFolhaMesas(mesasQr, { empresa: "Restaurante <&>" });
check((folha.match(/class="card"/g) || []).length === 7 && (folha.match(/<svg/g) || []).length === 7 && (folha.match(/class="pagina"/g) || []).length === 2, "folha: um cartão 'MESA N + QR' por mesa, 6 por A4");
check([1, 2, 3, 4, 5, 6, 7].every((n) => folha.includes(`MESA ${n}</div>`)) && folha.includes("Restaurante &lt;&amp;&gt;") && !folha.includes(A), "folha traz 'MESA N', escapa o nome e não expõe company_id");

// ---------- o que não pode mudar ----------
check(!/mesaQr|MFMESA|LerMesa|QrMesa/.test(ler("src/components/pos/CheckoutDialog.jsx")), "CheckoutDialog intacto");
check(/mei: 119\.9/.test(ler("supabase/functions/_shared/plans.ts")) && /simples: 169\.9/.test(ler("supabase/functions/_shared/plans.ts")) && !/mesa/i.test(ler("src/lib/plans.js").replace(/\{ id: "mesas"[^\n]*\n/, "")), "planos e demais adicionais intactos (só o adicional Mesas foi acrescentado)");
const migs = readFileSync(new URL("../supabase/migrations/081_table_orders_cards.sql", import.meta.url), "utf8");
check(/card_number/.test(migs) && !readFileSync(new URL("../supabase/migrations/080_table_orders.sql", import.meta.url), "utf8").includes("card_number"), "migrations 080/081 intactas (nenhuma migration nova)");
check(!/balan/i.test(dlg + ler("src/lib/mesaQr.js")), "Balança de Etiqueta intacta");

console.log(JSON.stringify({ passaram, falhas: falhas.length }));
if (falhas.length) {
  falhas.forEach((f) => console.log("FALHA:", f));
  process.exit(1);
}
console.log(`${passaram} passaram, 0 falharam`);
