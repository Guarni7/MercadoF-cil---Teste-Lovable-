/**
 * Extração local de CSV/XLSX/XML (api.files.extract).
 * Suporta CSV/TXT, XLSX e XML NF-e (nfeProc / NFe).
 */
import ExcelJS from "exceljs";

function parseCsvText(text) {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  const delim = lines[0].includes(";") ? ";" : ",";
  const headers = lines[0].split(delim).map((h) => h.trim().replace(/^"|"$/g, ""));
  return lines.slice(1).map((line) => {
    const cols = line.split(delim).map((c) => c.trim().replace(/^"|"$/g, ""));
    const row = {};
    headers.forEach((h, i) => {
      row[h] = cols[i] ?? "";
    });
    return row;
  });
}

function cellText(v) {
  if (v == null) return "";
  if (typeof v === "object") {
    if (v.richText) return v.richText.map((t) => t.text).join("");
    if (v.result !== undefined) return v.result;
    if (v.text !== undefined) return v.text;
  }
  return v;
}

function sheetToRows(workbook) {
  const sheet = workbook.worksheets[0];
  if (!sheet) return [];

  const headers = [];
  sheet.getRow(1).eachCell({ includeEmpty: true }, (cell, col) => {
    headers[col] = String(cellText(cell.value) ?? "").trim();
  });

  const rows = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const obj = {};
    headers.forEach((h, col) => {
      if (!h) return;
      obj[h] = cellText(row.getCell(col).value) ?? "";
    });
    rows.push(obj);
  });
  return rows;
}

function textOf(el, ...tags) {
  for (const t of tags) {
    const n = el.getElementsByTagName(t)[0];
    if (n?.textContent) return n.textContent.trim();
  }
  return "";
}

function parseNfeXml(xmlText) {
  const doc = new DOMParser().parseFromString(xmlText, "text/xml");
  if (doc.querySelector("parsererror")) {
    throw new Error("XML inválido");
  }
  const inf = doc.getElementsByTagName("infNFe")[0] || doc.documentElement;
  const emit = inf.getElementsByTagName("emit")[0];
  const ide = inf.getElementsByTagName("ide")[0];
  const dets = Array.from(inf.getElementsByTagName("det"));
  const itens = dets.map((det) => {
    const prod = det.getElementsByTagName("prod")[0] || det;
    return {
      codigo: textOf(prod, "cProd"),
      nome: textOf(prod, "xProd"),
      ncm: textOf(prod, "NCM"),
      cfop: textOf(prod, "CFOP"),
      quantidade: Number(textOf(prod, "qCom") || 0),
      valor_unitario: Number(textOf(prod, "vUnCom") || 0),
      valor_total: Number(textOf(prod, "vProd") || 0),
    };
  });
  return {
    fornecedor: textOf(emit || inf, "xNome", "xFant"),
    numero: textOf(ide || inf, "nNF"),
    chave: (inf.getAttribute?.("Id") || "").replace(/^NFe/, ""),
    data_emissao: textOf(ide || inf, "dhEmi", "dEmi"),
    itens,
  };
}

function shapeRowsToSchema(rows, json_schema) {
  const props = json_schema?.properties || {};
  if (props.rows?.type === "array") {
    return { rows };
  }
  // schema plano (NF-e): se já veio objeto tipado, devolve; senão tenta mapear 1ª linha
  if (props.itens || props.fornecedor) {
    return rows;
  }
  return { rows };
}

/**
 * @param {{ file_url: string, json_schema?: object }} opts
 * @returns {Promise<{ status: string, output?: object, details?: string }>}
 */
export async function extractDataFromUploadedFile({ file_url, json_schema }) {
  if (!file_url) {
    return { status: "error", details: "file_url ausente" };
  }

  const res = await fetch(file_url);
  if (!res.ok) {
    return { status: "error", details: `Falha ao baixar arquivo (${res.status})` };
  }

  const urlPath = new URL(file_url, window.location.origin).pathname.toLowerCase();
  const ct = (res.headers.get("content-type") || "").toLowerCase();

  try {
    // application/vnd.openxmlformats-officedocument... (xlsx) contém "xml" como
    // substring ("open-xml-formats") — checar planilha antes do XML solto, senão
    // todo upload de .xlsx real cai aqui e vira "XML inválido".
    if (
      urlPath.endsWith(".xlsx") ||
      urlPath.endsWith(".xls") ||
      ct.includes("spreadsheet") ||
      ct.includes("excel")
    ) {
      const buf = await res.arrayBuffer();
      const wb = new ExcelJS.Workbook();
      try {
        await wb.xlsx.load(buf);
      } catch {
        // exceljs só lê o formato .xlsx (OOXML). .xls binário legado (pré-2007)
        // usa o mesmo parser SheetJS vulnerável (prototype pollution/ReDoS) que
        // motivou trocar a lib — sem fallback para ele aqui.
        return {
          status: "error",
          details: "Arquivo .xls (formato antigo) não suportado. Salve como .xlsx e envie novamente.",
        };
      }
      const rows = sheetToRows(wb);
      return { status: "success", output: shapeRowsToSchema(rows, json_schema) };
    }

    // CSV / TXT / default
    const text = await res.text();
    if (text.trim().startsWith("<")) {
      const output = parseNfeXml(text);
      return { status: "success", output };
    }
    const rows = parseCsvText(text);
    return { status: "success", output: shapeRowsToSchema(rows, json_schema) };
  } catch (e) {
    return { status: "error", details: e?.message || String(e) };
  }
}
