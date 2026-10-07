/**
 * Smoke do destino de quem NÃO está autenticado: web → /landing, app desktop (Electron) → /login (sem rede).
 *
 * 1. destinoNaoAutenticado / ehElectron: web sempre /landing; Electron sempre /login, com ?returnTo= para
 *    deep links; o returnTo gerado volta pelo safeReturnTo real (mesmo código do Login).
 * 2. Código: App.jsx só troca o destino; /landing, /login e o AuthContext continuam como estavam.
 * 3. O texto literal "\n" (barra invertida + n) que aparecia no canto da tela da 1.3.x não existe no
 *    index.html de hoje (nem no dist/index.html gerado, se houver).
 *
 * Uso: node scripts/smoke-destino-nao-autenticado.mjs
 */
import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import { destinoNaoAutenticado, ehElectron } from "../src/lib/destinoNaoAutenticado.js";
import { safeReturnTo } from "../src/lib/authReturnTo.js";

const falhas = [];
const ok = [];
const check = (cond, msg) => (cond ? ok.push(msg) : falhas.push(msg));
const ler = (p) => readFileSync(resolve(process.cwd(), p), "utf8").split("\r\n").join("\n");
const BARRA_N = String.fromCharCode(92) + "n"; // barra invertida + n, não uma quebra de linha

// ---------- 1. a decisão ----------
check(destinoNaoAutenticado({ electron: false }) === "/landing", "web sem sessão → /landing");
check(
  ["/", "/pdv", "/vendas?x=1", "/configuracoes?aba=pagamento"].every((p) => destinoNaoAutenticado({ electron: false, pathname: p.split("?")[0], search: p.includes("?") ? `?${p.split("?")[1]}` : "" }) === "/landing"),
  "web: qualquer deep link sem sessão continua indo para /landing (nada mudou)",
);
check(destinoNaoAutenticado({ electron: true }) === "/login" && destinoNaoAutenticado({ electron: true, pathname: "/", search: "" }) === "/login", "Electron sem sessão → /login (sem returnTo na raiz)");
check(destinoNaoAutenticado({ electron: true, pathname: "/pdv" }) === "/login?returnTo=%2Fpdv", "Electron: deep link /pdv sem sessão → /login?returnTo=/pdv");
check(
  destinoNaoAutenticado({ electron: true, pathname: "/configuracoes", search: "?aba=pagamento" }) === "/login?returnTo=%2Fconfiguracoes%3Faba%3Dpagamento",
  "Electron: o returnTo preserva o caminho e a query (ex.: ?aba=pagamento)",
);
check(!destinoNaoAutenticado({ electron: true, pathname: "/pdv" }).startsWith("/landing"), "Electron nunca usa a landing como destino automático");

// o returnTo volta pelo MESMO safeReturnTo do Login
const voltaDe = (destino) => {
  const u = new URL(destino, "https://app.exemplo");
  globalThis.window = { location: { search: u.search, origin: "https://app.exemplo" } };
  const r = safeReturnTo();
  delete globalThis.window;
  return r;
};
check(voltaDe(destinoNaoAutenticado({ electron: true, pathname: "/pdv", search: "?a=1" })) === "/pdv?a=1", "depois do login o usuário volta para o deep link (safeReturnTo real)");
check(voltaDe(destinoNaoAutenticado({ electron: true })) === "/", "sem returnTo, volta para a raiz");
check(voltaDe("/login?returnTo=%2F%2Fevil.com") === "/" && voltaDe("/login?returnTo=https%3A%2F%2Fevil.com%2F") === "/", "o safeReturnTo continua recusando redirecionamento para outro site");

// detecção do Electron
const comJanela = (w) => {
  globalThis.window = w;
  const r = ehElectron();
  delete globalThis.window;
  return r;
};
check(comJanela({ electronAPI: { isElectron: true } }) === true, "ehElectron: window.electronAPI.isElectron === true");
check(comJanela({}) === false && comJanela({ electronAPI: {} }) === false && comJanela({ electronAPI: { isElectron: "true" } }) === false, "ehElectron: sem preload (navegador) ou valor diferente de true → false");
check(ehElectron() === false, "ehElectron: sem window (Node) → false");

// ---------- 2. código ----------
const app = ler("src/App.jsx");
check(
  app.includes("<ProtectedRoute unauthenticatedElement={<NaoAutenticado />} />") &&
    app.includes("destinoNaoAutenticado({ electron: ehElectron(), pathname, search })") &&
    !/unauthenticatedElement=\{<Navigate to="\/landing"/.test(app),
  "o ProtectedRoute usa o destino decidido pela função (Navigate fixo para /landing saiu)",
);
check(
  app.includes('<Route path="/landing" element={<Landing />} />') && app.includes('<Route path="/login" element={<Login />} />') && app.includes('<Route path="*" element={<AuthenticatedApp />} />'),
  "/landing e /login continuam rotas diretas; o desktop não perdeu a landing",
);
const helper = ler("src/lib/destinoNaoAutenticado.js").replace(/\/\/.*$/gm, "");
check(!/supabase|getSession|AuthContext|localStorage|fetch\(/.test(helper), "nenhuma lógica de autenticação duplicada: o helper só escolhe o destino");
check(!ler("src/lib/AuthContext.jsx").includes("destinoNaoAutenticado") && !ler("src/lib/supabase.js").includes("electron"), "AuthContext e o cliente Supabase não foram tocados");

// ---------- 3. o "\n" literal ----------
// só HTML: em arquivos .js uma barra invertida + n é código legítimo (strings), não texto na tela
const paginas = [["index.html (fonte)", "index.html"]];
if (existsSync(resolve(process.cwd(), "dist/index.html"))) paginas.push(["dist/index.html (build)", "dist/index.html"]);
for (const [nome, arq] of paginas) check(!ler(arq).includes(BARRA_N), `${nome}: sem o texto literal barra-invertida+n`);
check(!ler("public/pixel-loader.js").includes("</script>") && !ler("index.html").includes("<!-- End Meta Pixel"), "o Pixel está num arquivo externo e o resto do bloco antigo (onde ficava o texto solto) não existe mais");

console.log("\nSmoke — destino de quem não está autenticado (web x desktop) e \\n literal\n");
for (const m of ok) console.log(`  PASS  ${m}`);
for (const m of falhas) console.log(`  FAIL  ${m}`);
console.log(`\n${ok.length} passaram, ${falhas.length} falharam\n`);
process.exit(falhas.length ? 1 : 0);
