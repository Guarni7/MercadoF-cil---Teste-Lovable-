/**
 * Gera os assets da identidade visual do MercadoFácil a partir das 3 imagens APROVADAS em branding/source/
 * (nada é redesenhado: só recorte, máscara pelo contorno medido da arte, transparência e reamostragem).
 *
 *   branding/source/icone-mf.png      símbolo MF em quadrado arredondado escuro  → ícones (app, favicon, PWA, Windows)
 *   branding/source/logo-nome.png     símbolo + "MercadoFácil" (fundo claro)      → logo com nome (telas de entrada, OG)
 *   branding/source/logo-quadrado-nome.png  símbolo + nome em quadrado escuro      → uso em fundo escuro
 *
 * Saídas: public/brand/*, public/favicon.ico, electron/build/icon.png e icon.ico (instalador/exe do Windows).
 * Uso: node scripts/build-brand-assets.cjs
 */
const path = require("path");
const fs = require("fs");
const ROOT = path.join(__dirname, "..") + path.sep;
const SRC = path.join(ROOT, "branding", "source") + path.sep;
const { PNG } = require("pngjs"); // dependência transitiva (qrcode)

const ler = (arq) => { const p = PNG.sync.read(fs.readFileSync(arq)); return { w: p.width, h: p.height, d: Buffer.from(p.data) }; };
const escrever = (arq, im) => { const p = new PNG({ width: im.w, height: im.h }); im.d.copy(p.data); fs.mkdirSync(require("path").dirname(arq), { recursive: true }); fs.writeFileSync(arq, PNG.sync.write(p, { colorType: 6 })); };
const nova = (w, h, rgba = [0, 0, 0, 0]) => { const d = Buffer.alloc(w * h * 4); for (let i = 0; i < w * h; i++) { d[i * 4] = rgba[0]; d[i * 4 + 1] = rgba[1]; d[i * 4 + 2] = rgba[2]; d[i * 4 + 3] = rgba[3]; } return { w, h, d }; };
const lum = (d, i) => 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];

/** recorta [x,y,w,h] */
function recortar(im, x, y, w, h) {
  const o = nova(w, h);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const sx = x + i, sy = y + j;
    if (sx < 0 || sy < 0 || sx >= im.w || sy >= im.h) continue;
    im.d.copy(o.d, (j * w + i) * 4, (sy * im.w + sx) * 4, (sy * im.w + sx) * 4 + 4);
  }
  return o;
}

/** média de área (premultiplicada) para qualquer tamanho; ampliação cai em bilinear simples */
function redimensionar(im, W, H) {
  const o = nova(W, H);
  const sx = im.w / W, sy = im.h / H;
  for (let j = 0; j < H; j++) {
    const y0 = j * sy, y1 = (j + 1) * sy;
    for (let i = 0; i < W; i++) {
      const x0 = i * sx, x1 = (i + 1) * sx;
      let r = 0, g = 0, b = 0, a = 0, peso = 0;
      for (let yy = Math.floor(y0); yy < Math.ceil(y1); yy++) {
        const wy = Math.min(yy + 1, y1) - Math.max(yy, y0);
        for (let xx = Math.floor(x0); xx < Math.ceil(x1); xx++) {
          const wx = Math.min(xx + 1, x1) - Math.max(xx, x0);
          const w = wx * wy;
          const k = (Math.min(yy, im.h - 1) * im.w + Math.min(xx, im.w - 1)) * 4;
          const al = im.d[k + 3] / 255;
          r += im.d[k] * al * w; g += im.d[k + 1] * al * w; b += im.d[k + 2] * al * w; a += al * w; peso += w;
        }
      }
      const k = (j * W + i) * 4;
      if (a > 0) { o.d[k] = Math.round(r / a); o.d[k + 1] = Math.round(g / a); o.d[k + 2] = Math.round(b / a); }
      o.d[k + 3] = Math.round((a / peso) * 255);
    }
  }
  return o;
}

/** compõe `fg` sobre fundo opaco */
function sobre(im, rgb) {
  const o = nova(im.w, im.h, [rgb[0], rgb[1], rgb[2], 255]);
  for (let i = 0; i < im.w * im.h; i++) {
    const a = im.d[i * 4 + 3] / 255;
    for (let c = 0; c < 3; c++) o.d[i * 4 + c] = Math.round(im.d[i * 4 + c] * a + rgb[c] * (1 - a));
  }
  return o;
}

