/**
 * Prova, no Electron de verdade e em PERFIL ISOLADO (MF_ELECTRON_TEST=1, rede bloqueada por proxy morto,
 * sem login, sem Supabase), o fluxo de fechar a janela com backup:
 *   fechar → diálogo → Cancelar (app segue) → fechar → "Fazer backup e fechar" → backup gravado → app sai.
 * Também confere que o perfil real do usuário não mudou (só caminho/tamanho/mtime).
 *
 * Uso: node scripts/verify-electron-fechamento.mjs   (precisa de dist/: npm run build; só Windows)
 */
import { spawn, spawnSync, execSync } from "child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "fs";
import { homedir, tmpdir } from "os";
import { join, relative, resolve } from "path";

const falhas = [];
const ok = [];
const check = (cond, msg) => (cond ? ok.push(msg) : falhas.push(msg));
const raiz = resolve(".");
const real = join(process.env.APPDATA || join(homedir(), "AppData", "Roaming"), "MercadoFacilPDV");
const snap = (dir) => {
  const o = {};
  const v = (d) => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      const s = statSync(p);
      if (s.isDirectory()) v(p);
      else o[relative(dir, p)] = `${s.size}:${s.mtimeMs}`;
    }
  };
  if (existsSync(dir)) v(dir);
  return o;
};
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

if (process.platform !== "win32" || !existsSync(join(raiz, "dist", "index.html"))) {
  console.log("Pulado: precisa de Windows e de dist/ (npm run build).");
  process.exit(0);
}

const antes = snap(real);
const dirsAntes = new Set(readdirSync(tmpdir()).filter((n) => n.startsWith("mf-electron-test-")));
const boot = mkdtempSync(join(tmpdir(), "mf-electron-test-boot-"));
const filho = spawn(join(raiz, "node_modules", "electron", "dist", "electron.exe"), [".", `--user-data-dir=${boot}`, "--remote-debugging-port=9398", "--proxy-server=127.0.0.1:9"], {
  cwd: raiz,
  stdio: "ignore",
  env: { ...process.env, MF_ELECTRON_TEST: "1", MF_URL: "", MF_UPDATE_URL: "", MF_SELFTEST: "" },
});
let saiu = null;
filho.on("exit", (c) => (saiu = c));
let backupsDoTeste = [];
try {
  let pg;
  for (let i = 0; i < 40 && !pg; i++) {
    await espera(1000);
    try {
      pg = (await (await fetch("http://127.0.0.1:9398/json/list")).json()).find((p) => p.type === "page");
    } catch {
      /* subindo */
    }
  }
  const ws = new WebSocket(pg.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let seq = 0;
  const pend = new Map();
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pend.has(d.id)) {
      pend.get(d.id)(d);
      pend.delete(d.id);
    }
  };
  const cdp = (method, params = {}) => new Promise((r) => { const id = ++seq; pend.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
  const ev = async (e) => {
    const r = await Promise.race([cdp("Runtime.evaluate", { expression: e, awaitPromise: true, returnByValue: true }), espera(8000).then(() => ({ result: { result: { value: "SEM RESPOSTA" } } }))]);
    return r.result?.result?.value;
  };
  await cdp("Runtime.enable");
  await espera(8000);
  const fechaJanela = () => spawnSync("powershell", ["-NoProfile", "-c", `(Get-Process -Id ${filho.pid}).CloseMainWindow()`], { encoding: "utf8" }).stdout.trim();
  const botoes = () => ev("[...document.querySelectorAll('[role=dialog] button')].map(b=>b.innerText.trim()).filter(Boolean).join(' | ')");
  const titulo = () => ev("document.querySelector('[role=dialog] h2')?.innerText || ''");
  const clica = (rot) => ev(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.innerText.trim().includes(${JSON.stringify(rot)}));if(!b)return 'SEM BOTAO';b.click();return 'clicou'})()`);

  check((await ev("typeof window.electronAPI?.closeFlow?.onRequest")) === "function", "o preload expõe closeFlow");
  fechaJanela();
  await espera(2500);
  check(saiu === null && /Fazer backup antes de fechar\?/.test(await titulo()), "fechar a janela NÃO fecha: abre o diálogo de backup");
  const b1 = await botoes();
  check(/Cancelar/.test(b1) && /Fechar sem backup/.test(b1) && /Fazer backup e fechar/.test(b1), `o diálogo oferece as 3 opções (${b1})`);
  check((await clica("Cancelar")) === "clicou", "clicar Cancelar");
  await espera(1500);
  check(saiu === null && (await titulo()) === "", "Cancelar: o diálogo some e o app continua aberto");
  fechaJanela();
  await espera(2500);
  check(/Fazer backup antes de fechar\?/.test(await titulo()), "fechar de novo pergunta de novo");
  check((await clica("Fazer backup e fechar")) === "clicou", "clicar 'Fazer backup e fechar'");
  for (let i = 0; i < 24 && saiu === null; i++) await espera(500);
  check(saiu === 0, `depois do backup o app fecha (exit ${saiu})`);
  ws.close();
} catch (e) {
  falhas.push(`erro no teste: ${e.message}`);
} finally {
  try {
    execSync(`taskkill /PID ${filho.pid} /T /F`, { stdio: "ignore" });
  } catch {
    /* já saiu */
  }
}
await espera(1500);
for (const n of readdirSync(tmpdir()).filter((n) => n.startsWith("mf-electron-test-") && !n.includes("boot") && !dirsAntes.has(n))) {
  const b = join(tmpdir(), n, "backups");
  if (existsSync(b)) backupsDoTeste = readdirSync(b).map((f) => JSON.parse(readFileSync(join(b, f), "utf8")));
  try {
    rmSync(join(tmpdir(), n), { recursive: true, force: true });
  } catch {
    /* ainda liberando o arquivo */
  }
}
try {
  rmSync(boot, { recursive: true, force: true });
} catch {
  /* idem */
}
check(backupsDoTeste.length === 1 && Object.keys(backupsDoTeste[0].tables).join(",") === "products,categories,customers,sales,stock_movements,cash_registers", "um backup foi gravado no perfil de TESTE, com as 6 tabelas do mecanismo existente");
const depois = snap(real);
const mudou = [...new Set([...Object.keys(antes), ...Object.keys(depois)])].filter((k) => antes[k] !== depois[k]);
check(mudou.length === 0, `perfil real idêntico antes e depois (${Object.keys(antes).length} arquivos)`);

console.log("\nFechar com backup no Electron (perfil isolado)\n");
for (const m of ok) console.log(`  PASS  ${m}`);
for (const m of falhas) console.log(`  FAIL  ${m}`);
console.log(`\n${ok.length} passaram, ${falhas.length} falharam\n`);
process.exit(falhas.length ? 1 : 0);
