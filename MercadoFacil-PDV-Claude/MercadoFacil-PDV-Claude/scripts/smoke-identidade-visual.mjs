/**
 * Smoke da identidade visual (logo MF aprovada): assets existem com as dimensões certas, ICO com todos os
 * tamanhos, favicon/PWA/Open Graph apontam para os arquivos novos, nenhuma referência ao ícone antigo,
 * Electron usa o ícone novo (e ele vai dentro do pacote), telas de entrada mostram a logo com nome.
 * Sem rede.
 *
 * Uso: node scripts/smoke-identidade-visual.mjs
 */
import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { join, resolve } from "path";

const falhas = [];
const ok = [];
const check = (cond, msg) => (cond ? ok.push(msg) : falhas.push(msg));
const raiz = process.cwd();
const ler = (p) => readFileSync(resolve(raiz, p), "utf8").split("\r\n").join("\n");
const bin = (p) => readFileSync(resolve(raiz, p));

/** largura/altura e se tem canal alfa, lidos do cabeçalho do PNG */
function png(p) {
  const b = bin(p);
  const assinatura = b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  return { valido: assinatura, w: b.readUInt32BE(16), h: b.readUInt32BE(20), tipoCor: b[25] };
}
/** entradas do ICO: [{ tamanho, png }] */
function ico(p) {
  const b = bin(p);
  const n = b.readUInt16LE(4);
  const out = [];
  for (let i = 0; i < n; i++) {
    const o = 6 + 16 * i;
    const t = b[o] || 256;
    const off = b.readUInt32LE(o + 12);
    out.push({ tamanho: t, png: b.subarray(off, off + 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) });
  }
  return { tipo: b.readUInt16LE(2), entradas: out };
}

// ---------- fontes aprovadas ----------
for (const f of ["icone-mf", "logo-nome", "logo-quadrado-nome"]) check(existsSync(resolve(raiz, `branding/source/${f}.png`)) && png(`branding/source/${f}.png`).valido, `fonte aprovada preservada: branding/source/${f}.png`);

// ---------- ícones (somente símbolo, com transparência nos cantos) ----------
const quadrados = { "public/brand/mf-icon-512.png": 512, "public/brand/mf-icon-256.png": 256, "public/brand/mf-icon-192.png": 192, "public/brand/favicon-32.png": 32, "public/brand/apple-touch-icon.png": 180, "electron/build/icon.png": 512 };
for (const [p, lado] of Object.entries(quadrados)) {
  const i = png(p);
  check(i.valido && i.w === lado && i.h === lado, `${p}: PNG ${lado}x${lado}`);
}
check(png("public/brand/mf-icon-512.png").tipoCor === 6 && png("electron/build/icon.png").tipoCor === 6, "ícone do app tem canal alfa (cantos transparentes)");
check(png("public/brand/apple-touch-icon.png").tipoCor === 6, "apple-touch-icon gravado em RGBA (opaco: cantos preenchidos)");
const logo = png("public/brand/mercadofacil-logo.png");
check(logo.valido && logo.w === 1000 && logo.h > 400 && logo.tipoCor === 6, `logo com nome: PNG ${logo.w}x${logo.h} com transparência`);
check(ler("src/components/AuthLayout.jsx").includes(`height="${logo.h}"`) && ler("src/pages/Register.jsx").includes(`height="${logo.h}"`) && ler("src/components/ui/sign-in.jsx").includes(`height="${logo.h}"`), "width/height das <img> da logo batem com o arquivo (sem salto de layout)");
const escuro = png("public/brand/mercadofacil-logo-escuro.png");
check(escuro.valido && escuro.w === 512 && escuro.h === 512 && escuro.tipoCor === 6, "logo com nome para fundo escuro 512x512 (cantos transparentes)");
check(!existsSync(resolve(raiz, "public/brand/mercadofacil-circulo.png")), "o selo circular da versão anterior saiu");
const og = png("public/brand/og-image.png");
check(og.valido && og.w === 1200 && og.h === 630, "imagem de compartilhamento (Open Graph) 1200x630");

// ---------- ICO: favicon e Windows ----------
const fav = ico("public/favicon.ico");
check(fav.tipo === 1 && [16, 32, 48].every((t) => fav.entradas.some((e) => e.tamanho === t && e.png)), "public/favicon.ico: 16, 32 e 48 px");
const win = ico("electron/build/icon.ico");
check(win.tipo === 1 && [16, 24, 32, 48, 64, 128, 256].every((t) => win.entradas.some((e) => e.tamanho === t && e.png)), "electron/build/icon.ico: 16, 24, 32, 48, 64, 128 e 256 px (exe, atalhos, instalador)");
check(statSync(resolve(raiz, "electron/build/icon.ico")).size > 20000, "icon.ico não é o antigo (maior que o ícone placeholder)");

