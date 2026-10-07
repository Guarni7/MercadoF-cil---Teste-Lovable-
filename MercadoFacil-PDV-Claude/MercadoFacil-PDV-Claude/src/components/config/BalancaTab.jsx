import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import BackButton from "./BackButton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Scale, RefreshCw, Plug, FileText, CircleCheck, CircleX } from "lucide-react";
import {
  readWeight,
  onElectronScaleStatus,
  disconnectElectronScale,
} from "@/lib/scale";
import { electronWindow } from "@/lib/electronWindow";

const COM_PORTS = ["COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8"];
const BAUDRATES = ["2400", "4800", "9600", "19200", "38400", "57600"];
const DATA_BITS = ["7", "8"];
const PARITIES = [
  { value: "none", label: "Nenhuma" },
  { value: "even", label: "Par" },
  { value: "odd", label: "Ímpar" },
];
const STOP_BITS = ["1", "2"];
const MODELS = [
  "Toledo Prix 8217",
  "Toledo Prix 3 Fit",
  "Toledo 2090",
  "Urano US20",
  "Urano Light",
  "Magna M-10",
  "Baloof B100",
  "Libratec NBCS",
];
// P05A = protocolo da Toledo Prix 8217 (ver src/lib/scale.js / electron/main.cjs).
const PROTOCOLS = ["P05A", "PRT0", "PRT1", "PRT2", "PRT3", "PRT4", "PRT5", "PRT7", "PRT8"];
const UNITS = [
  { value: "kg", label: "kg" },
  { value: "g", label: "g" },
];

const DEFAULT_FORM = {
  connection: "serial",
  model: "Toledo Prix 8217",
  comport: "",
  baudrate: "9600",
  dataBits: "8",
  parity: "none",
  stopBits: "1",
  protocol: "P05A",
  unit: "kg",
  tara: 0,
};

