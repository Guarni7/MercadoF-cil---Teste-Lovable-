/*
 * Service worker do PDV.
 *
 * O caixa precisa continuar vendendo se a internet cair — inclusive depois de
 * um F5 ou de abrir o app de novo. Por isso o shell fica em cache e é servido
 * quando a rede falha.
 *
 * Para não repetir o problema de código velho grudado após deploy, navegação e
 * index.html são sempre buscados na rede primeiro: com internet o operador
 * recebe a versão nova; sem internet, a última que funcionou. Os arquivos de
 * /assets/ têm hash no nome, então podem vir do cache sem risco de mistura.
 */
const CACHE = "mf-pdv-shell-v7";
const SHELL = "/index.html";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll([SHELL, "/manifest.json"]))
      .catch(() => {})
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function cacheCopy(request, response) {
  if (!response || !response.ok || response.type === "opaque") return response;
  const clone = response.clone();
  caches.open(CACHE).then((cache) => cache.put(request, clone));
  return response;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Navegação (abrir/recarregar qualquer rota): rede primeiro, shell salvo como
  // reserva. É o que mantém /pdv, /vendas etc. acessíveis sem internet.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((res) => {
          if (res.ok) cacheCopy(new Request(SHELL), res);
          return res;
        })
        .catch(async () => (await caches.match(SHELL)) || Response.error())
    );
    return;
  }

  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ||
          fetch(request).then((res) => cacheCopy(request, res))
      )
    );
    return;
  }

  event.respondWith(
    fetch(request)
      .then((res) => cacheCopy(request, res))
      .catch(() => caches.match(request).then((hit) => hit || Response.error()))
  );
});
