import React, { useState, useRef } from "react";
import { Upload, FileUp, CheckCircle2, AlertCircle, Download } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { api } from "@/api/dataClient";
import { toast } from "sonner";

const FIELD_OPTIONS = [
  { key: "name", label: "Nome *" },
  { key: "document", label: "CPF/CNPJ" },
  { key: "phone", label: "WhatsApp" },
  { key: "email", label: "E-mail" },
  { key: "birthday", label: "Nascimento" },
  { key: "cep", label: "CEP" },
  { key: "address", label: "Logradouro" },
  { key: "address_number", label: "Número" },
  { key: "complement", label: "Complemento" },
  { key: "neighborhood", label: "Bairro" },
  { key: "city", label: "Cidade" },
  { key: "state", label: "UF" },
  { key: "credit_limit", label: "Limite de Crédito" },
  { key: "notes", label: "Observações" },
];

const parseCSV = (text) => {
  const lines = text.replace(/\r\n/g, "\n").split("\n").filter((l) => l.trim());
  if (lines.length < 2) return { headers: [], rows: [] };
  const delim = lines[0].includes(";") ? ";" : ",";
  const splitLine = (line) => {
    const result = [];
    let cur = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; }
        else inQuotes = !inQuotes;
      } else if (ch === delim && !inQuotes) {
        result.push(cur); cur = "";
      } else {
        cur += ch;
      }
    }
    result.push(cur);
    return result;
  };
  const headers = splitLine(lines[0]).map((h) => h.trim().replace(/^"|"$/g, ""));
  const rows = lines.slice(1).map((line) => {
    const cells = splitLine(line);
    const obj = {};
    headers.forEach((h, i) => { obj[h] = (cells[i] || "").trim().replace(/^"|"$/g, ""); });
    return obj;
  });
  return { headers, rows };
};

const autoMap = (header) => {
  const h = header.toLowerCase().trim();
  const map = {
    nome: "name", name: "name", "razão social": "name", cliente: "name",
    cpf: "document", cnpj: "document", "cpf/cnpj": "document", documento: "document", doc: "document",
    telefone: "phone", phone: "phone", whatsapp: "phone", celular: "phone",
    email: "email", "e-mail": "email", mail: "email",
    nascimento: "birthday", aniversario: "birthday", birthday: "birthday",
    cep: "cep",
    endereco: "address", "endereço": "address", logradouro: "address", rua: "address",
    numero: "address_number", "número": "address_number",
    complemento: "complement",
    bairro: "neighborhood",
    cidade: "city", city: "city",
    uf: "state", estado: "state",
    "limite de credito": "credit_limit", "limite de crédito": "credit_limit", "limite": "credit_limit",
    observacoes: "notes", "observações": "notes", obs: "notes",
  };
  return map[h] || "";
};