/** cola `fg` (com alfa) em (x,y) sobre `base` */
function colar(base, fg, x, y) {
  for (let j = 0; j < fg.h; j++) for (let i = 0; i < fg.w; i++) {
    const bx = x + i, by = y + j;
    if (bx < 0 || by < 0 || bx >= base.w || by >= base.h) continue;
    const k = (j * fg.w + i) * 4, m = (by * base.w + bx) * 4;
    const a = fg.d[k + 3] / 255;
    for (let c = 0; c < 3; c++) base.d[m + c] = Math.round(fg.d[k + c] * a + base.d[m + c] * (1 - a));
    base.d[m + 3] = Math.max(base.d[m + 3], fg.d[k + 3]);
  }
}

/** ICO com entradas PNG (Vista+) */
function ico(arq, entradas /* [{size, png:Buffer}] */) {
  const n = entradas.length;
  const head = Buffer.alloc(6 + 16 * n);
  head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(n, 4);
  let off = head.length;
  entradas.forEach((e, i) => {
    const b = 6 + 16 * i;
    head[b] = e.size >= 256 ? 0 : e.size; head[b + 1] = e.size >= 256 ? 0 : e.size; head[b + 2] = 0; head[b + 3] = 0;
    head.writeUInt16LE(1, b + 4); head.writeUInt16LE(32, b + 6); head.writeUInt32LE(e.png.length, b + 8); head.writeUInt32LE(off, b + 12);
    off += e.png.length;
  });
  fs.writeFileSync(arq, Buffer.concat([head, ...entradas.map((e) => e.png)]));
}
const pngBuf = (im) => { const p = new PNG({ width: im.w, height: im.h }); im.d.copy(p.data); return PNG.sync.write(p, { colorType: 6 }); };

const I = { ler, escrever, nova, recortar, redimensionar, sobre, colar, ico, pngBuf, lum };


// ---------- máscara: superelipse ajustada ao contorno medido da própria arte (cobertura 4x4 para antialias) ----------
function mascaraSuper(im, cx, cy, a, b, n) {
  const { w, h } = im;
  const o = { w, h, d: Buffer.from(im.d) };
  const S = 4;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let dentro = 0;
    for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) {
      const px = x + (sx + 0.5) / S, py = y + (sy + 0.5) / S;
      if (Math.pow(Math.abs(px - cx) / a, n) + Math.pow(Math.abs(py - cy) / b, n) <= 1) dentro++;
    }
    o.d[(y * w + x) * 4 + 3] = Math.round((dentro / (S * S)) * 255);
  }
  return o;
}

// ---------- 1. ícone MF (somente símbolo) ----------
const fonte = I.ler(SRC + "icone-mf.png");
// parâmetros medidos na arte aprovada (ajuste robusto do contorno do vidro): meia-largura 475, meia-altura 477, expoente 5,25; recuo de 2px
const NEXP = 5.25;
const A = 475 - 2, B = 477 - 2, CX = 627, CY = 613;
const icMasc = mascaraSuper(fonte, CX, CY, A, B, NEXP);
const caixa = [Math.floor(CX - A), Math.floor(CY - B), Math.ceil(2 * A), Math.ceil(2 * B)];
const lado = Math.max(caixa[2], caixa[3]);
const icone = I.recortar(icMasc, caixa[0] - Math.floor((lado - caixa[2]) / 2), caixa[1] - Math.floor((lado - caixa[3]) / 2), lado, lado);
// 1px de segurança para tirar o fio claro de antialias do contorno: reduz com média de área (suaviza o recorte)
const icone1024 = I.redimensionar(icone, 1024, 1024);
const tamanhos = { 16: 16, 24: 24, 32: 32, 48: 48, 64: 64, 128: 128, 180: 180, 192: 192, 256: 256, 512: 512 };
const icones = {};
for (const t of Object.values(tamanhos)) icones[t] = I.redimensionar(icone1024, t, t);
// Tamanhos pequenos (<=48 px): o mesmo símbolo com a moldura de vidro mais justa (recorte de 88% da arte, mesma forma),
// para o monograma MF ficar maior e legível. Continua SÓ o símbolo, sem texto.
const ZOOM = 0.88;
const justo = mascaraSuper(fonte, CX, CY, A * ZOOM, B * ZOOM, NEXP);
const justoCx = Math.floor(CX - A * ZOOM), justoCy = Math.floor(CY - B * ZOOM), justoW = Math.ceil(2 * A * ZOOM), justoH = Math.ceil(2 * B * ZOOM);
const justoLado = Math.max(justoW, justoH);
const justo1024 = I.redimensionar(I.recortar(justo, justoCx - Math.floor((justoLado - justoW) / 2), justoCy - Math.floor((justoLado - justoH) / 2), justoLado, justoLado), 1024, 1024);
for (const t of [16, 24, 32, 48]) icones[t] = I.redimensionar(justo1024, t, t);

