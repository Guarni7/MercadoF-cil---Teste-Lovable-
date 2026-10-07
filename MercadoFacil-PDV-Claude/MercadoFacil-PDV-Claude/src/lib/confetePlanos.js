// "Fogos de artifício" ao ligar a cobrança anual na tela de planos. Usa as cores do próprio tema
// (--primary, o verde/teal do sistema): nenhuma cor nova. Não dispara com prefers-reduced-motion.
import confetti from "canvas-confetti";

/** "164 75% 34%" (variável do shadcn) → "#rrggbb": o canvas-confetti só entende cores em hexadecimal. */
export function hslParaHex(h, s, l) {
  const sat = s / 100;
  const lum = l / 100;
  const k = (n) => (n + h / 30) % 12;
  const a = sat * Math.min(lum, 1 - lum);
  const f = (n) => lum - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const hex = (x) => Math.round(255 * x).toString(16).padStart(2, "0");
  return `#${hex(f(0))}${hex(f(8))}${hex(f(4))}`;
}

/** Paleta a partir do --primary do tema: o próprio tom e variações vizinhas de matiz/luminosidade. */
export function paletaDoTema(valorPrimary) {
  const m = /^\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%/.exec(valorPrimary || "");
  const [h, s, l] = m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [164, 75, 34];
  return [hslParaHex(h, s, l), hslParaHex(h - 14, s, Math.min(l + 12, 80)), hslParaHex(h + 14, s, Math.min(l + 22, 85)), hslParaHex(h, Math.max(s - 25, 30), Math.min(l + 34, 90))];
}

// O confete do canvas-confetti usa, por padrão, um Web Worker criado a partir de um Blob. A política de segurança
// do site (vercel.json: CSP sem worker-src blob:) BLOQUEIA isso em produção/Preview, e aí o efeito some em silêncio
// (no servidor de desenvolvimento, que não aplica a CSP, funcionava). Por isso: canvas próprio e useWorker: false,
// sem afrouxar a CSP.
let disparar = null;
function obterDisparador() {
  if (disparar) return disparar;
  const canvas = document.createElement("canvas");
  canvas.setAttribute("aria-hidden", "true");
  canvas.style.cssText = "position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:9999";
  document.body.appendChild(canvas);
  disparar = confetti.create(canvas, { resize: true, useWorker: false });
  return disparar;
}

/** Dispara o confete saindo do centro do elemento (a chave mensal/anual). */
export function dispararConfete(elemento) {
  if (typeof window === "undefined" || !elemento) return;
  const r = elemento.getBoundingClientRect();
  const primary = getComputedStyle(document.documentElement).getPropertyValue("--primary");
  obterDisparador()({
    particleCount: 50,
    spread: 60,
    origin: { x: (r.left + r.width / 2) / window.innerWidth, y: (r.top + r.height / 2) / window.innerHeight },
    colors: paletaDoTema(primary),
    ticks: 200,
    gravity: 1.2,
    decay: 0.94,
    startVelocity: 30,
    shapes: ["circle"],
    disableForReducedMotion: true,
  });
}
