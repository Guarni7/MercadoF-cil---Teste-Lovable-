import { formatBRL } from "@/lib/format";
import { saleNumberFull } from "@/lib/saleNumber";
import { electronWindow } from "@/lib/electronWindow";
import { dinheiroRecebidoDaVenda } from "@/lib/troco";

export const PAYMENT_LABELS = {
  dinheiro: "Dinheiro",
  pix: "PIX",
  credito: "Crédito",
  debito: "Débito",
  valepresente: "Vale Presente",
  crediario: "Crédito Loja",
};

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** 500,00 (sem R$) */
function formatMoney(value) {
  const n = Number(value) || 0;
  return n.toFixed(2).replace(".", ",");
}

function onlyDigits(str) {
  return String(str || "").replace(/\D/g, "");
}

export function getPrinterConfig() {
  try {
    return JSON.parse(localStorage.getItem("printer_config") || "{}");
  } catch {
    return {};
  }
}

export function getCompanyForReceipt() {
  try {
    const company = JSON.parse(localStorage.getItem("company_data") || "{}");
    const fiscal = JSON.parse(localStorage.getItem("fiscal_config") || "{}");
    const name =
      company.trade_name ||
      company.name ||
      company.legal_name ||
      company.razao ||
      fiscal.name ||
      "MercadoFácil PDV";
    const document = company.cnpj || company.document || fiscal.cnpj || "";
    const city = company.city || company.cidade || fiscal.city || "";
    const uf = (company.uf || company.state || fiscal.uf || "").toUpperCase();
    return {
      name,
      document,
      address: company.address || fiscal.address || "",
      city,
      uf,
      phone: company.phone || "",
    };
  } catch {
    return { name: "MercadoFácil PDV", document: "", address: "", city: "", uf: "", phone: "" };
  }
}

export function isAutoPrintEnabled() {
  try {
    const extras = JSON.parse(localStorage.getItem("sales_extras_config") || "{}");
    return !!extras.auto_print;
  } catch {
    return false;
  }
}

/**
 * Cupom estilo PDV clássico (igual ao modelo JULIA M S ALVES).
 * @param {{ sale?: object, customer?: object, company?: object, autoPrint?: boolean, forBrowserDialog?: boolean }} opts
 * forBrowserDialog: no Chrome, não força @page 80mm (senão a prévia fica minúscula em impressora A4).
 */
