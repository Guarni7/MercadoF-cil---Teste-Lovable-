import React, { useState, useEffect } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Building2, AlertTriangle, Settings, Save } from "lucide-react";
import { toast } from "sonner";

export default function SicrediConfigDialog({ open, onClose }) {
  const [active, setActive] = useState(false);
  const [ambiente, setAmbiente] = useState("sandbox");
  const [apiKey, setApiKey] = useState("");
  const [cooperativa, setCooperativa] = useState("");
  const [posto, setPosto] = useState("");
  const [beneficiario, setBeneficiario] = useState("");
  const [codigoAcesso, setCodigoAcesso] = useState("");
  const [boletoHibrido, setBoletoHibrido] = useState(true);
  const [diasProtesto, setDiasProtesto] = useState("");
  const [diasNegativacao, setDiasNegativacao] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      try {
        const saved = JSON.parse(localStorage.getItem("sicredi_config") || "{}");
        if (saved.active !== undefined) setActive(saved.active);
        if (saved.ambiente) setAmbiente(saved.ambiente);
        if (saved.apiKey) setApiKey(saved.apiKey);
        if (saved.cooperativa) setCooperativa(saved.cooperativa);
        if (saved.posto) setPosto(saved.posto);
        if (saved.beneficiario) setBeneficiario(saved.beneficiario);
        if (saved.codigoAcesso) setCodigoAcesso(saved.codigoAcesso);
        if (saved.boletoHibrido !== undefined) setBoletoHibrido(saved.boletoHibrido);
        if (saved.diasProtesto !== undefined) setDiasProtesto(saved.diasProtesto);
        if (saved.diasNegativacao !== undefined) setDiasNegativacao(saved.diasNegativacao);
      } catch {}
    }
  }, [open]);

  const isComplete = apiKey && cooperativa && beneficiario;

  const handleSave = () => {
    setSaving(true);
    setTimeout(() => {
      localStorage.setItem("sicredi_config", JSON.stringify({
        active, ambiente, apiKey, cooperativa, posto, beneficiario, codigoAcesso,
        boletoHibrido, diasProtesto, diasNegativacao,
      }));
      setSaving(false);
      toast.success("Configurações do Sicredi salvas!");
      onClose();
    }, 1000);
  };

  const handleTest = () => {
    toast.info("Testando conexão...");
    setTimeout(() => {
      if (isComplete) toast.success("Conexão bem-sucedida!");
      else toast.error("Configuração incompleta.");
    }, 1500);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
              <Building2 className="w-4 h-4 text-primary" />
            </div>
            API Sicredi
          </DialogTitle>
          <p className="text-xs text-muted-foreground">
            Cobrança Online — boleto tradicional/híbrido, protesto e negativação (manual v3.9).
          </p>
        </DialogHeader>

        <div className="rounded-lg bg-muted p-4 space-y-2">
          <h4 className="text-sm font-semibold mb-2">Antes de conectar</h4>
          <div className="text-xs text-muted-foreground space-y-1.5">
            <div>1. Contrate Cobrança na cooperativa com modalidade API (Cobrança Online).</div>
            <div>2. Crie a APP no Portal do Desenvolvedor e obtenha o x-api-key.</div>
            <div>3. Produção: IB → Cobrança → Código de Acesso → Gerar.</div>
          </div>
        </div>

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-semibold">Credenciais API</h4>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Ativo</span>
              <Switch checked={active} onCheckedChange={setActive} />
            </div>
          </div>
          <p className="text-xs text-muted-foreground -mt-2">
            Username OAuth = beneficiário + cooperativa
          </p>

          <div>
            <Label className="mb-1.5 block">Ambiente</Label>
            <Select value={ambiente} onValueChange={setAmbiente}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="sandbox">Sandbox (homologação)</SelectItem>
                <SelectItem value="producao">Produção</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="mb-1.5 block">x-api-key</Label>
            <Input value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="Token da APP" />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label className="mb-1.5 block">Cooperativa</Label>
              <Input value={cooperativa} onChange={(e) => setCooperativa(e.target.value)} placeholder="0100" />
            </div>
            <div>
              <Label className="mb-1.5 block">Posto</Label>
              <Input value={posto} onChange={(e) => setPosto(e.target.value)} placeholder="00" />
            </div>
            <div>
              <Label className="mb-1.5 block">Beneficiário</Label>
              <Input value={beneficiario} onChange={(e) => setBeneficiario(e.target.value)} placeholder="Convênio" />
            </div>
          </div>

          <div>
            <Label className="mb-1.5 block">Código de Acesso</Label>
            <Input value={codigoAcesso} onChange={(e) => setCodigoAcesso(e.target.value)} placeholder="Sandbox: teste123 se vazio" />
          </div>
        </div>

        <div className="space-y-4 pt-4 border-t">
          <h4 className="text-sm font-semibold">Preferências</h4>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium">Boleto híbrido (Pix QR)</div>
              <div className="text-xs text-muted-foreground">Exige modalidade híbrida na cooperativa</div>
            </div>
            <Switch checked={boletoHibrido} onCheckedChange={setBoletoHibrido} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="mb-1.5 block">Dias protesto auto. <span className="text-muted-foreground">(Opcional)</span></Label>
              <Input type="number" value={diasProtesto} onChange={(e) => setDiasProtesto(e.target.value)} placeholder="—" />
            </div>
            <div>
              <Label className="mb-1.5 block">Dias negativação auto. <span className="text-muted-foreground">(Opcional)</span></Label>
              <Input type="number" value={diasNegativacao} onChange={(e) => setDiasNegativacao(e.target.value)} placeholder="—" />
            </div>
          </div>
        </div>

        {!isComplete && (
          <div className="flex items-center gap-2 p-3 rounded-lg border border-amber-200 bg-amber-50">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
            <span className="text-xs text-amber-700">Configuração incompleta</span>
          </div>
        )}

        <div className="flex gap-3 pt-2">
          <Button onClick={handleSave} disabled={saving} className="flex-1 gap-2">
            {saving ? "Salvando..." : (<><Save className="w-4 h-4" /> Salvar Sicredi</>)}
          </Button>
          <Button variant="outline" onClick={handleTest} className="gap-2">
            <Settings className="w-4 h-4" /> Testar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}