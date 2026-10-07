import React, { useState, useEffect, useRef } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RefreshCw, Upload, Plus, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { applyTheme, saveTheme, loadTheme, resetTheme } from "@/lib/theme";
import { api } from "@/api/dataClient";
import { getCachedLogo, syncCompanyCache } from "@/lib/companyCache";
import { mensagemDeErro } from "@/lib/mensagemErro";

const palettes = [
  { name: "Teal & Indigo", primary: "#006669", menu: "#00a5ab" },
  { name: "Azul & Laranja", primary: "#2563eb", menu: "#f97316" },
  { name: "Violeta & Rosa", primary: "#7c3aed", menu: "#ec4899" },
  { name: "Verde & Amarelo", primary: "#16a34a", menu: "#eab308" },
  { name: "Vermelho & Cinza", primary: "#dc2626", menu: "#6b7280" },
  { name: "Marinho & Dourado", primary: "#1e3a8a", menu: "#d4af37" },
  { name: "Esmeralda & Coral", primary: "#059669", menu: "#ff7f50" },
  { name: "Roxo & Ciano", primary: "#9333ea", menu: "#06b6d4" },
];

export default function AparenciaTab() {
  const [primaryColor, setPrimaryColor] = useState("#006669");
  const [menuColor, setMenuColor] = useState("#00a5ab");
  const [selectedPalette, setSelectedPalette] = useState(0);
  const [logoUrl, setLogoUrl] = useState(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);

  useEffect(() => {
    const saved = loadTheme();
    if (saved) {
      setPrimaryColor(saved.primary);
      setMenuColor(saved.menu);
      const match = palettes.findIndex(
        (p) =>
          p.primary.toLowerCase() === saved.primary.toLowerCase() &&
          p.menu.toLowerCase() === saved.menu.toLowerCase()
      );
      if (match >= 0) setSelectedPalette(match);
    }
    // A logo pertence à empresa, não ao navegador: sem isso o caixa novo
    // (ou o mesmo caixa depois de limpar o cache) ficava sem logo nenhuma.
    setLogoUrl(getCachedLogo());
    syncCompanyCache().then(({ logoUrl: remoto }) => setLogoUrl(remoto || null));
  }, []);

  const applyColors = () => {
    saveTheme(primaryColor, menuColor);
    applyTheme(primaryColor, menuColor);
    toast.success("Cores aplicadas com sucesso!");
  };

  const handleReset = () => {
    resetTheme();
    setPrimaryColor("#006669");
    setMenuColor("#00a5ab");
    setSelectedPalette(0);
    toast.success("Cores padrão restauradas!");
  };

  const handleLogoUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      toast.error("Arquivo muito grande. Máx 2MB.");
      return;
    }
    setUploading(true);
    try {
      const { file_url } = await api.files.upload({ file });
      const me = await api.auth.me();
      if (!me?.company_id) throw new Error("Usuário sem empresa vinculada.");
      await api.entities.Company.update(me.company_id, { logo_url: file_url });
      await syncCompanyCache();
      setLogoUrl(file_url);
      toast.success("Logo salva!");
    } catch (err) {
      console.error("Erro ao enviar logo:", err);
      toast.error(mensagemDeErro(err, "enviar a logo"));
    } finally {
      setUploading(false);
    }
  };

  const removeLogo = async () => {
    try {
      const me = await api.auth.me();
      if (!me?.company_id) throw new Error("Usuário sem empresa vinculada.");
      await api.entities.Company.update(me.company_id, { logo_url: null });
      await syncCompanyCache();
      setLogoUrl(null);
      toast.success("Logo removida.");
    } catch (e) {
      console.error("Erro ao remover logo:", e);
      toast.error(mensagemDeErro(e, "remover a logo"));
    }
  };

  return (
    <div className="space-y-6">
      <Card className="p-6">
        <h2 className="font-heading font-semibold text-lg mb-1">Paletas de Cores</h2>
        <p className="text-sm text-muted-foreground mb-4">
          Selecione uma paleta pronta ou personalize com códigos hexadecimais
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {palettes.map((p, i) => (
            <button
              key={i}
              onClick={() => {
                setSelectedPalette(i);
                setPrimaryColor(p.primary);
                setMenuColor(p.menu);
              }}
              className={`p-3 rounded-lg border-2 transition-all text-left ${
                selectedPalette === i ? "border-primary" : "border-border hover:border-muted-foreground/40"
              }`}
            >
              <div className="flex gap-2 mb-2">
                <div className="w-6 h-6 rounded-full" style={{ background: p.primary }} />
                <div className="w-6 h-6 rounded-full" style={{ background: p.menu }} />
              </div>
              <span className="text-xs font-medium">{p.name}</span>
            </button>
          ))}
        </div>
      </Card>

      <Card className="p-6">
        <h2 className="font-heading font-semibold text-lg mb-4">Cores Personalizadas</h2>
        <div className="space-y-4">
          <div>
            <Label className="mb-1.5 block">Cor Principal (Botões, cabeçalho, barra inferior)</Label>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg border" style={{ background: primaryColor }} />
              <Input value={primaryColor} onChange={(e) => setPrimaryColor(e.target.value)} className="max-w-xs font-mono" />
            </div>
          </div>
          <div>
            <Label className="mb-1.5 block">Cor do Menu (Barra lateral, menu de navegação)</Label>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg border" style={{ background: menuColor }} />
              <Input value={menuColor} onChange={(e) => setMenuColor(e.target.value)} className="max-w-xs font-mono" />
            </div>
          </div>
          <div className="flex items-center gap-8 py-4 px-6 bg-muted rounded-lg justify-center">
            <div className="text-center">
              <div className="w-16 h-16 rounded-full mx-auto mb-1" style={{ background: primaryColor }} />
              <span className="text-xs text-muted-foreground">Principal</span>
            </div>
            <div className="text-center">
              <div className="w-16 h-16 rounded-full mx-auto mb-1" style={{ background: menuColor }} />
              <span className="text-xs text-muted-foreground">Menu</span>
            </div>
          </div>
          <div className="flex gap-3">
            <Button onClick={applyColors} className="flex-1 gap-2">
              <RefreshCw className="w-4 h-4" /> Aplicar Cores
            </Button>
            <Button variant="outline" onClick={handleReset} className="gap-2">
              <RotateCcw className="w-4 h-4" /> Restaurar Padrão
            </Button>
          </div>
        </div>
      </Card>

      <Card className="p-6">
        <h2 className="font-heading font-semibold text-lg mb-1">Logo da Empresa</h2>
        <p className="text-sm text-muted-foreground mb-4">Aparece no menu lateral e recibos</p>
        <div className="flex items-center gap-4">
          <div
            className="w-24 h-24 rounded-lg border-2 border-dashed border-border flex items-center justify-center overflow-hidden bg-muted/30 cursor-pointer"
            onClick={() => fileRef.current?.click()}
          >
            {logoUrl ? (
              <img src={logoUrl} alt="Logo" className="w-full h-full object-contain" />
            ) : (
              <Plus className="w-8 h-8 text-muted-foreground/40" />
            )}
          </div>
          <div className="space-y-2">
            <input ref={fileRef} type="file" accept="image/png,image/jpeg" className="hidden" onChange={handleLogoUpload} />
            <Button variant="outline" className="gap-2" onClick={() => fileRef.current?.click()} disabled={uploading}>
              <Upload className="w-4 h-4" /> {uploading ? "Enviando..." : "Enviar Logo"}
            </Button>
            {logoUrl && (
              <Button variant="ghost" size="sm" className="text-destructive block" onClick={removeLogo}>
                Remover
              </Button>
            )}
          </div>
        </div>
        <p className="text-xs text-muted-foreground mt-3">PNG ou JPG, máx 2MB</p>
      </Card>
    </div>
  );
}