I.escrever(ROOT + "public/brand/mf-icon-512.png", icones[512]);
I.escrever(ROOT + "public/brand/mf-icon-192.png", icones[192]);
I.escrever(ROOT + "public/brand/mf-icon-256.png", icones[256]);
I.escrever(ROOT + "public/brand/favicon-32.png", icones[32]);
// apple-touch-icon: sem transparência (iOS arredonda sozinho) sobre o azul-escuro da própria arte
I.escrever(ROOT + "public/brand/apple-touch-icon.png", I.sobre(icones[180], [fonte.d[(20 * fonte.w + 20) * 4], fonte.d[(20 * fonte.w + 20) * 4 + 1], fonte.d[(20 * fonte.w + 20) * 4 + 2]]));
I.ico(ROOT + "public/favicon.ico", [16, 32, 48].map((s) => ({ size: s, png: I.pngBuf(icones[s]) })));
// Electron / Windows
I.escrever(ROOT + "electron/build/icon.png", icones[512]);
I.ico(ROOT + "electron/build/icon.ico", [16, 24, 32, 48, 64, 128, 256].map((s) => ({ size: s, png: I.pngBuf(icones[s]) })));

// ---------- 2. logo com nome (fundo claro → transparente) ----------
const ln = I.ler(SRC + "logo-nome.png");
const bg = [255, 255, 255];
let minx = ln.w, miny = ln.h, maxx = 0, maxy = 0;
for (let y = 0; y < ln.h; y++) for (let x = 0; x < ln.w; x++) {
  const k = (y * ln.w + x) * 4;
  const m = Math.min(ln.d[k], ln.d[k + 1], ln.d[k + 2]);
  let a = 1 - m / 255;
  if (a < 0.03) a = 0;
  if (a > 0) {
    for (let c = 0; c < 3; c++) ln.d[k + c] = Math.max(0, Math.min(255, Math.round((ln.d[k + c] - bg[c] * (1 - a)) / a)));
    if (a > 0.08) { minx = Math.min(minx, x); maxx = Math.max(maxx, x); miny = Math.min(miny, y); maxy = Math.max(maxy, y); }
  } else { ln.d[k] = ln.d[k + 1] = ln.d[k + 2] = 0; }
  ln.d[k + 3] = Math.round(a * 255);
}
const pad = 12;
const lnCorte = I.recortar(ln, minx - pad, miny - pad, maxx - minx + 1 + 2 * pad, maxy - miny + 1 + 2 * pad);
console.log("logo-nome recorte:", lnCorte.w, lnCorte.h);
const logoW = 1000;
const logo = I.redimensionar(lnCorte, logoW, Math.round((lnCorte.h * logoW) / lnCorte.w));
I.escrever(ROOT + "public/brand/mercadofacil-logo.png", logo);

// ---------- 3. símbolo + nome em quadrado escuro (fundo escuro) ----------
const lq = I.ler(SRC + "logo-quadrado-nome.png");
// contorno medido: meia-largura 551, meia-altura 554, expoente 5,25 (recuo de 2px)
const AQ = 551 - 2, BQ = 554 - 2, CXQ = 627, CYQ = 622;
const lqMasc = mascaraSuper(lq, CXQ, CYQ, AQ, BQ, NEXP);
const ladoQ = Math.ceil(2 * Math.max(AQ, BQ));
const quad = I.recortar(lqMasc, Math.floor(CXQ - ladoQ / 2), Math.floor(CYQ - ladoQ / 2), ladoQ, ladoQ);
I.escrever(ROOT + "public/brand/mercadofacil-logo-escuro.png", I.redimensionar(quad, 512, 512));

// ---------- 4. imagem de compartilhamento 1200x630 (a logo aprovada centralizada) ----------
const og = I.nova(1200, 630, [248, 250, 252, 255]);
const alvoH = 470;
const logoOg = I.redimensionar(lnCorte, Math.round((lnCorte.w * alvoH) / lnCorte.h), alvoH);
I.colar(og, logoOg, Math.round((1200 - logoOg.w) / 2), Math.round((630 - logoOg.h) / 2));
I.escrever(ROOT + "public/brand/og-image.png", og);

console.log("assets de marca gerados");
