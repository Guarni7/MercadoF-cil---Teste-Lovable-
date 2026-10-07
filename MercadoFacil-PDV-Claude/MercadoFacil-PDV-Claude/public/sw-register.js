// Registro do Service Worker — movido de index.html para arquivo externo pra
// não depender de script-src 'unsafe-inline' na CSP (vercel.json).
// Mesmo comportamento de antes.
// Em localhost (desenvolvimento) quem decide é src/main.jsx (import.meta.env.PROD): lá o Service
// Worker nunca é registrado, para não servir código velho do cache.
const emDesenvolvimento = ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);
if ("serviceWorker" in navigator && !emDesenvolvimento) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}
