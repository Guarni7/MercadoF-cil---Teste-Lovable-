// Meta Pixel Base Code — movido de index.html para arquivo externo pra
// não depender de script-src 'unsafe-inline' na CSP (vercel.json).
// Mesmo comportamento: só carrega se houver meta_pixel_id salvo (Integrações).
(function () {
  function loadPixel() {
    var pixelId = localStorage.getItem("meta_pixel_id");
    if (!pixelId) return;
    if (window.fbq) return;
    !(function (f, b, e, v, n, t, s) {
      if (f.fbq) return;
      n = f.fbq = function () {
        n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments);
      };
      if (!f._fbq) f._fbq = n;
      n.push = n;
      n.loaded = !0;
      n.version = "2.0";
      n.queue = [];
      t = b.createElement(e);
      t.async = !0;
      t.src = v;
      s = b.getElementsByTagName(e)[0];
      s.parentNode.insertBefore(t, s);
    })(window, document, "script", "https://connect.facebook.net/en_US/fbevents.js");
    window.fbq("init", pixelId);
    window.fbq("track", "PageView");
  }
  loadPixel();
})();
