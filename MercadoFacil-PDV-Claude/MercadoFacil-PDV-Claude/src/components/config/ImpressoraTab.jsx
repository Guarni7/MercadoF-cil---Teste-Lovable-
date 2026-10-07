import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import BackButton from "./BackButton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Printer, Download } from "lucide-react";
import { downloadBrowserPrintShortcut } from "@/lib/saleReceipt";
import { electronWindow } from "@/lib/electronWindow";

const CONNECTIONS = [
  "Impressora do Sistema",
  "RAW / TCP (9100)",
  "Bematech MP-4200",
  "Epson TM-T20",
  "Daruma DR700",
  "Elgin i9",
];

const PAPER_SIZES = ["58mm", "80mm", "A4"];

const FONTS = [
  "7 (64 col)",
  "6 (56 col)",
  "8 (80 col)",
  "12 (96 col)",
];

function isElectron() {
  return typeof window !== "undefined" && !!electronWindow().electronAPI?.isElectron;
}

export default function ImpressoraTab({ onBack }) {
  const [config, setConfig] = useState({
    connection: "Impressora do Sistema",
    paper: "80mm",
    font: "7 (64 col)",
    bematech_compat: false,
    deviceName: "",
  });
  const [printers, setPrinters] = useState([]);
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("printer_config");
      if (saved) setConfig((prev) => ({ ...prev, ...JSON.parse(saved) }));
    } catch {}
    setLoading(false);

    if (isElectron() && electronWindow().electronAPI?.listPrinters) {
      electronWindow().electronAPI.listPrinters().then((list) => {
        setPrinters(Array.isArray(list) ? list : []);
      }).catch(() => setPrinters([]));
    }
  }, []);

  const handleChange = (field, value) => {
    setConfig((prev) => {
      const next = { ...prev, [field]: value };
      localStorage.setItem("printer_config", JSON.stringify(next));
      return next;
    });
  };

  const handleTest = async () => {
    setTesting(true);
    try {
      if (isElectron() && electronWindow().electronAPI?.printHtml) {
        const html = `<!DOCTYPE html><html><body style="font-family:monospace;padding:12px">
          <div style="text-align:center;font-weight:bold">TESTE DE IMPRESSAO</div>
          <div style="text-align:center">MercadoFacil PDV</div>
          <div style="text-align:center">${new Date().toLocaleString("pt-BR")}</div>
          <hr/>
          <div>Impressora OK — impressao direta</div>
        </body></html>`;
        const result = await electronWindow().electronAPI.printHtml({
          html,
          silent: true,
          deviceName: config.deviceName || undefined,
        });
        if (result?.ok) toast.success("Impressão enviada direto (sem diálogo).");
        else toast.error(result?.error || "Falha na impressão silenciosa.");
      } else {
        toast.message("No Chrome/Edge normal aparece a tela de impressora.", {
          description: "Baixe o atalho em Configurações → Impressora (Chrome ou Edge) para imprimir direto.",
        });
        window.print();
      }
    } catch {
      toast.error("Falha ao testar impressão.");
    } finally {
      setTesting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="w-8 h-8 border-4 border-muted border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <BackButton onBack={onBack} />

      <div className="flex items-center gap-2">
        <Printer className="w-5 h-5 text-slate-700" />
        <h2 className="text-lg font-semibold text-slate-800">Impressora</h2>
      </div>

      <div className="flex items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-4">
        <div className="w-10 h-10 rounded-lg bg-emerald-100 flex items-center justify-center shrink-0">
          <Printer className="w-5 h-5 text-emerald-700" />
        </div>
        <div>
          <div className="font-semibold text-slate-800">
            {config.deviceName || config.connection} (SO)
          </div>
          <div className="text-sm text-slate-500">
            {config.paper} · Fonte {config.font}
            {isElectron() ? " · Impressão direta" : " · Navegador (com diálogo)"}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div>
          <Label className="mb-1.5 block">Conexão</Label>
          <Select value={config.connection} onValueChange={(v) => handleChange("connection", v)}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CONNECTIONS.map((c) => (
                <SelectItem key={c} value={c}>{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="mb-1.5 block">Papel</Label>
          <Select value={config.paper} onValueChange={(v) => handleChange("paper", v)}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PAPER_SIZES.map((p) => (
                <SelectItem key={p} value={p}>{p}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="mt-1.5 text-xs text-slate-500">
            Epson/HP A4 (ex.: L3250): escolha A4. Bobina térmica: 58mm ou 80mm.
          </p>
        </div>
        <div>
          <Label className="mb-1.5 block">Fonte</Label>
          <Select value={config.font} onValueChange={(v) => handleChange("font", v)}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FONTS.map((f) => (
                <SelectItem key={f} value={f}>{f}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {isElectron() && (
        <div>
          <Label className="mb-1.5 block">Impressora do cupom (direto)</Label>
          <Select
            value={config.deviceName || "__default__"}
            onValueChange={(v) => handleChange("deviceName", v === "__default__" ? "" : v)}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Padrão do Windows" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__default__">Padrão do Windows</SelectItem>
              {printers.map((p) => (
                <SelectItem key={p.name} value={p.name}>
                  {p.displayName || p.name}{p.isDefault ? " (padrão)" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground mt-1.5">
            No app desktop o cupom sai direto, sem tela de escolher impressora.
            Defina a térmica como padrão do Windows ou selecione acima.
          </p>
        </div>
      )}

      {!isElectron() && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 space-y-3">
          <p className="text-sm text-emerald-950 font-medium">
            Impressão direta no Chrome / Edge (sem tela de impressora)
          </p>
          <p className="text-sm text-emerald-900/80">
            O navegador normal sempre pede a impressora. Para sair direto, use o atalho abaixo
            (abre com <code className="text-xs bg-white/70 px-1 rounded">--kiosk-printing</code>).
            Defina a térmica como <strong>impressora padrão</strong> do Windows antes.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              className="gap-2 bg-white"
              onClick={() => {
                downloadBrowserPrintShortcut("chrome");
                toast.success("Atalho Chrome baixado — execute o arquivo .bat");
              }}
            >
              <Download className="w-4 h-4" /> Chrome
            </Button>
            <Button
              type="button"
              variant="outline"
              className="gap-2 bg-white"
              onClick={() => {
                downloadBrowserPrintShortcut("edge");
                toast.success("Atalho Edge baixado — execute o arquivo .bat");
              }}
            >
              <Download className="w-4 h-4" /> Edge
            </Button>
          </div>
          <p className="text-xs text-emerald-900/70">
            Firefox: em <code className="bg-white/70 px-1 rounded">about:config</code> defina
            {" "}
            <code className="bg-white/70 px-1 rounded">print.always_print_silent</code> = true
            (só neste PC de caixa).
          </p>
        </div>
      )}

      <Button variant="outline" onClick={handleTest} disabled={testing} className="gap-2">
        <Printer className="w-4 h-4" />
        Testar Impressão
      </Button>

      <div className="flex items-start justify-between gap-4 pt-4 border-t">
        <div className="flex-1">
          <div className="font-semibold text-slate-800 mb-1">
            Bematech 4200TH (compatibilidade)
          </div>
          <p className="text-sm text-slate-500">
            Ative apenas se sua impressora for Bematech 4200TH (ou similar com firmware problemático em rede).
          </p>
        </div>
        <Switch
          checked={config.bematech_compat}
          onCheckedChange={(v) => handleChange("bematech_compat", v)}
          className="mt-1"
        />
      </div>
    </div>
  );
}