export default function BalancaTab({ onBack }) {
  const [form, setForm] = useState(DEFAULT_FORM);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [connected, setConnected] = useState(false);
  const [currentWeight, setCurrentWeight] = useState(null);
  const [reading, setReading] = useState(false);

  const isElectron = !!electronWindow().electronAPI?.isElectron;

  useEffect(() => {
    try {
      const saved = localStorage.getItem("scale_config");
      if (saved) setForm((prev) => ({ ...prev, ...JSON.parse(saved) }));
    } catch {}
    setLoading(false);
  }, []);

  // Dentro do Electron, reflete desconexão física (cabo puxado, porta
  // fechada por outro processo) em tempo real — não só no clique de testar.
  useEffect(() => {
    if (!isElectron) return undefined;
    const unsubscribe = onElectronScaleStatus((payload) => {
      if (payload.status === "connected") setConnected(true);
      else if (payload.status === "disconnected" || payload.status === "error") {
        setConnected(false);
        if (payload.status === "error" && payload.error) {
          toast.error(`Balança: ${payload.error}`);
        }
      }
    });
    return unsubscribe;
  }, [isElectron]);

  const handleChange = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    if (connected) setConnected(false);
  };

  const handleSave = (next = form) => {
    localStorage.setItem("scale_config", JSON.stringify(next));
  };

  const handleConnect = async () => {
    if (!form.comport) {
      toast.error("Selecione uma porta COM primeiro.");
      return;
    }
    setConnecting(true);
    handleSave();
    try {
      const w = await readWeight();
      setConnected(true);
      setCurrentWeight(w);
      toast.success(`Conectado em ${form.comport}!`);
    } catch (e) {
      setConnected(false);
      toast.error(e.message || "Falha ao conectar com a balança.");
    } finally {
      setConnecting(false);
    }
  };

  const handleReadWeight = async () => {
    setReading(true);
    try {
      const w = await readWeight();
      setCurrentWeight(w);
      setConnected(true);
    } catch (e) {
      toast.error(e.message || "Erro ao ler peso da balança.");
      setConnected(false);
    } finally {
      setReading(false);
    }
  };

  const handleDisconnect = async () => {
    if (isElectron) await disconnectElectronScale();
    setConnected(false);
    setCurrentWeight(null);
  };

  const handleGenerateLog = () => {
    const log = {
      timestamp: new Date().toISOString(),
      config: form,
      connected,
      currentWeight,
      isElectron,
      userAgent: navigator.userAgent,
      webSerial: "serial" in navigator,
    };
    const blob = new Blob([JSON.stringify(log, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "balanca.log";
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Log de diagnóstico salvo (balanca.log).");
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

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Scale className="w-5 h-5 text-slate-700" />
          <h2 className="text-lg font-semibold text-slate-800">Balança</h2>
        </div>
        {connected ? (
          <Badge className="gap-1.5 bg-emerald-100 text-emerald-700 border-0">
            <CircleCheck className="w-3.5 h-3.5" /> Conectado
          </Badge>
        ) : (
          <Badge variant="outline" className="gap-1.5 text-muted-foreground">
            <CircleX className="w-3.5 h-3.5" /> Desconectado
          </Badge>
        )}
      </div>

      {!isElectron && (
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2.5">
          Fora do app desktop (Electron), a leitura usa a Web Serial API do navegador — só
          Chrome/Edge, e menos confiável que dentro do app instalado.
        </p>
      )}

      {/* Modelo + Conexão */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <Label className="mb-1.5 block">Modelo</Label>
          <Select value={form.model} onValueChange={(v) => handleChange("model", v)}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Selecione..." />
            </SelectTrigger>
            <SelectContent>
              {MODELS.map((m) => (
                <SelectItem key={m} value={m}>{m}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="mb-1.5 block">Conexão</Label>
          <Select value={form.connection} onValueChange={(v) => handleChange("connection", v)}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="serial">USB/Serial</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Porta COM row */}
      <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_auto] gap-3 items-end">
        <div>
          <Label className="mb-1.5 block">Porta COM</Label>
          <Select value={form.comport} onValueChange={(v) => handleChange("comport", v)}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Selecione a porta..." />
            </SelectTrigger>
            <SelectContent>
              {COM_PORTS.map((p) => (
                <SelectItem key={p} value={p}>{p}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button variant="outline" size="icon" className="h-9 w-9" title="Atualizar portas">
          <RefreshCw className="w-4 h-4" />
        </Button>
        {connected ? (
          <Button onClick={handleDisconnect} variant="outline" className="gap-2 h-9">
            <Plug className="w-4 h-4" />
            Desconectar
          </Button>
        ) : (
          <Button
            onClick={handleConnect}
            disabled={connecting || !form.comport}
            className="gap-2 h-9"
          >
            <Plug className="w-4 h-4" />
            {connecting ? "Testando..." : "Testar conexão"}
          </Button>
        )}
      </div>

      {/* Config grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <div>
          <Label className="mb-1.5 block">Baud rate</Label>
          <Select value={form.baudrate} onValueChange={(v) => handleChange("baudrate", v)}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Selecione..." />
            </SelectTrigger>
            <SelectContent>
              {BAUDRATES.map((b) => (
                <SelectItem key={b} value={b}>{b}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="mb-1.5 block">Data bits</Label>
          <Select value={form.dataBits} onValueChange={(v) => handleChange("dataBits", v)}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Selecione..." />
            </SelectTrigger>
            <SelectContent>
              {DATA_BITS.map((d) => (
                <SelectItem key={d} value={d}>{d}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="mb-1.5 block">Paridade</Label>
          <Select value={form.parity} onValueChange={(v) => handleChange("parity", v)}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Selecione..." />
            </SelectTrigger>
            <SelectContent>
              {PARITIES.map((p) => (
                <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="mb-1.5 block">Stop bits</Label>
          <Select value={form.stopBits} onValueChange={(v) => handleChange("stopBits", v)}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Selecione..." />
            </SelectTrigger>
            <SelectContent>
              {STOP_BITS.map((s) => (
                <SelectItem key={s} value={s}>{s}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="mb-1.5 block">Protocolo</Label>
          <Select value={form.protocol} onValueChange={(v) => handleChange("protocol", v)}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Selecione..." />
            </SelectTrigger>
            <SelectContent>
              {PROTOCOLS.map((p) => (
                <SelectItem key={p} value={p}>{p}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="mb-1.5 block">Unidade</Label>
          <Select value={form.unit} onValueChange={(v) => handleChange("unit", v)}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Selecione..." />
            </SelectTrigger>
            <SelectContent>
              {UNITS.map((u) => (
                <SelectItem key={u.value} value={u.value}>{u.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="mb-1.5 block">Tara (g)</Label>
          <Input
            type="number"
            value={form.tara}
            onChange={(e) => handleChange("tara", parseFloat(e.target.value) || 0)}
            placeholder="0"
          />
        </div>
      </div>

      {/* Peso atual */}
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            Peso atual
          </p>
          <p className="text-2xl font-bold text-slate-800">
            {currentWeight != null ? `${currentWeight.toFixed(3).replace(".", ",")} ${form.unit}` : "—"}
          </p>
        </div>
        <Button variant="outline" onClick={handleReadWeight} disabled={reading} className="gap-2">
          {reading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          Ler peso
        </Button>
      </div>

      {/* Footer */}
      <div className="flex items-center gap-3 pt-2">
        <Button variant="outline" onClick={() => handleSave()} className="gap-2">
          Salvar configuração
        </Button>
        <Button variant="outline" onClick={handleGenerateLog} className="gap-2">
          <FileText className="w-4 h-4" />
          Gerar Log
        </Button>
        <p className="text-xs text-slate-500">
          Salva diagnóstico local (balanca.log). Não envia à nuvem.
        </p>
      </div>
    </div>
  );
}