// ---------- web: favicon, PWA, Open Graph ----------
const html = ler("index.html");
check(html.includes('href="/favicon.ico"') && html.includes('href="/brand/favicon-32.png"') && html.includes('href="/brand/apple-touch-icon.png"'), "index.html: favicon .ico, PNG 32 e apple-touch-icon novos");
check(html.includes("/brand/og-image.png") && !html.includes("login-hero.png") && html.includes('og:image:width" content="1200"'), "Open Graph e Twitter Card usam a nova imagem 1200x630");
const manifest = JSON.parse(ler("public/manifest.json"));
check(manifest.icons.some((i) => i.src === "/brand/mf-icon-192.png") && manifest.icons.some((i) => i.src === "/brand/mf-icon-512.png") && manifest.icons.every((i) => existsSync(resolve(raiz, "public" + i.src))), "manifest.json: ícones 192 e 512 existem");

// ---------- nada do ícone antigo ----------
check(!existsSync(resolve(raiz, "public/images/app-icon.svg")) && !existsSync(resolve(raiz, "scripts/make-app-icon.cjs")), "ícone antigo (app-icon.svg) e o gerador antigo foram removidos");
const referencias = [];
const varre = (d) => {
  for (const n of readdirSync(d)) {
    if (["node_modules", "dist", ".git", "graphify-out", "vault-obsidian", "release-artifacts", "legacy"].includes(n)) continue;
    const p = join(d, n);
    const s = statSync(p);
    if (s.isDirectory()) varre(p);
    else if (/\.(js|jsx|cjs|mjs|json|html|yml|md|css)$/.test(n) && s.size < 2e6 && !n.includes("smoke-identidade-visual")) {
      if (readFileSync(p, "utf8").includes("app-icon")) referencias.push(p.replace(raiz, ""));
    }
  }
};
varre(raiz);
check(referencias.length === 0, `nenhuma referência restante ao ícone antigo${referencias.length ? ": " + referencias.join(", ") : ""}`);

// ---------- telas ----------
const nav = ler("src/components/landing/LandingNav.jsx");
const rodape = ler("src/components/landing/LandingFooter.jsx");
check(nav.includes('src="/brand/mf-icon-256.png"') && !/<Store\b/.test(nav), "landing: cabeçalho usa o símbolo MF (o ícone genérico de loja saiu)");
check(rodape.includes('src="/brand/mf-icon-256.png"') && !/<Store\b/.test(rodape), "landing: rodapé usa o símbolo MF");
const layout = ler("src/components/Layout.jsx");
check(!layout.includes("MiniMercado") && layout.includes("MercadoFácil") && !/<Store\b/.test(layout) && (layout.match(/\/brand\/mf-icon-256\.png/g) || []).length >= 2, "app: menu lateral e cabeçalho móvel com símbolo MF e nome 'MercadoFácil' (sem 'MiniMercado')");
check(layout.includes('<img src={logoUrl} alt="Logo"'), "app: a logo própria que cada loja envia continua tendo prioridade no menu");
check(ler("src/components/AuthLayout.jsx").includes("/brand/mercadofacil-logo.png") && ler("src/components/ui/sign-in.jsx").includes("/brand/mercadofacil-logo.png"), "login, cadastro, esqueci a senha e nova senha mostram a logo com nome");
check(ler("src/App.jsx").includes("/brand/mf-icon-256.png"), "tela de carregamento mostra o símbolo MF");

// ---------- Electron ----------
const main = ler("electron/main.cjs");
const yml = ler("electron-builder.yml");
check(main.includes('path.join(__dirname, "build", "icon.png")') && yml.includes("- electron/build/icon.png"), "Electron: a janela usa build/icon.png e o arquivo entra no app.asar (antes faltava no pacote)");
check(/^  icon: electron\/build\/icon\.ico$/m.test(yml) && (yml.match(/electron\/build\/icon\.ico/g) || []).length >= 3, "electron-builder: exe e instalador/desinstalador usam o icon novo");

console.log("\nSmoke — identidade visual (MF)\n");
for (const m of ok) console.log(`  PASS  ${m}`);
for (const m of falhas) console.log(`  FAIL  ${m}`);
console.log(`\n${ok.length} passaram, ${falhas.length} falharam\n`);
process.exit(falhas.length ? 1 : 0);
