/**
 * Helpers de segurança para Base44 Deno functions.
 */

const buckets = new Map();

export function rateLimit(key, { max = 20, windowMs = 60_000 } = {}) {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || now - b.start > windowMs) {
    b = { start: now, count: 0 };
    buckets.set(key, b);
  }
  b.count += 1;
  if (b.count > max) {
    return { ok: false, retryAfterSec: Math.ceil((b.start + windowMs - now) / 1000) };
  }
  return { ok: true };
}

export function publicError(error, fallback = "Erro interno. Tente novamente.") {
  const msg = String(error?.message || error || "");
  if (/unauthorized|forbidden|inválid|invalid|limite|não autoriz|plano|documento|empresa/i.test(msg)) {
    return msg.slice(0, 200);
  }
  console.error("[fn]", msg);
  return fallback;
}

export function jsonError(status, message, extra = {}) {
  return Response.json({ error: message, ...extra }, { status });
}