export default function ImportCustomersDialog({ open, onClose, onSaved }) {
  const [step, setStep] = useState(1);
  const [headers, setHeaders] = useState([]);
  const [rows, setRows] = useState([]);
  const [mapping, setMapping] = useState(/** @type {Record<string, any>} */ ({}));
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState(null);
  const fileRef = useRef(null);

  const reset = () => {
    setStep(1);
    setHeaders([]);
    setRows([]);
    setMapping({});
    setImporting(false);
    setProgress(0);
    setResult(null);
    if (fileRef.current) fileRef.current.value = "";
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleFile = async (file) => {
    if (!file) return;
    const ext = file.name.split(".").pop().toLowerCase();
    try {
      if (ext === "csv" || ext === "txt") {
        const text = await file.text();
        const { headers: hs, rows: rs } = parseCSV(text);
        if (rs.length === 0) { toast.error("Arquivo vazio."); return; }
        setHeaders(hs);
        setRows(rs);
        const auto = {};
        hs.forEach((h) => { auto[h] = autoMap(h); });
        setMapping(auto);
        setStep(2);
      } else {
        // Excel: extrai via api.files.extract
        toast.info("Enviando arquivo...");
        const { file_url } = await api.files.upload({ file });
        const schema = {
          type: "object",
          properties: {
            rows: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  document: { type: "string" },
                  phone: { type: "string" },
                  email: { type: "string" },
                  birthday: { type: "string" },
                  cep: { type: "string" },
                  address: { type: "string" },
                  address_number: { type: "string" },
                  complement: { type: "string" },
                  neighborhood: { type: "string" },
                  city: { type: "string" },
                  state: { type: "string" },
                  credit_limit: { type: "number" },
                  notes: { type: "string" },
                },
              },
            },
          },
        };
        const res = await api.files.extract({
          file_url,
          json_schema: schema,
        });
        if (res.status !== "success" || !res.output?.rows) {
          toast.error("Não foi possível ler o arquivo.");
          return;
        }
        const rs = res.output.rows;
        if (rs.length === 0) { toast.error("Nenhum registro encontrado."); return; }
        setHeaders(Object.keys(rs[0]));
        setRows(rs);
        const auto = {};
        Object.keys(rs[0]).forEach((h) => { auto[h] = autoMap(h); });
        setMapping(auto);
        setStep(2);
      }
    } catch (e) {
      console.error(e);
      toast.error("Erro ao processar arquivo.");
    }
  };

  const downloadTemplate = () => {
    const csv = "Nome;CPF/CNPJ;WhatsApp;E-mail;Cidade;UF\nJoão Silva;12345678901;(11) 99999-9999;joao@email.com;São Paulo;SP";
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "modelo_clientes.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const doImport = async () => {
    if (!Object.values(mapping).includes("name")) {
      toast.error("Mapeie pelo menos o campo Nome.");
      return;
    }
    setImporting(true);
    setProgress(0);

    let user;
    try { user = await api.auth.me(); } catch { user = {}; }

    const records = rows.map((row) => {
      const obj = {};
      Object.entries(mapping).forEach(([header, field]) => {
        if (field && row[header] != null && row[header] !== "") {
          let val = row[header];
          if (field === "credit_limit") val = Number(String(val).replace(/[^\d.,-]/g, "").replace(",", ".")) || 0;
          obj[field] = val;
        }
      });
      if (user?.company_id) obj.company_id = user.company_id;
      return obj;
    }).filter((r) => r.name);

    const valid = records.filter((r) => r.name);
    const invalid = records.length - valid.length;

    const BATCH = 50;
    let imported = 0;
    let errors = 0;
    for (let i = 0; i < valid.length; i += BATCH) {
      const batch = valid.slice(i, i + BATCH);
      try {
        await api.entities.Customer.bulkCreate(batch);
        imported += batch.length;
      } catch (e) {
        console.error(e);
        errors += batch.length;
      }
      setProgress(Math.round(((i + batch.length) / valid.length) * 100));
    }

    setResult({ imported, errors, invalid, total: records.length });
    setStep(3);
    setImporting(false);
    if (imported > 0) {
      toast.success(`${imported} clientes importados!`);
      onSaved?.();
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload className="w-5 h-5 text-primary" />
            Importar Clientes
          </DialogTitle>
          <DialogDescription>
            Importe clientes em lote a partir de um arquivo CSV ou Excel.
          </DialogDescription>
        </DialogHeader>

        {step === 1 && (
          <div className="space-y-4">
            <div
              onClick={() => fileRef.current?.click()}
              className="border-2 border-dashed border-border rounded-xl p-8 text-center cursor-pointer hover:border-primary hover:bg-primary/5 transition-all"
            >
              <FileUp className="w-10 h-10 mx-auto text-muted-foreground mb-2" />
              <p className="text-sm font-medium">Clique para selecionar um arquivo</p>
              <p className="text-xs text-muted-foreground mt-1">CSV ou Excel (.xlsx)</p>
              <input
                ref={fileRef}
                type="file"
                accept=".csv,.txt,.xlsx,.xls"
                className="hidden"
                onChange={(e) => handleFile(e.target.files?.[0])}
              />
            </div>
            <button
              onClick={downloadTemplate}
              className="w-full flex items-center justify-center gap-2 text-sm text-primary hover:underline"
            >
              <Download className="w-4 h-4" /> Baixar modelo CSV
            </button>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <div className="text-sm font-medium">
              Mapear colunas — {rows.length} registros encontrados
            </div>
            <ScrollArea className="h-[280px] rounded-lg border p-3">
              <div className="space-y-2">
                {headers.map((h) => (
                  <div key={h} className="flex items-center gap-2">
                    <span className="flex-1 text-sm truncate" title={h}>{h}</span>
                    <select
                      value={mapping[h] || ""}
                      onChange={(e) => setMapping({ ...mapping, [h]: e.target.value })}
                      className="flex-1 text-sm border rounded-md px-2 py-1.5 bg-background"
                    >
                      <option value="">— Ignorar —</option>
                      {FIELD_OPTIONS.map((f) => (
                        <option key={f.key} value={f.key}>{f.label}</option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            </ScrollArea>
            <div className="text-xs text-muted-foreground bg-muted/50 rounded-lg p-3">
              Certifique-se de mapear o campo <strong>Nome</strong> (obrigatório). Os demais são opcionais.
            </div>
          </div>
        )}

        {step === 3 && result && (
          <div className="space-y-4 text-center py-4">
            <CheckCircle2 className="w-14 h-14 mx-auto text-emerald-500" />
            <div className="text-lg font-semibold">Importação concluída!</div>
            <div className="grid grid-cols-3 gap-3 text-sm">
              <div className="bg-emerald-50 rounded-lg p-3">
                <div className="text-2xl font-bold text-emerald-600">{result.imported}</div>
                <div className="text-xs text-muted-foreground">Importados</div>
              </div>
              <div className="bg-destructive/10 rounded-lg p-3">
                <div className="text-2xl font-bold text-destructive">{result.errors}</div>
                <div className="text-xs text-muted-foreground">Erros</div>
              </div>
              <div className="bg-amber-50 rounded-lg p-3">
                <div className="text-2xl font-bold text-amber-600">{result.invalid}</div>
                <div className="text-xs text-muted-foreground">Sem nome</div>
              </div>
            </div>
            {result.errors > 0 && (
              <div className="flex items-start gap-2 text-xs text-muted-foreground bg-muted/50 rounded-lg p-3 text-left">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                Alguns registros não puderam ser importados. Verifique duplicidade de CPF/CNPJ ou dados inválidos.
              </div>
            )}
          </div>
        )}

        {importing && (
          <div className="space-y-2 py-4">
            <Progress value={progress} />
            <p className="text-sm text-center text-muted-foreground">Importando... {progress}%</p>
          </div>
        )}

        <DialogFooter>
          {step === 1 && (
            <Button variant="outline" onClick={handleClose}>Cancelar</Button>
          )}
          {step === 2 && (
            <>
              <Button variant="outline" onClick={reset} disabled={importing}>Voltar</Button>
              <Button onClick={doImport} disabled={importing} className="gap-2">
                <Upload className="w-4 h-4" /> Importar {rows.length} clientes
              </Button>
            </>
          )}
          {step === 3 && (
            <Button onClick={handleClose}>Concluir</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}