export function generateSaleReceiptHtml({
  sale,
  customer,
  company,
  autoPrint = false,
  forBrowserDialog = false,
} = {}) {
  const cfg = getPrinterConfig();
  const paperKey = cfg.paper || "80mm";
  const isA4 = paperKey === "A4";
  const is58 = paperKey === "58mm";
  const ticketMm = isA4 ? 90 : is58 ? 58 : 80;
  const cols = is58 ? 32 : isA4 ? 48 : 42;
  const lineEq = "=".repeat(cols);
  const lineDash = "-".repeat(cols);
  // Diálogo do browser + papel térmico: usa o papel da impressora (A4 etc.), cupom centralizado
  const usePrinterPaper = forBrowserDialog || isA4;
  const baseFont = isA4 ? "12pt" : is58 ? "9.5pt" : "10.5pt";
  const tableFont = isA4 ? "11pt" : is58 ? "8pt" : "9pt";
  const pageCss = usePrinterPaper
    ? `@page { size: ${isA4 ? "A4 portrait" : "auto"}; margin: ${isA4 ? "12mm" : "8mm"}; }`
    : `@page { size: ${ticketMm}mm auto; margin: 0; }`;

  const co = company || getCompanyForReceipt();
  const items = sale?.items || [];
  const qtyTotal = items.reduce((s, it) => s + (Number(it.quantity) || 0), 0);
  const total = Number(sale?.total) || 0;
  const discount = Number(sale?.discount) || 0;
  const subtotal = Number(sale?.subtotal ?? total + discount) || total;

  const cityLine = [co.city, co.uf].filter(Boolean).join("/").toUpperCase();
  const cnpj = onlyDigits(co.document);
  const when = new Date().toLocaleString("pt-BR");
  const payment =
    PAYMENT_LABELS[sale?.payment_method] ||
    String(sale?.payment_method || "Dinheiro");
  const troco = Number(sale?.change) || 0;
  const dinheiroRecebido = dinheiroRecebidoDaVenda(sale);
  const consumer = customer?.name
    ? String(customer.name).toUpperCase()
    : "CONSUMIDOR NAO IDENTIFICADO";

  const itemsHtml = items
    .map((item, idx) => {
      const cod = String(idx + 1);
      const name = String(item.name || "ITEM").toUpperCase();
      const qty = Number(item.quantity) || 0;
      const unit = String(item.unit || "UN").toUpperCase();
      const vunit = formatMoney(item.price ?? (qty ? (item.total || 0) / qty : 0));
      const vtot = formatMoney(item.total ?? (item.price || 0) * qty);
      return `<tr>
        <td class="c-cod">${escapeHtml(cod)}</td>
        <td class="c-desc">${escapeHtml(name)}</td>
        <td class="c-num">${qty}</td>
        <td class="c-un">${escapeHtml(unit)}</td>
        <td class="c-num">${vunit}</td>
        <td class="c-num">${vtot}</td>
      </tr>`;
    })
    .join("");

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<title>Venda ${escapeHtml(saleNumberFull(sale))}</title>
<style>
  ${pageCss}
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body {
    background: #fff;
    color: #000;
    font-family: "Courier New", Courier, monospace;
    font-size: ${baseFont};
    line-height: 1.3;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  ${usePrinterPaper ? "" : `html, body { width: ${ticketMm}mm; }`}
  .ticket {
    width: ${ticketMm}mm;
    max-width: 100%;
    margin: 0 auto;
    padding: 2mm 3mm 5mm;
  }
  .center { text-align: center; }
  .bold { font-weight: 700; }
  .sep { white-space: pre; overflow: hidden; letter-spacing: -0.5px; }
  .row {
    display: flex;
    justify-content: space-between;
    gap: 2mm;
    white-space: nowrap;
  }
  .row .l { overflow: hidden; text-overflow: ellipsis; }
  .row .r { flex-shrink: 0; }
  table.items {
    width: 100%;
    border-collapse: collapse;
    table-layout: fixed;
    margin: 1mm 0;
  }
  table.items th, table.items td {
    font-size: ${tableFont};
    padding: 0.5mm 0.4mm;
    vertical-align: top;
    word-break: break-word;
  }
  table.items th { font-weight: 700; text-align: left; }
  .c-cod { width: 8%; }
  .c-desc { width: 34%; }
  .c-num { width: 14%; text-align: right; }
  .c-un { width: 10%; text-align: center; }
  .pay-title { text-align: center; margin: 1.5mm 0 1mm; font-weight: 700; }

  @media screen {
    body {
      min-height: 100vh;
      width: 100%;
      background: #d1d5db;
      display: flex;
      justify-content: center;
      padding: 24px;
    }
    .ticket {
      background: #fff;
      box-shadow: 0 6px 20px rgba(0,0,0,.2);
      width: min(420px, 92vw);
      font-size: 15px;
    }
    table.items th, table.items td { font-size: 13px; }
  }

  @media print {
    html, body {
      width: auto !important;
      background: #fff !important;
    }
    .ticket {
      width: ${ticketMm}mm !important;
      max-width: ${ticketMm}mm !important;
      margin: 0 auto !important;
      box-shadow: none !important;
      background: #fff !important;
    }
  }
</style>
</head>
<body>
  <div class="ticket">
    <div class="center bold">${escapeHtml(String(co.name || "").toUpperCase())}</div>
    ${cnpj ? `<div class="center">CNPJ: ${escapeHtml(cnpj)}</div>` : ""}
    ${cityLine ? `<div class="center">${escapeHtml(cityLine)}</div>` : ""}
    ${co.address ? `<div class="center" style="font-size:90%">${escapeHtml(co.address)}</div>` : ""}

    <div class="sep center">${lineEq}</div>
    <div class="center">${escapeHtml(when)}</div>
    <div class="center bold">Venda ${escapeHtml(saleNumberFull(sale))}</div>
    <div class="sep center">${lineEq}</div>

    <table class="items">
      <thead>
        <tr>
          <th class="c-cod">COD</th>
          <th class="c-desc">DESCRICAO</th>
          <th class="c-num">QTD</th>
          <th class="c-un">UN</th>
          <th class="c-num">VUNIT</th>
          <th class="c-num">VTOT</th>
        </tr>
      </thead>
      <tbody>
        ${itemsHtml}
      </tbody>
    </table>

    <div class="sep center">${lineDash}</div>
    <div class="row"><span class="l">QTD TOTAL DE ITENS</span><span class="r">${qtyTotal}</span></div>
    <div class="row"><span class="l">VALOR TOTAL R$</span><span class="r">${formatMoney(subtotal)}</span></div>
    ${discount > 0 ? `<div class="row"><span class="l">DESCONTO R$</span><span class="r">${formatMoney(discount)}</span></div>` : ""}
    <div class="row bold"><span class="l">VALOR A PAGAR R$</span><span class="r">${formatMoney(total)}</span></div>

    <div class="sep center">${lineDash}</div>
    <div class="pay-title">FORMA DE PAGAMENTO</div>
    <div class="row"><span class="l">${escapeHtml(payment)}</span><span class="r">${formatBRL(total)}</span></div>
    ${troco > 0 && dinheiroRecebido != null ? `<div class="row"><span class="l">Dinheiro recebido</span><span class="r">${formatBRL(dinheiroRecebido)}</span></div>` : ""}
    ${troco > 0 ? `<div class="row"><span class="l">Troco</span><span class="r">${formatBRL(troco)}</span></div>` : ""}

    <div class="sep center">${lineDash}</div>
    <div class="center">${escapeHtml(consumer)}</div>
    <div class="sep center">${lineEq}</div>
    <div class="center bold">OBRIGADO PELA PREFERENCIA!</div>
  </div>
  ${
    autoPrint
      ? `<script>
    window.onload = function () {
      setTimeout(function () {
        window.focus();
        window.print();
      }, 300);
    };
  </script>`
      : ""
  }
</body>
</html>`;
}

/**
 * Imprime o cupom.
 * - App Electron: silencioso.
 * - Chrome/Edge com atalho --kiosk-printing: silencioso no navegador.
 * - Navegador normal: abre o diálogo do Windows (limitação do browser).
 */
/** @param {{ sale?: Record<string, any>, customer?: Record<string, any> }} [opts] */
export async function printSaleReceipt({ sale, customer } = {}) {
  if (!sale) return { ok: false, reason: "no-sale" };
  const cfg = getPrinterConfig();
  const htmlElectron = generateSaleReceiptHtml({ sale, customer, autoPrint: false });
  const win = electronWindow();

  if (typeof window !== "undefined" && win.electronAPI?.printHtml) {
    try {
      const result = await win.electronAPI.printHtml({
        html: htmlElectron,
        silent: true,
        deviceName: cfg.deviceName || undefined,
      });
      return { ok: !!result?.ok, reason: result?.ok ? "electron" : "electron-fail", error: result?.error };
    } catch (e) {
      return { ok: false, reason: "electron-fail", error: e?.message };
    }
  }

  try {
    // Popup + autoPrint: no Chrome normal abre a tela da impressora de forma confiável
    const win = window.open("", "_blank", "width=480,height=780");
    if (win) {
      win.document.open();
      win.document.write(
        generateSaleReceiptHtml({ sale, customer, autoPrint: true, forBrowserDialog: true })
      );
      win.document.close();
      return { ok: true, reason: "browser" };
    }
    // Popup bloqueado → iframe
    const htmlBrowser = generateSaleReceiptHtml({
      sale,
      customer,
      autoPrint: false,
      forBrowserDialog: true,
    });
    printHtmlViaHiddenFrame(htmlBrowser);
    return { ok: true, reason: "browser-iframe" };
  } catch (e) {
    return { ok: false, reason: "browser-fail", error: e?.message };
  }
}

/** Impressão via iframe oculto (com --kiosk-printing no Chrome/Edge sai direto). */
function printHtmlViaHiddenFrame(html) {
  const iframe = document.createElement("iframe");
  iframe.setAttribute("title", "cupom");
  iframe.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0;pointer-events:none";
  document.body.appendChild(iframe);
  const doc = iframe.contentDocument || iframe.contentWindow?.document;
  if (!doc) {
    document.body.removeChild(iframe);
    throw new Error("Não foi possível criar frame de impressão");
  }
  doc.open();
  doc.write(html);
  doc.close();

  const doPrint = () => {
    try {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
    } finally {
      setTimeout(() => {
        try {
          document.body.removeChild(iframe);
        } catch {}
      }, 1500);
    }
  };

  // Aguarda layout/fonts
  setTimeout(doPrint, 400);
}

export function isElectronApp() {
  return typeof window !== "undefined" && !!electronWindow().electronAPI?.isElectron;
}

/** Baixa um .bat que abre Chrome/Edge com impressão direta (kiosk-printing). */
export function downloadBrowserPrintShortcut(browser = "chrome") {
  const appUrl =
    (typeof import.meta !== "undefined" && import.meta.env?.VITE_APP_URL
      ? String(import.meta.env.VITE_APP_URL).replace(/\/$/, "")
      : typeof window !== "undefined"
        ? window.location.origin
        : "") + "/pdv";
  const isEdge = browser === "edge";
  const name = isEdge
    ? "MercadoFacil-Edge-ImpressaoDireta.bat"
    : "MercadoFacil-Chrome-ImpressaoDireta.bat";

  const content = isEdge
    ? `@echo off
chcp 65001 >nul
title MercadoFacil PDV - Edge (impressao direta)
echo Abrindo Edge com impressao direta (sem tela de impressora)...
echo Deixe a impressora termica como PADRAO do Windows.
echo.
set EDGE=
if exist "%ProgramFiles(x86)%\\Microsoft\\Edge\\Application\\msedge.exe" set "EDGE=%ProgramFiles(x86)%\\Microsoft\\Edge\\Application\\msedge.exe"
if exist "%ProgramFiles%\\Microsoft\\Edge\\Application\\msedge.exe" set "EDGE=%ProgramFiles%\\Microsoft\\Edge\\Application\\msedge.exe"
if "%EDGE%"=="" (
  echo Edge nao encontrado.
  pause
  exit /b 1
)
start "" "%EDGE%" --kiosk-printing --app=${appUrl}
`
    : `@echo off
chcp 65001 >nul
title MercadoFacil PDV - Chrome (impressao direta)
echo Abrindo Chrome com impressao direta (sem tela de impressora)...
echo Deixe a impressora termica como PADRAO do Windows.
echo.
set CHROME=
if exist "%ProgramFiles%\\Google\\Chrome\\Application\\chrome.exe" set "CHROME=%ProgramFiles%\\Google\\Chrome\\Application\\chrome.exe"
if exist "%ProgramFiles(x86)%\\Google\\Chrome\\Application\\chrome.exe" set "CHROME=%ProgramFiles(x86)%\\Google\\Chrome\\Application\\chrome.exe"
if exist "%LocalAppData%\\Google\\Chrome\\Application\\chrome.exe" set "CHROME=%LocalAppData%\\Google\\Chrome\\Application\\chrome.exe"
if "%CHROME%"=="" (
  echo Chrome nao encontrado.
  pause
  exit /b 1
)
start "" "%CHROME%" --kiosk-printing --app=${appUrl}
`;

  const blob = new Blob([content], { type: "application/x-bat" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
