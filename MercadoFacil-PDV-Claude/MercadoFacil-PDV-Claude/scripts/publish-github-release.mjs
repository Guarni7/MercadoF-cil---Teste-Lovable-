/**
 * Publica o instalador do PDV como release no GitHub (feed do auto-update).
 * O binário tem ~99 MB: não cabe no Git nem no Storage do Supabase no plano
 * atual, e o GitHub Releases guarda o arquivo fora da árvore do repositório.
 *
 * O destino é o repositório **público** de instaladores — o código-fonte segue
 * no repositório privado. Release privado não serve: o lojista precisaria estar
 * logado para baixar e o auto-update falharia.
 *
 * Token: variável GH_TOKEN_TMP / GITHUB_TOKEN, ou o credential manager do git.
 * Uso: node scripts/publish-github-release.mjs --dir=<pasta com os artefatos>
 *      [--tag=v1.3.0] [--dry-run]
 */
import { readFileSync, existsSync, statSync } from "fs";
import { join, basename } from "path";
import { execFileSync } from "child_process";
import { Agent, fetch as undiciFetch } from "undici";

// O .exe tem ~99 MB: o undici corta a espera pelos headers de resposta em 5 min
// por padrão, e o GitHub só responde depois que o corpo inteiro sobe.
const uploadAgent = new Agent({
  headersTimeout: 30 * 60 * 1000,
  bodyTimeout: 30 * 60 * 1000,
  connectTimeout: 60 * 1000,
});

const OWNER = "Guarni7";
const REPO = "MercadoFacil-PDV-releases";

function arg(name) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}
const dryRun = process.argv.includes("--dry-run");

function resolveToken() {
  if (process.env.GH_TOKEN_TMP) return process.env.GH_TOKEN_TMP;
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  const out = execFileSync("git", ["credential", "fill"], {
    input: "protocol=https\nhost=github.com\n\n",
    encoding: "utf8",
  });
  const m = out.match(/^password=(.*)$/m);
  if (!m) throw new Error("nenhum token do GitHub disponível");
  return m[1].trim();
}

const token = resolveToken();
const version = arg("version") || JSON.parse(readFileSync("package.json", "utf8")).version;
const tag = arg("tag") || `v${version}`;
const dir = arg("dir");
if (!dir || !existsSync(dir)) {
  console.error(JSON.stringify({ ok: false, error: "informe --dir=<pasta dos artefatos>" }));
  process.exit(1);
}

const assets = [
  `MercadoFacilPDV-Setup-${version}.exe`,
  `MercadoFacilPDV-Setup-${version}.exe.blockmap`,
  "latest.yml",
].map((name) => ({ name, path: join(dir, name) }));

for (const a of assets) {
  if (!existsSync(a.path)) {
    console.error(JSON.stringify({ ok: false, error: `artefato ausente: ${a.name}` }));
    process.exit(1);
  }
}

const api = async (path, init = {}) => {
  const res = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/vnd.github+json",
      "user-agent": "mercadofacil-release",
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: res.status, ok: res.ok, body };
};

const repo = await api(`/repos/${OWNER}/${REPO}`);
if (!repo.ok) {
  console.error(
    JSON.stringify({ ok: false, step: "repo", status: repo.status, error: repo.body?.message })
  );
  process.exit(1);
}

if (dryRun) {
  console.log(
    JSON.stringify(
      {
        ok: true,
        dry_run: true,
        repo: repo.body.full_name,
        permissions: repo.body.permissions,
        tag,
        assets: assets.map((a) => ({
          name: a.name,
          mb: +(statSync(a.path).size / 1024 / 1024).toFixed(1),
        })),
      },
      null,
      2
    )
  );
  process.exit(0);
}

// Release por tag (reaproveita se já existir).
let release = await api(`/repos/${OWNER}/${REPO}/releases/tags/${tag}`);
if (release.status === 404) {
  release = await api(`/repos/${OWNER}/${REPO}/releases`, {
    method: "POST",
    body: JSON.stringify({
      tag_name: tag,
      name: `MercadoFácil PDV ${version}`,
      body: [
        `Instalador Windows do MercadoFácil PDV ${version}.`,
        "",
        "O app roda offline (vendas ficam no caixa e sincronizam sozinhas) e se",
        "atualiza em segundo plano a partir deste feed.",
      ].join("\n"),
      draft: false,
      prerelease: false,
    }),
  });
}
if (!release.ok) {
  console.error(
    JSON.stringify({ ok: false, step: "release", status: release.status, error: release.body })
  );
  process.exit(1);
}

const uploaded = [];
for (const asset of assets) {
  // Substitui o asset se já houver um com o mesmo nome.
  const existing = (release.body.assets || []).find((a) => a.name === asset.name);
  if (existing) {
    await api(`/repos/${OWNER}/${REPO}/releases/assets/${existing.id}`, { method: "DELETE" });
  }
  const data = readFileSync(asset.path);
  console.error(`enviando ${asset.name} (${(data.length / 1024 / 1024).toFixed(1)} MB)…`);
  let res;
  let body;
  for (let tentativa = 1; tentativa <= 3; tentativa++) {
    res = await undiciFetch(
      `https://uploads.github.com/repos/${OWNER}/${REPO}/releases/${release.body.id}/assets?name=${encodeURIComponent(asset.name)}`,
      {
        method: "POST",
        dispatcher: uploadAgent,
        headers: {
          authorization: `Bearer ${token}`,
          accept: "application/vnd.github+json",
          "content-type": "application/octet-stream",
          "content-length": String(data.length),
          "user-agent": "mercadofacil-release",
        },
        body: data,
      }
    );
    body = await res.json().catch(() => null);
    if (res.ok) break;
    // 5xx do uploads.github.com costuma ser transitório; limpa o asset
    // parcial (se chegou a ser criado) e tenta de novo.
    if (res.status >= 500 && tentativa < 3) {
      console.error(`tentativa ${tentativa} falhou (${res.status}); repetindo…`);
      const atualizado = await api(`/repos/${OWNER}/${REPO}/releases/${release.body.id}`);
      const parcial = (atualizado.body?.assets || []).find((a) => a.name === asset.name);
      if (parcial) {
        await api(`/repos/${OWNER}/${REPO}/releases/assets/${parcial.id}`, { method: "DELETE" });
      }
      continue;
    }
    console.error(
      JSON.stringify({ ok: false, step: "upload", asset: asset.name, status: res.status, body })
    );
    process.exit(1);
  }
  uploaded.push({ name: asset.name, url: body.browser_download_url, mb: +(data.length / 1024 / 1024).toFixed(1) });
}

console.log(
  JSON.stringify(
    {
      ok: true,
      tag,
      release_url: release.body.html_url,
      download_base: `https://github.com/${OWNER}/${REPO}/releases/download/${tag}/`,
      uploaded,
    },
    null,
    2
  )
);
