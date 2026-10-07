// Meta Pixel tracking utility
// Pixel ID is configured via Integracoes page and stored in localStorage

const STORAGE_KEY = "meta_pixel_id";

/** @typedef {typeof window & { fbq?: any, _fbq?: any, __fbqPixelId?: string }} FbqWindow */
/** @returns {FbqWindow} */
const fbqWindow = () => /** @type {FbqWindow} */ (window);

export function getMetaPixelId() {
  try {
    return localStorage.getItem(STORAGE_KEY) || "";
  } catch {
    return "";
  }
}

export function setMetaPixelId(id) {
  try {
    if (id) {
      localStorage.setItem(STORAGE_KEY, id);
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  } catch {}
}

export function initMetaPixel(pixelId) {
  if (!pixelId || typeof window === "undefined") return;
  const win = fbqWindow();
  if (win.fbq && win.__fbqPixelId === pixelId) return;

  win.__fbqPixelId = pixelId;

  (function (f, b, e, v, n, t, s) {
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
  })(win, document, "script", "https://connect.facebook.net/en_US/fbevents.js");

  win.fbq("init", pixelId);
  win.fbq("track", "PageView");
}

export function trackEvent(eventName, params = {}) {
  if (typeof window === "undefined") return;
  const win = fbqWindow();
  if (!win.fbq) return;
  try {
    win.fbq("track", eventName, params);
  } catch (e) {
    console.error("Meta Pixel track error:", e);
  }
}

export function trackPageView() {
  trackEvent("PageView");
}

export function trackPurchase(value, currency = "BRL") {
  trackEvent("Purchase", { value, currency });
}

export function trackAddToCart(value, currency = "BRL") {
  trackEvent("AddToCart", { value, currency });
}

export function trackInitiateCheckout(value, currency = "BRL") {
  trackEvent("InitiateCheckout", { value, currency });
}

export function trackSearch(query) {
  trackEvent("Search", { search_string: query });
}