// Serve dist/ locally with the exact response headers vercel.json configures,
// so CSP/HSTS/etc. can be verified against real HTTP responses before a
// Vercel preview exists. Not used in production — local security-header check only.
import http from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..", "dist");
const vercelConfig = JSON.parse(await readFile(path.resolve(import.meta.dirname, "..", "vercel.json"), "utf8"));
const headers = Object.fromEntries(vercelConfig.headers[0].headers.map((h) => [h.key, h.value]));

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".woff2": "font/woff2" };

http.createServer(async (req, res) => {
  const urlPath = decodeURIComponent(req.url.split("?")[0]);
  let filePath = urlPath === "/" ? path.join(root, "index.html") : path.join(root, urlPath);
  if (!existsSync(filePath)) filePath = path.join(root, "index.html");
  try {
    const data = await readFile(filePath);
    const ext = path.extname(filePath);
    for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
    res.setHeader("Content-Type", MIME[ext] || "application/octet-stream");
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end("not found");
  }
}).listen(4173, () => console.log("serving dist/ with vercel.json headers on http://localhost:4173"));
